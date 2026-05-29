import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable, Logger } from '@nestjs/common';
import type { MediaSelection, OutputFormat, VideoMetadata, VideoStep } from '@ypd/shared';

import type { ConvertSource } from '../jobs/job.types';
import { MetadataService } from '../metadata/metadata.service';
import { ProviderClientService } from '../providers/provider-client.service';
import { StorageService } from '../storage/storage.service';
import {
  type Deliverable,
  fixedDeliverable,
  type MediaKind,
  mergedOriginalDeliverable,
  needsFfmpeg,
  originalKey,
  requiredKinds,
} from './deliverable';
import { FfmpegService } from './ffmpeg.service';

export type ProgressReporter = (step: VideoStep, pct?: number) => void;

export interface ConvertSources {
  video?: ConvertSource;
  audio?: ConvertSource;
}

/** Outcome of the download stage: either the original is already the deliverable, or
 *  the originals are in S3 and an ffmpeg convert stage must follow. */
export type DownloadOutcome =
  | { kind: 'final'; key: string; ext: string; title: string }
  | { kind: 'convert'; sources: ConvertSources; title: string };

const CONTENT_TYPE: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  weba: 'audio/webm',
};

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly metadata: MetadataService,
    private readonly providers: ProviderClientService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  /** Download stage: stream the required original(s) to S3. For plain originals the
   *  download is the deliverable; otherwise it hands the S3 keys to the convert stage.
   *
   *  Siblings share an AbortController: if one source fails (provider error, byte cap, S3),
   *  the others' streams are destroyed and uploads aborted instead of running to completion
   *  and orphaning bytes in S3. */
  async download(
    videoId: string,
    selection: MediaSelection,
    format: OutputFormat,
    report: ProgressReporter,
  ): Promise<DownloadOutcome> {
    report('download');
    const title = (await this.metadata.getVideo(videoId).catch(() => null))?.title ?? videoId;

    const kinds = requiredKinds(selection);
    // Aggregate byte progress across the 1–2 originals so the row shows one download %.
    const progress = new ByteProgress((pct) => report('download', pct));
    const controller = new AbortController();
    const settled = await Promise.allSettled(
      kinds.map((kind) => this.#downloadOriginal(videoId, kind, progress, controller.signal)),
    );
    const failure = settled.find((s) => s.status === 'rejected');
    if (failure) {
      controller.abort('sibling download failed');
      throw (failure as PromiseRejectedResult).reason;
    }
    const downloaded = (settled as PromiseFulfilledResult<ConvertSource>[]).map((s) => s.value);
    const byKind = Object.fromEntries(kinds.map((kind, i) => [kind, downloaded[i]])) as Record<
      MediaKind,
      ConvertSource
    >;

    if (!needsFfmpeg(selection, format)) {
      const only = downloaded[0];
      return { kind: 'final', key: only.key, ext: only.ext, title };
    }
    return { kind: 'convert', sources: { video: byKind.video, audio: byKind.audio }, title };
  }

  /** Convert stage: pull the originals back from S3, run ffmpeg, upload the deliverable. */
  async convert(
    videoId: string,
    selection: MediaSelection,
    format: OutputFormat,
    sources: ConvertSources,
    report: ProgressReporter,
  ): Promise<{ key: string; ext: string; title: string }> {
    report('convert', 0);
    const meta = await this.metadata.getVideo(videoId).catch(() => null);
    const title = meta?.title ?? videoId;
    const duration = meta?.durationSeconds;
    // merged+original is dynamic: webm if both streams fit, .mkv otherwise (matroska
    // accepts h264/aac/etc. without re-encoding). Everything else is fixed.
    const out: Deliverable | null =
      selection === 'merged' && format === 'original'
        ? mergedOriginalDeliverable(videoId, sources.video?.ext, sources.audio?.ext)
        : fixedDeliverable(videoId, selection, format);
    if (!out) throw new Error(`convert called for a non-ffmpeg request: ${selection}/${format}`);

    const dir = await mkdtemp(join(tmpdir(), `ypd-${videoId}-`));
    try {
      const localOut = join(dir, `out.${out.ext}`);
      const onProgress = (p: number): void => report('convert', p);

      if (selection === 'audio') {
        const audio = await this.#fetchOriginal(sources.audio, 'audio', dir);
        const thumb = await this.#downloadThumbnail(videoId, meta, dir);
        await this.ffmpeg.audioToM4a(audio, thumb, localOut, duration, onProgress);
      } else if (selection === 'video') {
        const video = await this.#fetchOriginal(sources.video, 'video', dir);
        await this.ffmpeg.videoToMp4(video, localOut, duration, onProgress);
      } else {
        const [video, audio] = await Promise.all([
          this.#fetchOriginal(sources.video, 'video', dir),
          this.#fetchOriginal(sources.audio, 'audio', dir),
        ]);
        if (format === 'original') {
          // ffmpeg infers the output container from `out.ext` (.webm vs .mkv).
          await this.ffmpeg.muxOriginal(video, audio, localOut, duration, onProgress);
        } else {
          await this.ffmpeg.muxToMp4(video, audio, localOut, duration, onProgress);
        }
      }

      // Keep the convert bar at 100% while S3 PUT completes — the UI shows a single
      // bar through ffmpeg + upload instead of a separate "upload" step.
      report('convert', 100);
      await this.storage.uploadStream(
        out.key,
        createReadStream(localOut),
        CONTENT_TYPE[out.ext] ?? 'application/octet-stream',
      );
      return { key: out.key, ext: out.ext, title };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Streams one original from a provider straight to S3 (reusing an existing object).
   *  Honours `signal.aborted` — used by the sibling cleanup path in `download()`. Always
   *  destroys the provider stream on failure so undici sockets return to the pool. */
  async #downloadOriginal(
    videoId: string,
    kind: MediaKind,
    progress: ByteProgress | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ConvertSource> {
    const stream = await this.providers.openStream(videoId, kind);
    const ext = stream.ext ?? (kind === 'audio' ? 'weba' : 'webm');
    const key = originalKey(videoId, kind, ext);

    if (await this.storage.exists(key)) {
      stream.stream.destroy();
      return { key, ext };
    }

    // Wire sibling abort: tearing down `stream.stream` rejects the in-flight S3 multipart
    // upload (the readable underneath erroring out causes Upload.done() to reject).
    const onAbort = (): void => {
      stream.stream.destroy(new Error('sibling download aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let body: Readable = stream.stream;
    if (progress && stream.contentLength) {
      progress.addTotal(stream.contentLength);
      const counter = new CountingStream((n) => progress.add(n));
      stream.stream.on('error', (err) => counter.destroy(err));
      body = stream.stream.pipe(counter);
    }

    // Hard byte cap: known content-length × 1.05 (small over-shoot tolerance for chunking
    // round-off), or 8 GiB absolute when unknown. Errors propagate to the S3 multipart upload.
    const cap = stream.contentLength
      ? Math.ceil(stream.contentLength * 1.05)
      : 8 * 1024 * 1024 * 1024;
    const capped = new ByteCap(cap, `${kind} original`);
    body.on('error', (err) => capped.destroy(err));
    body = body.pipe(capped);

    try {
      await this.storage.uploadStream(key, body, stream.contentType);
      return { key, ext };
    } catch (err) {
      // Destroying the source releases the upstream socket; otherwise undici keeps it out
      // of the keep-alive pool until GC, which leaks connections under sustained failures.
      stream.stream.destroy(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Pulls an original back out of S3 into a local temp file for ffmpeg. */
  async #fetchOriginal(
    source: ConvertSource | undefined,
    kind: MediaKind,
    dir: string,
  ): Promise<string> {
    if (!source) throw new Error(`missing ${kind} source for conversion`);
    const path = join(dir, `${kind}.${source.ext}`);
    await pipeline(await this.storage.getObjectStream(source.key), createWriteStream(path));
    return path;
  }

  async #downloadThumbnail(
    videoId: string,
    meta: VideoMetadata | null,
    dir: string,
  ): Promise<string | undefined> {
    const thumbnails = meta?.thumbnails ?? [];
    if (thumbnails.length === 0) return undefined;
    const best = thumbnails.reduce((a, b) =>
      (b.width ?? 0) * (b.height ?? 0) > (a.width ?? 0) * (a.height ?? 0) ? b : a,
    );
    try {
      // SSRF guard: reject anything but https + public hosts. ThumbnailSchema already
      // enforces http(s); we additionally drop plain http and private CIDRs/IP literals
      // so a malicious or compromised provider can't steer the backend at internal services.
      const url = new URL(best.url);
      if (url.protocol !== 'https:') {
        this.logger.warn(`thumbnail rejected (non-https) for ${videoId}: ${url.protocol}`);
        return undefined;
      }
      if (isPrivateHost(url.hostname)) {
        this.logger.warn(`thumbnail rejected (private host) for ${videoId}: ${url.hostname}`);
        return undefined;
      }
      const res = await fetch(url, {
        signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const path = join(dir, `${videoId}.jpg`);
      // Hard byte cap — providers can't fill the worker tmpdir with a bogus thumbnail URL.
      const capped = new ByteCap(THUMBNAIL_MAX_BYTES, 'thumbnail');
      await pipeline(Readable.fromWeb(res.body), capped, createWriteStream(path));
      return path;
    } catch (err) {
      this.logger.warn(`thumbnail download failed for ${videoId}: ${String(err)}`);
      return undefined;
    }
  }
}

const THUMBNAIL_TIMEOUT_MS = 10_000;
const THUMBNAIL_MAX_BYTES = 1 * 1024 * 1024; // 1 MiB — even high-DPI YouTube thumbnails fit comfortably.

function isPrivateHost(hostname: string): boolean {
  // Loopback + RFC 1918 + link-local + IPv6 ULA/loopback + cloud metadata (169.254.169.254).
  return (
    /^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname) ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname)
  );
}

/** Tracks bytes across one or more originals and emits an integer download % (0..99).
 *  Throttled to ~4 emissions/second AND ≥2pp moves so a fast download doesn't flood BullMQ. */
const PROGRESS_MIN_DELTA = 2;
const PROGRESS_MIN_MS = 250;
class ByteProgress {
  #total = 0;
  #received = 0;
  #last = -1;
  #lastAt = 0;
  constructor(private readonly emit: (pct: number) => void) {}

  addTotal(bytes: number): void {
    this.#total += bytes;
  }

  add(bytes: number): void {
    this.#received += bytes;
    if (this.#total <= 0) return;
    const pct = Math.min(99, Math.round((this.#received / this.#total) * 100));
    const now = Date.now();
    const delta = Math.abs(pct - this.#last);
    if (delta < PROGRESS_MIN_DELTA && now - this.#lastAt < PROGRESS_MIN_MS && pct < 99) return;
    this.#last = pct;
    this.#lastAt = now;
    this.emit(pct);
  }
}

/** Pass-through that reports the size of every chunk it forwards. */
class CountingStream extends PassThrough {
  constructor(private readonly onBytes: (n: number) => void) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ): void {
    this.onBytes(chunk.length);
    cb(null, chunk);
  }
}

/** Pass-through that errors the pipeline if total bytes exceed `cap`. Safety rail so a
 *  buggy/malicious provider can't fill local disk or S3. */
class ByteCap extends PassThrough {
  #seen = 0;
  constructor(
    private readonly cap: number,
    private readonly label: string,
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ): void {
    this.#seen += chunk.length;
    if (this.#seen > this.cap) {
      cb(new Error(`${this.label} exceeded ${this.cap} bytes`));
      return;
    }
    cb(null, chunk);
  }
}
