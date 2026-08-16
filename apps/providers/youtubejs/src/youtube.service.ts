import { Constants, Innertube, type Types } from 'youtubei.js';

import { ProviderError, type ProviderErrorCode } from './errors.js';
import { logger } from './logger.js';
import { saturation } from './saturation.js';

type Kind = 'audio' | 'video';

interface ChooseOptions {
  type: Kind;
  quality: string;
  format: string;
  codec?: string;
  itag?: number;
  client?: Types.InnerTubeClient;
}

// Streaming requires a client that returns pre-deciphered URLs. As of 2026-08 the WEB family is
// SABR-only — it hands back no directly fetchable URL at all ("No valid URL to decipher"), with or
// without a PO token — so ANDROID_VR is the one that works, and it needs no token. IOS is kept as
// a second try. Override with YOUTUBEJS_STREAM_CLIENTS (comma-separated, tried in order).
const STREAM_CLIENTS = (process.env.YOUTUBEJS_STREAM_CLIENTS ?? 'ANDROID_VR,IOS')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean) as Types.InnerTubeClient[];

// Every download is fetched as EXPLICIT byte ranges, never as a plain un-ranged GET: googlevideo
// now rejects an un-ranged GET on these signed URLs about half the time (403) while answering the
// same URL's bounded ranges with 206. Ranges are also fetched N-at-a-time to defeat YouTube's
// per-connection throttle. Keep segments small (~1 MiB): the throttle ramps up *within* a
// connection, so small ranges stay in the fast burst. Tunable via env; 1 disables parallelism.
const SEGMENT_SIZE = Math.max(1, Number(process.env.STREAM_SEGMENT_SIZE ?? 1024 * 1024));
const SEGMENT_CONCURRENCY = Math.max(1, Number(process.env.STREAM_SEGMENT_CONCURRENCY ?? 4));
const MIN_PARALLEL_SIZE = SEGMENT_SIZE * 2;
// Per-segment retry for the direct ranged download (mirrors provider-ytdl): a single googlevideo
// range can hit a transient throttle/RST — retry a few times before failing the whole stream.
const SEGMENT_RETRIES = Math.max(0, Number(process.env.STREAM_SEGMENT_RETRIES ?? 2));
const SEGMENT_RETRY_BACKOFF_MS = Math.max(
  0,
  Number(process.env.STREAM_SEGMENT_RETRY_BACKOFF ?? 0.5) * 1000,
);
// A 403 is different from a transient fault: the signed URL itself was rejected (bot-check /
// per-IP rate limit / expiry), so replaying it is pointless — the video is fine, the URL is not.
// Re-resolve a fresh URL for the same itag and replay the range against that. The budget counts
// refreshes SINCE THE LAST RANGE THAT SUCCEEDED, so a long file may need several over its
// lifetime while a video whose every fresh URL is refused fails over quickly. Mirrors ytdl.
const URL_REFRESHES = Math.max(0, Number(process.env.STREAM_URL_REFRESHES ?? 3));

/** Structural subset of youtubei.js `Format` — avoids fragile deep type imports. */
interface YtFormat {
  itag: number;
  mime_type: string;
  bitrate?: number;
  average_bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  content_length?: number;
}

/** A chosen stream format: the structural fields we read for headers/DTO, plus youtubei.js's
 *  `decipher()` to resolve the final googlevideo URL so we can fetch byte ranges directly. */
interface StreamFormat extends YtFormat {
  decipher(player?: unknown): Promise<string>;
}

interface ThumbnailDto {
  url: string;
  width?: number;
  height?: number;
}

interface FormatDto {
  itag: number;
  ext: string;
  container: string;
  codec?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  contentLength?: number;
}

interface VideoDto {
  id: string;
  title?: string;
  author?: string;
  channelId?: string;
  durationSeconds?: number;
  publishedAt?: string;
  thumbnails: ThumbnailDto[];
  bestAudio?: FormatDto;
  bestVideo?: FormatDto;
}

interface PlaylistDto {
  id: string;
  title?: string;
  author?: string;
  /** Playable videos; each carries its title when known (free from the playlist items) so the UI
   *  can label rows up front instead of raw ids. */
  videos: { id: string; title?: string }[];
}

