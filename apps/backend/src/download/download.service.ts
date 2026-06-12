import { randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  type DownloadRequest,
  type DownloadResponse,
  type MediaSelection,
  type OutputFormat,
  type VideoProgress,
  type VideoStep,
  type WorkSelector,
  workJobId,
} from '@ypd/shared';
import { Queue } from 'bullmq';

import pLimit from 'p-limit';

import {
  CONVERT_QUEUE,
  type Deliverable,
  deliverableCandidates,
  DOWNLOAD_QUEUE,
  JOB_DOWNLOAD_VIDEO,
  MetadataService,
  ProvidersUnavailableError,
  StorageService,
  WorkStore,
} from '@ypd/backend-core';

const PREFILTER_CONCURRENCY = 16;
const PROBE_CONCURRENCY = 16;
// BullMQ priorities are positive ints (lower = sooner); unknown-duration videos go last.
const MAX_PRIORITY = 2_000_000;

interface CachedHit {
  videoId: string;
  deliverable: Deliverable;
}

interface ProbeResult {
  availableIds: string[];
  durationById: Map<string, number>;
  unavailableIds: string[];
}

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);

  constructor(
    @InjectQueue(DOWNLOAD_QUEUE) private readonly downloadQueue: Queue,
    @InjectQueue(CONVERT_QUEUE) private readonly convertQueue: Queue,
    private readonly metadata: MetadataService,
    private readonly storage: StorageService,
    private readonly store: WorkStore,
  ) {}

  async enqueue(req: DownloadRequest, sessionId?: string): Promise<DownloadResponse> {
    // DownloadRequestSchema.refine guarantees one of playlistId/videoIds is present (clean 400
    // at the pipe). The remaining "empty playlist resolved to zero videos" case stays here.
    const videoIds = await this.#resolveVideoIds(req);
    if (videoIds.length === 0) {
      throw new BadRequestException('Resolved to zero videos (empty playlist).');
    }
    const { selection, format } = req;

    // Pre-flight: probe every video so unavailable ones are excluded up front (stable X/Y)
    // and we learn durations to schedule shortest-first.
    const { availableIds, durationById, unavailableIds } = await this.#probe(videoIds);

    const batchId = randomUUID();
    await this.store.createBatch({
      batchId,
      videoIds: availableIds,
      selection,
      format,
      createdAt: new Date().toISOString(),
      ...(sessionId ? { sessionId } : {}),
    });
    await Promise.all(
      unavailableIds.map((videoId) =>
        this.store.setResult({ videoId, selection, format, status: 'unavailable' }),
      ),
    );

    // Anything already in S3 for the requested format is recorded done up front.
    const { cached, missing } = await this.#partitionCached(availableIds, selection, format);
    await Promise.all(cached.map((hit) => this.#recordCached(hit, selection, format)));

    // Also drop work items whose WorkStore result is mid-flight ('convert') or just-completed
    // ('done') — re-clicking Download while a job is between download and convert stages
    // would otherwise race against the convert stage reading the original from S3.
    const inFlight = new Set<string>();
    const inFlightResults = await Promise.all(
      missing.map((id) => this.store.getResult(id, selection, format)),
    );
    for (let i = 0; i < missing.length; i++) {
      const r = inFlightResults[i];
      if (r && (r.status === 'convert' || r.status === 'done')) {
        const id = missing[i];
        if (id !== undefined) inFlight.add(id);
      }
    }
    const toEnqueue = missing.filter((id) => !inFlight.has(id));

    // Shortest first: a few hour-long converts shouldn't block the whole pool.
    const queued = [...toEnqueue].sort(
      (a, b) => (durationById.get(a) ?? Infinity) - (durationById.get(b) ?? Infinity),
    );

    this.logger.log(
      `batch ${batchId}: ${availableIds.length} downloadable ` +
        `(${cached.length} cached, ${queued.length} queued), ${unavailableIds.length} unavailable`,
    );

    // Deterministic jobId per work item: a re-click or another playlist with the same video
    // won't enqueue a duplicate while it's in flight.
    // attempts:3 + exponential backoff so transient provider/network blips don't permanently
    // fail a job. Convert queue stays at attempts:1 (ffmpeg is deterministic — a failure
    // there is a content issue we want to surface, not retry).
    // removeOnFail:false keeps the failure record around for inspection (BullMQ dashboards,
    // the upcoming /downloads/status route, post-mortem).
    await Promise.all(
      queued.map((videoId) =>
        this.downloadQueue.add(
          JOB_DOWNLOAD_VIDEO,
          { videoId, selection, format },
          {
            jobId: workJobId('dl', videoId, selection, format),
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            priority: durationPriority(durationById.get(videoId)),
            removeOnComplete: true,
            removeOnFail: false,
          },
        ),
      ),
    );

    return { batchId, videoIds: availableIds, unavailable: unavailableIds };
  }

  /** Resync: the current state of each requested work item (for the UI on load / after refresh).
   *  WorkStore is the source of truth — enqueue() writes results for cached/unavailable
   *  synchronously, so we don't need an S3 fallback in this hot path. A p-limit semaphore
   *  replaces the serialized 16-batch loop so the next id starts the moment any slot frees. */
  async status(selector: WorkSelector): Promise<VideoProgress[]> {
    const { selection, format } = selector;
    const limit = pLimit(PREFILTER_CONCURRENCY);
    const resolved = await Promise.all(
      selector.videoIds.map((videoId) => limit(() => this.#statusOf(videoId, selection, format))),
    );
    return resolved.filter((r): r is VideoProgress => r !== null);
  }

  async #statusOf(
    videoId: string,
    selection: MediaSelection,
    format: OutputFormat,
  ): Promise<VideoProgress | null> {
    const base = { videoId, selection, format } as const;

    const result = await this.store.getResult(videoId, selection, format);
    if (result) return { ...base, step: result.status, title: result.title, error: result.error };

    const dl = await this.#jobStep(
      this.downloadQueue,
      workJobId('dl', videoId, selection, format),
      'download',
    );
    if (dl) return { ...base, step: dl };
    const cv = await this.#jobStep(
      this.convertQueue,
      workJobId('cv', videoId, selection, format),
      'convert',
    );
    if (cv) return { ...base, step: cv };
    return null;
  }

  /** A job that exists but isn't `active` is still waiting in the queue → report `queued`,
   *  not the in-progress step (otherwise every not-yet-started video looks like it's running). */
  async #jobStep(queue: Queue, jobId: string, activeStep: VideoStep): Promise<VideoStep | null> {
    const job = await queue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return state === 'active' ? activeStep : 'queued';
  }

  async #probe(videoIds: string[]): Promise<ProbeResult> {
    const availableIds: string[] = [];
    const durationById = new Map<string, number>();
    const unavailableIds: string[] = [];

    const limit = pLimit(PROBE_CONCURRENCY);
    const checked = await Promise.all(
      videoIds.map((videoId) =>
        limit(async () => {
          try {
            const meta = await this.metadata.getVideo(videoId);
            return { videoId, duration: meta?.durationSeconds, status: 'available' as const };
          } catch (err) {
            // Distinguish "providers transiently down" from "genuinely missing upstream".
            // Transport failure → keep the video so the download stage (with attempts:3) retries.
            // 404 from every provider → exclude from the batch.
            if (err instanceof ProvidersUnavailableError) {
              return { videoId, duration: undefined, status: 'transport_error' as const };
            }
            return { videoId, duration: undefined, status: 'unavailable' as const };
          }
        }),
      ),
    );
    for (const { videoId, duration, status } of checked) {
      if (status === 'unavailable') {
        unavailableIds.push(videoId);
        continue;
      }
      availableIds.push(videoId);
      if (duration != null) durationById.set(videoId, duration);
    }
    return { availableIds, durationById, unavailableIds };
  }

  async #partitionCached(
    videoIds: string[],
    selection: MediaSelection,
    format: OutputFormat,
  ): Promise<{ cached: CachedHit[]; missing: string[] }> {
    const cached: CachedHit[] = [];
    const missing: string[] = [];
    const limit = pLimit(PREFILTER_CONCURRENCY);
    const checked = await Promise.all(
      videoIds.map((videoId) =>
        limit(async () => ({
          videoId,
          deliverable: await this.#findCached(videoId, selection, format),
        })),
      ),
    );
    for (const { videoId, deliverable } of checked) {
      if (deliverable) cached.push({ videoId, deliverable });
      else missing.push(videoId);
    }
    return { cached, missing };
  }

  async #findCached(
    videoId: string,
    selection: MediaSelection,
    format: OutputFormat,
  ): Promise<Deliverable | null> {
    for (const candidate of deliverableCandidates(videoId, selection, format)) {
      if (await this.storage.exists(candidate.key)) return candidate;
    }
    return null;
  }

  async #recordCached(
    { videoId, deliverable }: CachedHit,
    selection: MediaSelection,
    format: OutputFormat,
  ): Promise<void> {
    const meta = await this.storage
      .getJson<{ title?: string }>(`${videoId}.json`)
      .catch(() => null);
    await this.store.setResult({
      videoId,
      selection,
      format,
      status: 'cached',
      key: deliverable.key,
      ext: deliverable.ext,
      title: meta?.title ?? videoId,
    });
  }

  async #resolveVideoIds(req: DownloadRequest): Promise<string[]> {
    if (req.videoIds && req.videoIds.length > 0) return req.videoIds;
    if (req.playlistId) {
      const playlist = await this.metadata.getPlaylist(req.playlistId);
      return playlist.videos.map((v) => v.id);
    }
    return [];
  }
}

function durationPriority(seconds?: number): number {
  if (!seconds || seconds <= 0) return MAX_PRIORITY;
  return Math.min(MAX_PRIORITY, Math.max(1, Math.round(seconds)));
}
