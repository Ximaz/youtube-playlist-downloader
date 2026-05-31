import { Innertube, type Types } from 'youtubei.js';

import { ProviderError, type ProviderErrorCode } from './errors.js';

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
  videoIds: string[];
  /** videoId → title, carried free from the playlist items so the UI can label rows up front. */
  videoTitles?: Record<string, string>;
}

interface StreamResult {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
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

  // --- public API ------------------------------------------------------------------------

  async getVideoMetadata(videoId: string): Promise<VideoDto> {
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
    const yt = await this.#innertube();
    let page;
    try {
      page = await yt.getPlaylist(playlistId);
    } catch (err) {
      throw this.#classify(err, 'PLAYLIST_NOT_FOUND');
    }

    const title = page.info.title;
    const author = page.info.author?.name;
    const videoIds: string[] = [];
    // youtubei.js PlaylistVideo.title is a `Text` node (`.text`); capture it free for the UI.
    const videoTitles: Record<string, string> = {};
    const collect = (items: readonly unknown[]): void => {
      for (const item of items) {
        const { id, title: itemTitle } = item as { id?: string; title?: { text?: string } };
        if (!id) continue;
        videoIds.push(id);
        if (itemTitle?.text) videoTitles[id] = itemTitle.text;
      }
    };

    collect(page.items);
    while (page.has_continuation) {
      try {
        page = await page.getContinuation();
      } catch (err) {
        // Mid-pagination failures (playlist deleted between pages, transient upstream)
        // shouldn't drop the videoIds we've already collected — surface a precise error
        // instead of letting collect() bubble an unclassified UPSTREAM_ERROR.
        throw this.#classify(err, 'PLAYLIST_NOT_FOUND');
      }
      collect(page.items);
    }

    const dto: PlaylistDto = { id: playlistId, videoIds };
    if (title) dto.title = title;
    if (author) dto.author = author;
    if (Object.keys(videoTitles).length) dto.videoTitles = videoTitles;
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

    const yt = await this.#innertube();
    // Track distinct per-client failure categories so the user/caller learns *why* every
    // STREAM_CLIENTS choice failed, not just the last error's message.
    let sawNoPlayable = false;
    let sawNoFormat = false;
    let sawNetworkError: ProviderError | undefined;
    let sawSessionExpired = false;
    let lastError: unknown;

    for (const client of STREAM_CLIENTS) {
      let info: Awaited<ReturnType<Innertube['getBasicInfo']>>;
      try {
        info = await yt.getBasicInfo(videoId, { client });
      } catch (err) {
        if (this.#isSessionExpired(err)) sawSessionExpired = true;
        lastError = err;
        continue;
      }
      const status = info.playability_status?.status;
      if (status && !PLAYABLE_STATUSES.has(status)) {
        sawNoPlayable = true;
        lastError = new ProviderError(
          404,
          'VIDEO_NOT_FOUND',
          info.playability_status?.reason || `video not playable: ${status}`,
        );
        continue;
      }

      const chosen = this.#chooseForStream(info, kind, itag, client);
      if (!chosen) {
        sawNoFormat = true;
        lastError = new ProviderError(404, 'FORMAT_NOT_FOUND', `no ${kind} format available`);
        continue;
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
        // A client Range is served as-is; a full download is parallelized across byte ranges.
        if (range) {
          const body = await info.download({ ...options, range });
          headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total || '*'}`;
          headers['Content-Length'] = String(range.end - range.start + 1);
          return { status: 206, headers, body };
        }
        if (total > MIN_PARALLEL_SIZE && SEGMENT_CONCURRENCY > 1) {
          const body = this.#parallelDownload(info, options, total);
          headers['Content-Length'] = String(total);
          return { status: 200, headers, body };
        }
        const body = await info.download(options);
        if (total) headers['Content-Length'] = String(total);
        return { status: 200, headers, body };
      } catch (err) {
        if (err instanceof ProviderError) sawNetworkError = err;
        lastError = err;
        continue;
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
    throw this.#classify(lastError, 'VIDEO_NOT_FOUND');
  }

  // Chooses a streamable format from a single-client basic_info, preferring opus audio.
  #chooseForStream(
    info: Awaited<ReturnType<Innertube['getBasicInfo']>>,
    kind: Kind,
    itag: string | undefined,
    client: Types.InnerTubeClient,
  ): { format: YtFormat; options: ChooseOptions } | null {
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
        return { format: info.chooseFormat(options) as unknown as YtFormat, options };
      } catch {
        // try the next variant
      }
    }
    return null;
  }

  // Full download split into ordered byte ranges fetched concurrently from one shared `info`
  // (no extra getBasicInfo calls), to bypass YouTube's per-connection throttling.
  #parallelDownload(
    info: Awaited<ReturnType<Innertube['getBasicInfo']>>,
    options: ChooseOptions,
    total: number,
  ): ReadableStream<Uint8Array> {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < total; start += SEGMENT_SIZE) {
      ranges.push({ start, end: Math.min(start + SEGMENT_SIZE, total) - 1 });
    }
    let cancelled = false;
    // Each pending entry is the segment's ReadableStream (not its buffered bytes), so
    // memory stays at ~one segment worth instead of CONCURRENCY × SEGMENT_SIZE.
    const fetchSeg = (r: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> => {
      const p = info.download({ ...options, range: r });
      p.catch((err) => {
        if (!cancelled) {
          console.warn(
            'parallelDownload segment failed:',
            err instanceof Error ? err.message : err,
          );
        }
      });
      return p;
    };
    const pending = new Map<number, Promise<ReadableStream<Uint8Array>>>();
    ranges.slice(0, SEGMENT_CONCURRENCY).forEach((r, i) => pending.set(i, fetchSeg(r)));
    let nextIdx = 0;
    let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (cancelled) {
          controller.close();
          return;
        }
        // Advance to the next segment if needed.
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
          // Schedule the next-after segment so the pool stays warm without buffering its bytes.
          const upcoming = ranges[cur + SEGMENT_CONCURRENCY];
          if (upcoming && !cancelled) {
            pending.set(cur + SEGMENT_CONCURRENCY, fetchSeg(upcoming));
          }
          try {
            const seg = await promise;
            currentReader = seg.getReader();
          } catch (err) {
            controller.error(err);
            return;
          }
        }
        // Pull one chunk from the active segment. On end-of-segment, drop the reader so the
        // next pull advances to the next segment.
        try {
          const { value, done } = await currentReader.read();
          if (done) {
            currentReader = null;
            // No enqueue this turn; pull will be called again immediately because the
            // controller is still hungry.
            return;
          }
          if (value && !cancelled) controller.enqueue(value);
        } catch (err) {
          controller.error(err);
        }
      },
      async cancel(): Promise<void> {
        // Consumer aborted (client disconnect): drop the active reader + pending segments.
        // youtubei.js doesn't expose per-request cancellation, so in-flight fetchSeg calls
        // run to completion in the background — their results are discarded.
        cancelled = true;
        try {
          await currentReader?.cancel();
        } catch {
          // ignore
        }
        currentReader = null;
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
      throw this.#classify(err, 'VIDEO_NOT_FOUND');
    }
    const status = info.playability_status?.status;
    if (status && !PLAYABLE_STATUSES.has(status)) {
      const reason = info.playability_status?.reason || `video not playable: ${status}`;
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
    return new ProviderError(502, 'UPSTREAM_ERROR', message);
  }
}

// --- pure helpers ----------------------------------------------------------------------------

function dropUndefined<T extends object>(obj: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
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