interface StreamResult {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

/** Why one stream-client attempt failed — lets stream() try the next client and finally aggregate
 *  the most-informative error rather than reporting whichever one happened to come last. */
type StreamFailure =
  'sessionexpired' | 'botcheck' | 'forbidden' | 'noformat' | 'notplayable' | 'error';
type StreamAttempt = { ok: StreamResult } | { failure: StreamFailure; error?: unknown };

/** Internal signal: googlevideo rejected the media URL with 403 and re-resolving a fresh URL did
 *  not help, BEFORE any bytes were committed — so stream() can fall through to the next client and
 *  surface a clean status instead of a truncated body. Never leaves the module. */
class UpstreamForbidden extends Error {}

/** The signed googlevideo URL for one (video, kind, itag), re-resolvable in place.
 *
 *  googlevideo can 403 a signed URL at any moment — bot-check, per-IP rate limit, expiry — and it
 *  does so mid-download, not just up front. The URL is stale, the video is not: re-resolving
 *  yields a fresh URL for the same itag that resumes at the very byte range that failed. Range
 *  fetches read `url` through this object so one refresh repairs the whole in-flight download;
 *  concurrent fetches that hit 403 on the same generation coalesce onto a single re-resolve. */
class MediaSource {
  readonly #resolve: () => Promise<string>;
  readonly #label: string;
  #inflight: Promise<boolean> | null = null;
  #sinceProgress = 0;
  /** Monotonic; identifies which URL a caller was using so refreshes coalesce. */
  generation = 0;
  url: string;

  constructor(url: string, label: string, resolve: () => Promise<string>) {
    this.url = url;
    this.#label = label;
    this.#resolve = resolve;
  }

  /** A range came back with bytes, so the current URL works — clear the refresh budget. */
  progress(): void {
    this.#sinceProgress = 0;
  }

