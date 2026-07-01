import { Innertube, type Types } from 'youtubei.js';

import { ProviderError, type ProviderErrorCode } from './errors.js';
import { poTokenMinter } from './potoken.js';
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

// Streaming requires a client that returns pre-deciphered URLs without a PO token.
// As of 2026 the WEB family no longer does; ANDROID_VR works and still offers opus.
// Override with YOUTUBEJS_STREAM_CLIENTS (comma-separated, tried in order).
const STREAM_CLIENTS = (process.env.YOUTUBEJS_STREAM_CLIENTS ?? 'ANDROID_VR,IOS')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean) as Types.InnerTubeClient[];

// Parallel ranged download: one getBasicInfo, then N concurrent range fetches to defeat
// YouTube's per-connection throttle. Keep segments small (~1 MiB): the throttle ramps up
// *within* a connection, so small ranges stay in the fast burst. Tunable via env; 1 disables.
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

/** Why one stream-client attempt failed — lets stream() aggregate the most-informative error and
 *  decide whether to escalate to a PO-token client (on `botcheck` or a download `forbidden`). */
type StreamFailure =
  | 'sessionexpired'
  | 'botcheck'
  | 'forbidden'
  | 'noformat'
  | 'notplayable'
  | 'error';
type StreamAttempt = { ok: StreamResult } | { failure: StreamFailure; error?: unknown };

/** Internal signal: googlevideo rejected the token-free media URL with 403 BEFORE any bytes, so
 *  stream() can escalate to a PO-token client instead of failing. Never leaves the module. */
class UpstreamForbidden extends Error {}

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