  /** `seenGeneration` is the generation the caller was using: if it is already behind, someone
   *  else refreshed and the caller just retries. Returns false once the budget is spent or the
   *  re-resolve itself fails — the caller then gives up on this URL. */
  async refresh(seenGeneration: number): Promise<boolean> {
    if (seenGeneration !== this.generation) return true;
    if (this.#inflight) return this.#inflight;
    if (this.#sinceProgress >= URL_REFRESHES) return false;
    const inflight = (async (): Promise<boolean> => {
      try {
        this.url = await this.#resolve();
        this.generation++;
        this.#sinceProgress++;
        logger.info({ source: this.#label, generation: this.generation }, 'stream_url_refresh');
        return true;
      } catch (err) {
        logger.warn(
          { source: this.#label, err: err instanceof Error ? err.message : String(err) },
          'stream_url_refresh_failed',
        );
        return false;
      }
    })();
    this.#inflight = inflight;
    void inflight.finally(() => {
      if (this.#inflight === inflight) this.#inflight = null;
    });
    return inflight;
  }
}

const CONTENT_TYPE: Record<string, string> = {
  'webm/audio': 'audio/webm',
  'mp4/audio': 'audio/mp4',
  'webm/video': 'video/webm',
  'mp4/video': 'video/mp4',
};

// Substrings that mean "gone", not "broken" — kept in sync with provider-ytdl.
const NOT_FOUND_HINTS = [
  'private',
  'unavailable',
  'does not exist',
  'no longer exists',
  'not exist',
  'removed',
  'deleted',
  'not found',
  'terminated',
  'members-only',
  'this video is not available',
];

// Substrings / playability statuses that mean YouTube is demanding a PO-token / "prove you're not
// a bot". There is nothing to escalate to — the clients that accept a PO token are SABR-only and
// serve no fetchable URL — so this is a classification signal: it means "this egress IP is being
// challenged" (429 RATE_LIMITED, backend backs off) rather than "this video is gone" (404).
const BOT_CHECK_HINTS = [
  'sign in to confirm',
  "confirm you're not a bot",
  'confirm you’re not a bot',
  'not a bot',
  'login_required',
  'login required',
  'po_token',
  'po token',
  'pot token',
];

// Substrings that mean YouTube is throttling THIS egress IP (vs a local fault). Surfaced as a
// 429 RATE_LIMITED + Retry-After so the backend backs off and falls back to the other provider —
// the real signal that a replica/IP needs to scale out or rotate.
const RATE_LIMIT_HINTS = ['429', 'too many requests', 'rate limit', 'rate-limit', 'rate_limit'];

// Substrings that mean the Innertube session is stale (expired token, signature mismatch,
// session-changed). On these, we null the cached Innertube so the next call rebuilds it.
const SESSION_EXPIRED_HINTS = [
  'session expired',
  'session changed',
  'signature mismatch',
  'invalid session',
  'visitor data',
];

// Same /videos/:id → /videos/:id/stream sequence the backend issues for every work item:
// caching `getInfo` for ~10 min halves Innertube round-trips per video.
const INFO_TTL_MS = 10 * 60 * 1000;
const INFO_MAX_ENTRIES = 512;

// Playability statuses we treat as "not available" (mirrors ytdl's 404-on-private/removed).
const PLAYABLE_STATUSES = new Set(['OK', 'LIVE_STREAM_OFFLINE']);

export class YoutubeService {
  static readonly libraryVersion = '18.0.0';

  #instance: Innertube | null = null;
  #creating: Promise<Innertube> | null = null;
  // Caches yt.getInfo(videoId) by videoId for INFO_TTL_MS; trimmed to INFO_MAX_ENTRIES LRU.
  #infoCache = new Map<string, { ts: number; info: Awaited<ReturnType<Innertube['getInfo']>> }>();

  async #innertube(): Promise<Innertube> {
    if (this.#instance) return this.#instance;
    // Don't cache a rejected promise: if bootstrap fails, subsequent calls must retry.
    // Caching the rejection bricks the provider until restart.
    if (!this.#creating) {
      const creating = Innertube.create();
      this.#creating = creating;
      creating.catch(() => {
        if (this.#creating === creating) this.#creating = null;
      });
    }
    this.#instance = await this.#creating;
    return this.#instance;
  }

  /** Drop the cached Innertube instance + info cache. The next call to #innertube() will
   *  rebuild — used when a session-expired error is detected during a call. */
  #resetInstance(): void {
    this.#instance = null;
    this.#creating = null;
    this.#infoCache.clear();
  }

  #isBotCheck(err: unknown): boolean {
    const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return BOT_CHECK_HINTS.some((hint) => m.includes(hint));
  }

  #isBotCheckStatus(info: { playability_status?: { status?: string; reason?: string } }): boolean {
    const status = info.playability_status?.status ?? '';
    const reason = (info.playability_status?.reason ?? '').toLowerCase();
    return status === 'LOGIN_REQUIRED' || BOT_CHECK_HINTS.some((hint) => reason.includes(hint));
  }

  // --- public API ------------------------------------------------------------------------

  async getVideoMetadata(videoId: string): Promise<VideoDto> {
    this.#rejectIfSaturated();
    const info = await this.#getInfo(videoId);
    const basic = info.basic_info;

    const dto: VideoDto = {
      id: basic.id ?? videoId,
      thumbnails: (basic.thumbnail ?? []).map((t) =>
        dropUndefined<ThumbnailDto>({ url: t.url, width: t.width, height: t.height }),
      ),
    };
    if (basic.title) dto.title = basic.title;
    const author = basic.author ?? basic.channel?.name;
    if (author) dto.author = author;
    const channelId = basic.channel_id ?? basic.channel?.id;
    if (channelId) dto.channelId = channelId;
    if (typeof basic.duration === 'number') dto.durationSeconds = basic.duration;
    const published = normalizeDate(stripDatePrefix(info.primary_info?.published?.text));
    if (published) dto.publishedAt = published;

    const bestAudio = this.#chooseBest(info, 'audio');
    if (bestAudio) dto.bestAudio = toFormatDto(bestAudio.format, 'audio');
    const bestVideo = this.#chooseBest(info, 'video');
    if (bestVideo) dto.bestVideo = toFormatDto(bestVideo.format, 'video');

    return dto;
  }

  async getPlaylist(playlistId: string): Promise<PlaylistDto> {
    this.#rejectIfSaturated();
    const yt = await this.#innertube();
    let page;
    try {
      page = await yt.getPlaylist(playlistId);
    } catch (err) {
      throw this.#classify(err, 'PLAYLIST_NOT_FOUND');
    }

    const title = page.info.title;
    const author = page.info.author?.name;
    const videos: { id: string; title?: string }[] = [];
    // youtubei.js PlaylistVideo.title is a `Text` node (`.text`); capture it free for the UI.
    const collect = (items: readonly unknown[]): void => {
      for (const item of items) {
        const { id, title: itemTitle } = item as { id?: string; title?: { text?: string } };
        if (!id) continue;
        videos.push({ id, ...(itemTitle?.text ? { title: itemTitle.text } : {}) });
      }
    };

    collect(page.items);
    while (page.has_continuation) {
      try {
        page = await page.getContinuation();
      } catch (err) {
        // Mid-pagination failures (playlist deleted between pages, transient upstream)
        // shouldn't drop the videos we've already collected — surface a precise error
        // instead of letting collect() bubble an unclassified UPSTREAM_ERROR.
        throw this.#classify(err, 'PLAYLIST_NOT_FOUND');
      }
      collect(page.items);
    }

    const dto: PlaylistDto = { id: playlistId, videos };
    if (title) dto.title = title;
    if (author) dto.author = author;
    return dto;
  }

  async stream(
    videoId: string,
    kind: Kind,
    itag: string | undefined,
    rangeHeader: string | undefined,
  ): Promise<StreamResult> {
    // Reject multi-range (comma) up-front — `bytes=0-9,20-29` would need multipart/byteranges,
    // which Range + a single Content-Range can't express. 416 is the correct HTTP semantic.
    if (rangeHeader && rangeHeader.includes(',')) {
      throw new ProviderError(416, 'BAD_REQUEST', 'multi-range Range requests not supported');
    }
    // Shed a NEW stream's extraction when saturated; a ranged request is (usually) part of an
    // already-started download, so don't reject those — only gate the un-ranged "open" call.
    if (!rangeHeader) this.#rejectIfSaturated();

    const yt = await this.#innertube();
    // Track distinct per-client failure categories so the user/caller learns *why* every
    // STREAM_CLIENTS choice failed, not just the last error's message.
    let sawNoPlayable = false;
    let sawNoFormat = false;
    let sawNetworkError: ProviderError | undefined;
    let sawSessionExpired = false;
    let sawBotCheck = false;
    let sawForbidden = false;
    let lastError: unknown;

    const record = (outcome: Exclude<StreamAttempt, { ok: StreamResult }>): void => {
      if (outcome.error !== undefined) lastError = outcome.error;
      switch (outcome.failure) {
        case 'sessionexpired':
          sawSessionExpired = true;
          break;
        case 'botcheck':
          sawBotCheck = true;
          break;
        case 'forbidden':
          sawForbidden = true;
          break;
        case 'noformat':
          sawNoFormat = true;
          break;
        case 'notplayable':
          sawNoPlayable = true;
          break;
        case 'error':
          if (outcome.error instanceof ProviderError) sawNetworkError = outcome.error;
          break;
      }
    };

    for (const client of STREAM_CLIENTS) {
      const outcome = await this.#attemptStreamClient(yt, videoId, kind, itag, rangeHeader, client);
      if ('ok' in outcome) return outcome.ok;
      record(outcome);
    }

    // Drop any cached Innertube if every client failed for session-expired reasons.
    if (sawSessionExpired) this.#resetInstance();

    if (lastError instanceof ProviderError) throw lastError;
    // Prefer the most-informative classification: FORMAT_NOT_FOUND > VIDEO_NOT_FOUND > UPSTREAM_ERROR.
    if (sawNoFormat) {
      throw new ProviderError(404, 'FORMAT_NOT_FOUND', `no ${kind} format across stream clients`);
    }
    if (sawNoPlayable) {
      throw new ProviderError(404, 'VIDEO_NOT_FOUND', 'video not playable across stream clients');
    }
    if (sawNetworkError) throw sawNetworkError;
    if (sawBotCheck) {
      // YouTube is challenging this egress IP rather than hiding the video. Surface it as a
      // retryable rate-limit so the backend backs off and fails over instead of marking the
      // video permanently unavailable.
      throw new ProviderError(429, 'RATE_LIMITED', 'upstream demanded a bot check', 5);
    }
    if (sawForbidden) {
      // Every client's URL was refused even after re-resolving → clean 502 so the backend
      // cascade moves on instead of retrying an unrecoverable URL.
      throw new ProviderError(502, 'UPSTREAM_ERROR', 'upstream rejected media URL (403)');
    }
    throw this.#classify(lastError, 'VIDEO_NOT_FOUND');
  }

  /** One stream attempt against a single client. Returns the StreamResult on success or a
   *  categorized failure, so stream() can try the next client and aggregate the best error. */
  async #attemptStreamClient(
    yt: Innertube,
    videoId: string,
    kind: Kind,
    itag: string | undefined,
    rangeHeader: string | undefined,
    client: Types.InnerTubeClient,
  ): Promise<StreamAttempt> {
    let info: Awaited<ReturnType<Innertube['getBasicInfo']>>;
    try {
      info = await yt.getBasicInfo(videoId, { client });
    } catch (err) {
      if (this.#isSessionExpired(err)) return { failure: 'sessionexpired', error: err };
      if (this.#isBotCheck(err)) return { failure: 'botcheck', error: err };
      return { failure: 'error', error: err };
    }
    const status = info.playability_status?.status;
    if (status && !PLAYABLE_STATUSES.has(status)) {
      const reason = info.playability_status?.reason || `video not playable: ${status}`;
      if (this.#isBotCheckStatus(info)) {
        return { failure: 'botcheck', error: new ProviderError(404, 'VIDEO_NOT_FOUND', reason) };
      }
      return { failure: 'notplayable', error: new ProviderError(404, 'VIDEO_NOT_FOUND', reason) };
    }

    const chosen = this.#chooseForStream(info, kind, itag, client);
    if (!chosen) {
      return {
        failure: 'noformat',
        error: new ProviderError(404, 'FORMAT_NOT_FOUND', `no ${kind} format available`),
      };
    }

    const { format, options } = chosen;
    const { container, ext, codec } = describe(format, kind);
    const total = format.content_length ?? 0;
    const range = parseRange(rangeHeader, total);

    const headers: Record<string, string> = {
      // Only advertise Range support when we actually know the size — otherwise the client
      // can't compute the suffix range space.
      ...(total > 0 ? { 'Accept-Ranges': 'bytes' } : {}),
      'Content-Type': CONTENT_TYPE[`${container}/${kind}`] ?? 'application/octet-stream',
      'X-Format-Itag': String(format.itag),
      'X-Format-Container': container,
      'X-Format-Codec': codec ?? '',
      'X-Format-Ext': ext,
    };

    try {
      const url = await format.decipher(yt.session.player);
      if (!url) {
        // No deciphered URL (SABR-only client, or a player/cipher issue) → youtubei.js's own
        // downloader as a last resort. It cannot do our refresh-on-403 dance.
        const body = await info.download(range ? { ...options, range } : options);
        if (range) {
          headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total || '*'}`;
          headers['Content-Length'] = String(range.end - range.start + 1);
          return { ok: { status: 206, headers, body } };
        }
        if (total) headers['Content-Length'] = String(total);
        return { ok: { status: 200, headers, body } };
      }

      const source = this.#mediaSource(url, videoId, kind, format.itag, total, client);
      // A client Range is a single ranged request — serve it as a 206 covering just that span.
      if (range) {
        const body = await this.#fetchRange(source, range.start, range.end, 'range');
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total || '*'}`;
        headers['Content-Length'] = String(range.end - range.start + 1);
        return { ok: { status: 206, headers, body } };
      }
      // Full download. Big enough to be worth splitting → concurrent ranges; otherwise one
      // range spanning the whole file. Either way it is RANGED: an un-ranged GET gets 403'd.
      if (total > MIN_PARALLEL_SIZE && SEGMENT_CONCURRENCY > 1) {
        // Pre-flight segment 0 before committing 200 + Content-Length, so an unrecoverable 403
        // surfaces as a clean status (and lets stream() try the next client) instead of a
        // truncated body. Its bytes are reused as the first chunk.
        const body = await this.#parallelDownload(source, total);
        headers['Content-Length'] = String(total);
        return { ok: { status: 200, headers, body } };
      }
      const body = await this.#fetchRange(source, 0, total ? total - 1 : undefined, 'download');
      if (total) headers['Content-Length'] = String(total);
      return { ok: { status: 200, headers, body } };
    } catch (err) {
      if (err instanceof UpstreamForbidden) return { failure: 'forbidden', error: err };
      return { failure: 'error', error: err };
    }
  }

  /** Wrap a deciphered URL so a 403 can re-resolve it: re-fetch basic info on the same client,
   *  re-pick the SAME itag and decipher again. The size must match — a response may already have
   *  committed Content-Length, so a fresh URL is only usable if it addresses the same bytes. */
  #mediaSource(
    url: string,
    videoId: string,
    kind: Kind,
    itag: number,
    total: number,
    client: Types.InnerTubeClient,
  ): MediaSource {
    return new MediaSource(url, `${videoId}/${kind}`, async () => {
      const yt = await this.#innertube();
      const info = await yt.getBasicInfo(videoId, { client });
      const chosen = this.#chooseForStream(info, kind, String(itag), client);
      if (!chosen) throw new Error(`itag ${itag} vanished on re-resolve`);
      if (total && (chosen.format.content_length ?? 0) !== total) {
        throw new Error(`itag ${itag} changed size on re-resolve`);
      }
      const fresh = await chosen.format.decipher(yt.session.player);
      if (!fresh) throw new Error(`itag ${itag} has no URL on re-resolve`);
      return fresh;
    });
  }

  /** One ranged GET, healing the two ways googlevideo fails a healthy download: transient faults
   *  (timeout/RST/408/429/5xx) are replayed against the same URL after a backoff, while a 403
   *  means the URL itself was rejected, so the source re-resolves and the range is replayed
   *  against a fresh URL. `end` omitted = open-ended (`bytes=N-`), used when the size is unknown.
   *  The status and length are checked before the body is handed back, so it never truncates a
   *  response whose Content-Length is already committed. The body is returned UNREAD — only call
   *  this when the caller consumes it immediately (see #readRange for the fetch-ahead case). */
  async #fetchRange(
    source: MediaSource,
    start: number,
    end: number | undefined,
    label: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const range = `bytes=${start}-${end ?? ''}`;
    for (let transient = 0; ;) {
      const generation = source.generation;
      let res: Response;
      try {
        // Send the same headers youtubei.js's own downloader uses (origin/referer/accept):
        // googlevideo is markedly more willing to 403 a request that doesn't look like it came
        // from the client that minted the URL. Only the Range is ours.
        res = await fetch(source.url, {
          headers: { ...Constants.STREAM_HEADERS, Range: range },
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (transient < SEGMENT_RETRIES) {
          await delay(SEGMENT_RETRY_BACKOFF_MS * 2 ** transient++);
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new ProviderError(502, 'UPSTREAM_ERROR', `${label} failed after retries: ${msg}`);
      }
      if (res.ok || res.status === 206) {
        // We commit Content-Length up front, so a range that comes back the wrong length would
        // silently corrupt the stored object. Treat it as a transient fault and replay.
        const want = end === undefined ? null : end - start + 1;
        const got = Number(res.headers.get('content-length') ?? NaN);
        if (!res.body || (want !== null && got !== want)) {
          await res.body?.cancel().catch(() => undefined);
          if (transient < SEGMENT_RETRIES) {
            await delay(SEGMENT_RETRY_BACKOFF_MS * 2 ** transient++);
            continue;
          }
          throw new ProviderError(
            502,
            'UPSTREAM_ERROR',
            `${label} -> ${res.status} with ${got || 0} bytes, expected ${want}`,
          );
        }
        source.progress();
        return res.body;
      }
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 403) {
        if (await source.refresh(generation)) continue;
        throw new UpstreamForbidden(`${label} -> 403`);
      }
      if ((res.status === 408 || res.status === 429 || res.status >= 500) && !signal?.aborted) {
        if (transient < SEGMENT_RETRIES) {
          await delay(SEGMENT_RETRY_BACKOFF_MS * 2 ** transient++);
          continue;
        }
      }
      if (res.status === 429) {
        throw new ProviderError(429, 'RATE_LIMITED', `${label} rate-limited (429)`, 5);
      }
      throw new ProviderError(502, 'UPSTREAM_ERROR', `${label} -> ${res.status}`);
    }
  }

  /** Ranged GET whose body is drained into memory before returning.
   *
   *  The parallel path fetches segments SEGMENT_CONCURRENCY ahead of the consumer, and googlevideo
   *  drops a response body that is left unread for a few seconds — the body then ends cleanly at
   *  zero bytes, silently punching a segment-sized hole in a response whose Content-Length is
   *  already committed. So a segment must be drained the moment it lands, not lazily when its turn
   *  comes. Memory stays bounded at SEGMENT_CONCURRENCY × SEGMENT_SIZE (mirrors provider-ytdl). */
  async #readRange(
    source: MediaSource,
    start: number,
    end: number,
    label: string,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const want = end - start + 1;
    for (let attempt = 0; ; attempt++) {
      const body = await this.#fetchRange(source, start, end, label, signal);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await new Response(body).arrayBuffer());
      } catch (err) {
        if (signal.aborted || attempt >= SEGMENT_RETRIES) throw err;
        await delay(SEGMENT_RETRY_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      if (bytes.byteLength === want) return bytes;
      if (attempt >= SEGMENT_RETRIES) {
        throw new ProviderError(
          502,
          'UPSTREAM_ERROR',
          `${label} delivered ${bytes.byteLength} of ${want} bytes`,
        );
      }
      await delay(SEGMENT_RETRY_BACKOFF_MS * 2 ** attempt);
    }
  }

  // Chooses a streamable format from a single-client basic_info, preferring opus audio.
  #chooseForStream(
    info: Awaited<ReturnType<Innertube['getBasicInfo']>>,
    kind: Kind,
    itag: string | undefined,
    client: Types.InnerTubeClient,
  ): { format: StreamFormat; options: ChooseOptions } | null {
    const variants: ChooseOptions[] = itag
      ? [{ type: kind, quality: 'best', format: 'any', itag: Number(itag), client }]
      : kind === 'audio'
        ? [
            { type: 'audio', quality: 'best', format: 'any', codec: 'opus', client },
            { type: 'audio', quality: 'best', format: 'any', client },
          ]
        : [{ type: 'video', quality: 'best', format: 'any', client }];
    for (const options of variants) {
      try {
        return { format: info.chooseFormat(options) as unknown as StreamFormat, options };
      } catch {
        // try the next variant
      }
    }
    return null;
  }

  // Full download split into ordered byte ranges fetched DIRECTLY from the deciphered googlevideo
  // URL — independent requests (like provider-ytdl), NOT youtubei.js's info.download() which can't
  // run concurrently on one `info` (that stalled after the first segment). At most
  // SEGMENT_CONCURRENCY segments are in flight and each is buffered whole (see #readRange), so
  // memory is bounded at SEGMENT_CONCURRENCY × SEGMENT_SIZE and chunks are emitted strictly in
  // order. Raw fetch + AbortController also makes client-disconnect cancellation real.
  async #parallelDownload(source: MediaSource, total: number): Promise<ReadableStream<Uint8Array>> {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < total; start += SEGMENT_SIZE) {
      ranges.push({ start, end: Math.min(start + SEGMENT_SIZE, total) - 1 });
    }
    let cancelled = false;
    const inflight = new Set<AbortController>();

    const fetchSeg = (r: { start: number; end: number }, i: number): Promise<Uint8Array> => {
      const ac = new AbortController();
      inflight.add(ac);
      return this.#readRange(source, r.start, r.end, `segment ${i}`, ac.signal).finally(() => {
        inflight.delete(ac);
      });
    };

    // Pre-flight the FIRST and LAST ranges OUTSIDE the stream: an unrecoverable 403 must reach the
    // caller before the 200 + Content-Length are committed, or the backend just sees a truncated
    // body it cannot distinguish from a complete one.
    //
    // The last range is what makes this sound. youtubei.js sessions are regularly handed a URL
    // that serves an opening WINDOW and then 403s every offset past it — the window has been
    // observed at 1, 4, 7 and 18 MiB for different videos, while yt-dlp's URL for the very same
    // video, IP and minute serves the whole file (a client-fingerprint difference, not rate
    // limiting). Segment 0 alone proves nothing and no fixed count does either; only the far end
    // does. Both ranges are needed anyway, so the cost is one segment held in memory until the
    // end, and a would-be truncated download becomes a clean failure that falls through to the
    // next client and then to provider-ytdl. The caller only takes this path when
    // total > MIN_PARALLEL_SIZE, so the two indices are always distinct.
    const lastIdx = ranges.length - 1;
    const [firstBytes, lastBytes] = await Promise.all([
      fetchSeg(ranges[0] as { start: number; end: number }, 0),
      fetchSeg(ranges[lastIdx] as { start: number; end: number }, lastIdx),
    ]);

    const pending = new Map<number, Promise<Uint8Array>>([
      [0, Promise.resolve(firstBytes)],
      [lastIdx, Promise.resolve(lastBytes)],
    ]);
    const schedule = (i: number): void => {
      const r = ranges[i];
      // `pending.has` keeps the read-ahead from re-fetching the pre-flighted last segment.
      if (!r || pending.has(i)) return;
      const p = fetchSeg(r, i);
      // Swallow rejection on this side-chain so a segment cancelled before it's read doesn't
      // surface as an unhandled rejection; pull() still observes errors when it awaits `p`.
      p.catch(() => undefined);
      pending.set(i, p);
    };
    for (let i = 1; i < Math.min(SEGMENT_CONCURRENCY, ranges.length); i++) schedule(i);
    let nextIdx = 0;

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (cancelled || nextIdx >= ranges.length) {
          controller.close();
          return;
        }
        const cur = nextIdx++;
        const promise = pending.get(cur);
        if (!promise) {
          // Unreachable: every index < ranges.length is scheduled before it is pulled. Erroring
          // (not closing) keeps a logic slip from silently shipping a short body.
          controller.error(
            new ProviderError(502, 'UPSTREAM_ERROR', `segment ${cur} not scheduled`),
          );
          return;
        }
        pending.delete(cur);
        // Keep the pool warm: schedule the segment CONCURRENCY ahead of the consumer.
        if (!cancelled) schedule(cur + SEGMENT_CONCURRENCY);
        try {
          const bytes = await promise;
          if (!cancelled) controller.enqueue(bytes);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(): void {
        // Client disconnect: abort every in-flight/pending segment fetch.
        cancelled = true;
        for (const ac of inflight) ac.abort();
        inflight.clear();
        pending.clear();
      },
    });
  }

  // --- internals -------------------------------------------------------------------------

  async #getInfo(videoId: string) {
    const cached = this.#infoCache.get(videoId);
    if (cached && Date.now() - cached.ts < INFO_TTL_MS) {
      // Touch for recency.
      this.#infoCache.delete(videoId);
      this.#infoCache.set(videoId, cached);
      return cached.info;
    }
    const yt = await this.#innertube();
    let info;
    try {
      info = await yt.getInfo(videoId);
    } catch (err) {
      // Session-expired errors invalidate the cached Innertube + info cache, then surface as
      // UPSTREAM_ERROR (not VIDEO_NOT_FOUND — the video may still be valid).
      if (this.#isSessionExpired(err)) {
        this.#resetInstance();
        throw new ProviderError(502, 'UPSTREAM_ERROR', (err as Error).message ?? 'session expired');
      }
      // A bot-check means YouTube is challenging this egress IP, not that the video is gone —
      // report it as a retryable rate-limit so the backend backs off and fails over rather than
      // recording the video as permanently unavailable.
      if (this.#isBotCheck(err)) {
        throw new ProviderError(429, 'RATE_LIMITED', (err as Error).message ?? 'bot check', 5);
      }
      throw this.#classify(err, 'VIDEO_NOT_FOUND');
    }
    const status = info.playability_status?.status;
    if (status && !PLAYABLE_STATUSES.has(status)) {
      const reason = info.playability_status?.reason || `video not playable: ${status}`;
      if (this.#isBotCheckStatus(info)) {
        throw new ProviderError(429, 'RATE_LIMITED', reason, 5);
      }
      throw new ProviderError(404, 'VIDEO_NOT_FOUND', reason);
    }
    if (this.#infoCache.size >= INFO_MAX_ENTRIES) {
      const oldest = this.#infoCache.keys().next().value;
      if (oldest !== undefined) this.#infoCache.delete(oldest);
    }
    this.#infoCache.set(videoId, { ts: Date.now(), info });
    return info;
  }

  #isSessionExpired(err: unknown): boolean {
    const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return SESSION_EXPIRED_HINTS.some((hint) => message.includes(hint));
  }

  // Prefer opus/webm for audio (best quality + our "WEBA original"); fall back otherwise.
  #chooseBest(
    info: Awaited<ReturnType<Innertube['getInfo']>>,
    kind: Kind,
  ): { format: YtFormat; options: ChooseOptions } | null {
    const variants: ChooseOptions[] =
      kind === 'audio'
        ? [
            { type: 'audio', quality: 'best', format: 'any', codec: 'opus' },
            { type: 'audio', quality: 'best', format: 'any' },
          ]
        : [{ type: 'video', quality: 'best', format: 'any' }];
    for (const options of variants) {
      try {
        return { format: info.chooseFormat(options) as unknown as YtFormat, options };
      } catch {
        // try the next variant
      }
    }
    return null;
  }

  #classify(err: unknown, notFoundCode: ProviderErrorCode): ProviderError {
    const message = err instanceof Error ? err.message : String(err);
    const lowered = message.toLowerCase();
    if (NOT_FOUND_HINTS.some((hint) => lowered.includes(hint))) {
      return new ProviderError(404, notFoundCode, message);
    }
    if (RATE_LIMIT_HINTS.some((hint) => lowered.includes(hint))) {
      return new ProviderError(429, 'RATE_LIMITED', message, 5);
    }
    return new ProviderError(502, 'UPSTREAM_ERROR', message);
  }

  /** Tier 2: shed NEW extraction work when the event loop is saturated. In-flight byte
   *  streaming is I/O-bound and unaffected. 429 + short Retry-After → the backend backs off and
   *  may fall back; the same signal degrades /ready so K8s drains the pod. */
  #rejectIfSaturated(): void {
    if (saturation.saturated) {
      throw new ProviderError(
        429,
        'RATE_LIMITED',
        `provider saturated (event-loop p99 lag ${saturation.lagMs}ms > ${saturation.budgetMs}ms)`,
        1,
      );
    }
  }
}