// Substrings / playability statuses that mean YouTube is demanding a PO-token / "prove you're
// not a bot". The DEFAULT ANDROID_VR/IOS clients don't need a token today, so on these we
// escalate per-video to a WEB client bound to a freshly-minted PO token (see potoken.ts).
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
  static readonly libraryVersion = '17.0.1';

  #instance: Innertube | null = null;
  #creating: Promise<Innertube> | null = null;
  // PO-token escalation: a WEB-client Innertube bound to a minted token, built lazily on the
  // first bot-check and reused across videos until it fails (then rebuilt). Separate from the
  // default instance so the cheap no-token path stays the norm.
  #tokenized: Innertube | null = null;
  #tokenizedCreating: Promise<Innertube> | null = null;
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

  /** Lazily build (and cache) a WEB-client Innertube bound to a minted PO token. Throws if a
   *  token can't be obtained (minter in cooldown / BotGuard failure) — the caller then gives up
   *  on that video and the backend falls back to the other provider. */
  async #tokenizedInnertube(): Promise<Innertube> {
    if (this.#tokenized) return this.#tokenized;
    if (!this.#tokenizedCreating) {
      const creating = (async () => {
        const base = await this.#innertube();
        const visitorData = base.session.context?.client?.visitorData;
        if (!visitorData) throw new Error('no visitor data available to bind a PO token');
        const { poToken } = await poTokenMinter.mint(visitorData);
        return Innertube.create({ po_token: poToken, visitor_data: visitorData });
      })();
      this.#tokenizedCreating = creating;
      creating.catch(() => {
        if (this.#tokenizedCreating === creating) this.#tokenizedCreating = null;
      });
    }
    this.#tokenized = await this.#tokenizedCreating;
    return this.#tokenized;
  }

  #resetTokenized(): void {
    this.#tokenized = null;
    this.#tokenizedCreating = null;
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

    // Default clients are token-free → a full download is a SINGLE un-ranged GET (googlevideo
    // serves only one request per token-free URL). `tokenized` stays false here.
    for (const client of STREAM_CLIENTS) {
      const outcome = await this.#attemptStreamClient(
        yt,
        videoId,
        kind,
        itag,
        rangeHeader,
        client,
        false,
      );
      if ('ok' in outcome) return outcome.ok;
      record(outcome);
    }

    // A bot-check at extraction OR a 403 on the token-free download → escalate this video to a
    // PO-token WEB client, whose authenticated URL allows fast parallel byte ranges.
    if (sawBotCheck || sawForbidden) {
      try {
        const tokenizedYt = await this.#tokenizedInnertube();
        const outcome = await this.#attemptStreamClient(
          tokenizedYt,
          videoId,
          kind,
          itag,
          rangeHeader,
          'WEB' as Types.InnerTubeClient,
          true,
        );
        if ('ok' in outcome) return outcome.ok;
        record(outcome);
      } catch (err) {
        // Minting unavailable (cooldown / BotGuard failure) — give up; backend falls back.
        this.#resetTokenized();
        lastError = err;
      }
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
    if (sawForbidden) {
      // Rejected token-free AND (if attempted) token path 403'd → clean 502 so the backend
      // cascade moves on instead of retrying an unrecoverable URL.
      throw new ProviderError(502, 'UPSTREAM_ERROR', 'upstream rejected media URL (403)');
    }
    throw this.#classify(lastError, 'VIDEO_NOT_FOUND');
  }

  /** One stream attempt against a single client. Returns the StreamResult on success or a
   *  categorized failure (so stream() can aggregate + decide on PO-token escalation). The
   *  download logic is identical for the default clients and the tokenized WEB retry. */
  async #attemptStreamClient(
    yt: Innertube,
    videoId: string,
    kind: Kind,
    itag: string | undefined,
    rangeHeader: string | undefined,
    client: Types.InnerTubeClient,
    tokenized: boolean,
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
      // A client Range is a single ranged request — serve as-is.
      if (range) {
        const body = await info.download({ ...options, range });
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total || '*'}`;
        headers['Content-Length'] = String(range.end - range.start + 1);
        return { ok: { status: 206, headers, body } };
      }
      const url = await format.decipher(yt.session.player);
      // TOKENIZED (authenticated) client: its URL allows multiple/range requests → fetch byte
      // ranges directly (fast). youtubei.js's info.download() can't run concurrently on one `info`.
      if (tokenized && url && total > MIN_PARALLEL_SIZE && SEGMENT_CONCURRENCY > 1) {
        const body = this.#parallelDownload(url, total);
        headers['Content-Length'] = String(total);
        return { ok: { status: 200, headers, body } };
      }
      // TOKEN-FREE (default) client: a SINGLE un-ranged GET — googlevideo serves only one request
      // per token-free URL (a 2nd/range request → 403). A 403 here → escalate to the token client.
      if (url) {
        const body = await this.#singleDownload(url);
        if (total) headers['Content-Length'] = String(total);
        return { ok: { status: 200, headers, body } };
      }
      // No deciphered URL (player/cipher issue) → youtubei.js's own downloader as a last resort.
      const body = await info.download(options);
      if (total) headers['Content-Length'] = String(total);
      return { ok: { status: 200, headers, body } };
    } catch (err) {
      if (err instanceof UpstreamForbidden) return { failure: 'forbidden', error: err };
      return { failure: 'error', error: err };
    }
  }

  /** Token-free full download: a SINGLE un-ranged GET of the deciphered URL (one request — all
   *  googlevideo serves on a token-free URL). A 403 signals escalation to a PO-token client;
   *  status is checked before returning the body so it never truncates a committed response. */
  async #singleDownload(url: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(url);
    if (res.status === 403) {
      await res.body?.cancel().catch(() => undefined);
      throw new UpstreamForbidden('single GET -> 403');
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new ProviderError(502, 'UPSTREAM_ERROR', `single GET -> ${res.status}`);
    }
    return res.body;
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
  // run concurrently on one `info` (that stalled after the first segment). Memory stays ~one
  // segment: each pending entry is the in-flight fetch; bodies are streamed in order, never
  // buffered ahead. Raw fetch + AbortController also makes client-disconnect cancellation real.
  #parallelDownload(url: string, total: number): ReadableStream<Uint8Array> {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < total; start += SEGMENT_SIZE) {
      ranges.push({ start, end: Math.min(start + SEGMENT_SIZE, total) - 1 });
    }
    let cancelled = false;
    const inflight = new Set<AbortController>();

    const fetchSeg = async (r: { start: number; end: number }, i: number): Promise<Response> => {
      for (let attempt = 0; ; attempt++) {
        const ac = new AbortController();
        inflight.add(ac);
        try {
          const res = await fetch(url, {
            headers: { Range: `bytes=${r.start}-${r.end}` },
            signal: ac.signal,
          });
          if (res.status === 206 || res.ok) return res;
          await res.body?.cancel().catch(() => undefined);
          const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
          if (retryable && attempt < SEGMENT_RETRIES && !cancelled) {
            await delay(SEGMENT_RETRY_BACKOFF_MS * 2 ** attempt);
            continue;
          }
          throw new ProviderError(502, 'UPSTREAM_ERROR', `segment ${i} -> ${res.status}`);
        } catch (err) {
          if (cancelled || err instanceof ProviderError) throw err;
          if (attempt < SEGMENT_RETRIES) {
            await delay(SEGMENT_RETRY_BACKOFF_MS * 2 ** attempt);
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          throw new ProviderError(
            502,
            'UPSTREAM_ERROR',
            `segment ${i} failed after retries: ${msg}`,
          );
        }
      }
    };

    const pending = new Map<number, Promise<Response>>();
    const schedule = (i: number): void => {
      const r = ranges[i];
      if (!r) return;
      const p = fetchSeg(r, i);
      // Swallow rejection on this side-chain so a segment cancelled before it's read doesn't
      // surface as an unhandled rejection; pull() still observes errors when it awaits `p`.
      p.catch(() => undefined);
      pending.set(i, p);
    };
    for (let i = 0; i < Math.min(SEGMENT_CONCURRENCY, ranges.length); i++) schedule(i);
    let nextIdx = 0;
    let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (cancelled) {
          controller.close();
          return;
        }
        // Loop until we ENQUEUE a chunk (or close/error). Returning from pull() without enqueueing
        // does NOT reliably re-invoke it, so advancing across an exhausted segment must happen
        // inside one pull() call — otherwise the stream stalls after the first segment.
        for (;;) {
          if (!currentReader) {
            if (nextIdx >= ranges.length) {
              controller.close();
              return;
            }
            const cur = nextIdx++;
            const promise = pending.get(cur);
            if (!promise) {
              controller.close();
              return;
            }
            pending.delete(cur);
            // Keep the pool warm: schedule the segment CONCURRENCY ahead, without buffering bytes.
            if (!cancelled) schedule(cur + SEGMENT_CONCURRENCY);
            try {
              const res = await promise;
              if (!res.body) {
                controller.close();
                return;
              }
              currentReader = res.body.getReader();
            } catch (err) {
              controller.error(err);
              return;
            }
          }
          try {
            const { value, done } = await currentReader.read();
            if (done) {
              currentReader = null;
              continue; // segment exhausted → advance to the next one in this same pull()
            }
            if (value && !cancelled) {
              controller.enqueue(value);
              return;
            }
          } catch (err) {
            controller.error(err);
            return;
          }
        }
      },
      async cancel(): Promise<void> {
        // Client disconnect: abort the active reader + every in-flight/pending segment fetch.
        cancelled = true;
        try {
          await currentReader?.cancel();
        } catch {
          // ignore
        }
        currentReader = null;
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
      // Bot-check on the default client → escalate this video to a PO-token WEB client.
      if (this.#isBotCheck(err)) info = await this.#getInfoTokenized(videoId);
      else throw this.#classify(err, 'VIDEO_NOT_FOUND');
    }
    let status = info.playability_status?.status;
    if (status && !PLAYABLE_STATUSES.has(status)) {
      // A LOGIN_REQUIRED / "not a bot" status is the other way a bot-check surfaces — retry once
      // with the PO-token client before declaring the video unavailable.
      if (this.#isBotCheckStatus(info)) {
        info = await this.#getInfoTokenized(videoId);
        status = info.playability_status?.status;
      }
      if (status && !PLAYABLE_STATUSES.has(status)) {
        const reason = info.playability_status?.reason || `video not playable: ${status}`;
        throw new ProviderError(404, 'VIDEO_NOT_FOUND', reason);
      }
    }
    if (this.#infoCache.size >= INFO_MAX_ENTRIES) {
      const oldest = this.#infoCache.keys().next().value;
      if (oldest !== undefined) this.#infoCache.delete(oldest);
    }
    this.#infoCache.set(videoId, { ts: Date.now(), info });
    return info;
  }

  /** Re-fetch getInfo on the PO-token WEB client after a bot-check. A failure to obtain a token
   *  surfaces as UPSTREAM_ERROR (retryable; backend falls back); a failure of the tokenized call
   *  itself drops the cached tokenized instance so the next escalation rebuilds it. */
  async #getInfoTokenized(videoId: string): Promise<Awaited<ReturnType<Innertube['getInfo']>>> {
    let yt: Innertube;
    try {
      yt = await this.#tokenizedInnertube();
    } catch (err) {
      throw new ProviderError(
        502,
        'UPSTREAM_ERROR',
        `PO-token escalation unavailable: ${(err as Error).message}`,
      );
    }
    try {
      return await yt.getInfo(videoId);
    } catch (err) {
      this.#resetTokenized();
      throw this.#classify(err, 'VIDEO_NOT_FOUND');
    }
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