// --- pure helpers ----------------------------------------------------------------------------

function dropUndefined<T extends object>(obj: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapCodec(codecs: string): string | undefined {
  const c = codecs.toLowerCase();
  if (!c) return undefined;
  if (c.startsWith('opus')) return 'opus';
  if (c.startsWith('mp4a')) return 'mp4a';
  if (c.startsWith('vp9') || c.startsWith('vp09')) return 'vp9';
  if (c.startsWith('av01')) return 'av01';
  if (c.startsWith('avc')) return 'avc';
  return c.split('.')[0];
}

function describe(
  format: YtFormat,
  kind: Kind,
): { container: string; ext: string; codec: string | undefined } {
  const subtype = (format.mime_type.split(';')[0] ?? '').trim().split('/')[1] ?? '';
  const container = subtype === 'webm' ? 'webm' : 'mp4';
  const ext =
    container === 'webm' ? (kind === 'audio' ? 'weba' : 'webm') : kind === 'audio' ? 'm4a' : 'mp4';
  const codecsMatch = /codecs="([^"]+)"/.exec(format.mime_type);
  return { container, ext, codec: mapCodec(codecsMatch?.[1] ?? '') };
}

function toFormatDto(format: YtFormat, kind: Kind): FormatDto {
  const { container, ext, codec } = describe(format, kind);
  const dto: FormatDto = { itag: format.itag, ext, container };
  if (codec) dto.codec = codec;
  if (kind === 'audio') {
    const bitrate = format.bitrate || format.average_bitrate;
    if (bitrate) dto.bitrate = bitrate;
  } else {
    if (format.width) dto.width = format.width;
    if (format.height) dto.height = format.height;
    if (format.fps) dto.fps = format.fps;
  }
  if (format.content_length) dto.contentLength = format.content_length;
  return dto;
}

function stripDatePrefix(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/^(Premiered|Streamed live on|Started streaming on|Uploaded on)\s+/i, '')
    .trim();
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Use local components: the source is a naive calendar date, so avoid UTC tz shifts.
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseRange(
  header: string | undefined,
  total: number,
): { start: number; end: number } | null {
  if (!header) return null;
  // Handle three RFC 9110 forms:
  //   bytes=N-M     standard
  //   bytes=N-      open-ended (must know total)
  //   bytes=-N      suffix (last N bytes; must know total)
  const trimmed = header.trim();
  const suffix = /^bytes=-(\d+)$/.exec(trimmed);
  if (suffix && suffix[1]) {
    if (total <= 0) return null;
    const n = Number(suffix[1]);
    if (Number.isNaN(n) || n <= 0) return null;
    const start = Math.max(0, total - n);
    return { start, end: total - 1 };
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(trimmed);
  if (!match || match[1] === undefined) return null;
  const start = Number(match[1]);
  let end: number;
  if (match[2]) {
    end = Number(match[2]);
  } else if (total > 0) {
    end = total - 1;
  } else {
    return null;
  }
  if (Number.isNaN(start) || end < start) return null;
  // Clip end to total - 1 when we know it, so a too-large client request doesn't 502.
  if (total > 0 && end > total - 1) end = total - 1;
  return { start, end };
}
