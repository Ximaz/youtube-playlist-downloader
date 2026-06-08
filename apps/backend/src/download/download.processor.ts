import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { type VideoProgress, workJobId } from '@ypd/shared';
import { type Job, Queue } from 'bullmq';

import { AppConfigService } from '../config/app-config.service';
import {
  CONVERT_QUEUE,
  type ConvertVideoJobData,
  DOWNLOAD_QUEUE,
  type DownloadVideoJobData,
  JOB_CONVERT_VIDEO,
} from '../jobs/job.types';
import { ProvidersUnavailableError } from '../providers/provider-client.service';
import { PipelineService } from './pipeline.service';
import { type WorkResult, WorkStore } from './work-store.service';

/** Download pool: streams originals to S3. On success it either finalises a plain-original
 *  video or hands the originals off to the convert pool, then frees its slot immediately.
 *  Concurrency is set in onModuleInit from AppConfigService — the @Processor decorator's
 *  static option is read at decorator-time, which would force us back to process.env. */
// lockDuration 90s: BullMQ auto-renews the lock while a job is active, so long (hour-plus)
// downloads are fine; this only sets how long after a worker CRASH the job is considered stalled
// and re-picked by another worker replica. Higher than the 30s default to tolerate brief
// event-loop pressure without false stalls once the pool is scaled out.
@Processor(DOWNLOAD_QUEUE, { lockDuration: 90_000 })
export class DownloadProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DownloadProcessor.name);

  constructor(
    private readonly pipeline: PipelineService,
    private readonly store: WorkStore,
    @InjectQueue(CONVERT_QUEUE) private readonly convertQueue: Queue,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.worker.concurrency = this.config.downloadConcurrency;
    this.logger.log(`download pool concurrency = ${this.worker.concurrency}`);
  }

  async process(job: Job<DownloadVideoJobData>): Promise<WorkResult> {
    const { videoId, selection, format } = job.data;
    const report = (step: VideoProgress['step'], pct?: number): void => {
      void job.updateProgress({ videoId, selection, format, step, pct } satisfies VideoProgress);
    };

    try {
      const outcome = await this.pipeline.download(videoId, selection, format, report);

      if (outcome.kind === 'convert') {
        // Download done — enqueue the (deduped) ffmpeg stage and release this slot.
        await this.convertQueue.add(
          JOB_CONVERT_VIDEO,
          { videoId, selection, format, sources: outcome.sources } satisfies ConvertVideoJobData,
          {
            jobId: workJobId('cv', videoId, selection, format),
            attempts: 1,
            priority: job.opts.priority,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
        const result: WorkResult = {
          videoId,
          selection,
          format,
          status: 'convert',
          title: outcome.title,
        };
        await this.store.setResult(result);
        report('convert', 0);
        return result;
      }

      const result: WorkResult = {
        videoId,
        selection,
        format,
        status: 'done',
        title: outcome.title,
        key: outcome.key,
        ext: outcome.ext,
      };
      await this.store.setResult(result);
      void job.updateProgress({
        videoId,
        selection,
        format,
        step: 'done',
        title: outcome.title,
      } satisfies VideoProgress);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Two distinct failure modes:
      // - NotFoundException → every provider returned VIDEO_NOT_FOUND / FORMAT_NOT_FOUND.
      //   Genuinely missing upstream — terminal, mark unavailable, do NOT retry.
      // - ProvidersUnavailableError / anything else (e.g. undici 'terminated' from a throttled
      //   stream) → transport-level. Retryable.
      const unavailable =
        err instanceof NotFoundException || (err as { status?: number })?.status === 404;

      // Transient failures must THROW for BullMQ's configured attempts/backoff to engage —
      // returning a result (as this handler used to) marks the job succeeded and silently
      // defeats the retry. Persist a terminal 'failed' only once the attempts are exhausted.
      // (BullMQ 5 retries while `attemptsMade + 1 < attempts`; attemptsMade is 0-based here.)
      const attempts = job.opts.attempts ?? 1;
      if (!unavailable && attempts > job.attemptsMade + 1) {
        this.logger.warn(
          `video ${videoId} download failed (attempt ${job.attemptsMade + 1}/${attempts}), retrying: ${error}`,
        );
        throw err instanceof Error ? err : new Error(error);
      }

      if (err instanceof ProvidersUnavailableError) {
        this.logger.warn(`video ${videoId} download deferred (providers down): ${error}`);
      } else if (unavailable) {
        this.logger.warn(`video ${videoId} became unavailable while downloading: ${error}`);
      } else {
        this.logger.error(`video ${videoId} download failed after ${attempts} attempts: ${error}`);
      }
      const result: WorkResult = {
        videoId,
        selection,
        format,
        status: unavailable ? 'unavailable' : 'failed',
        error,
      };
      await this.store.setResult(result);
      void job.updateProgress({
        videoId,
        selection,
        format,
        step: result.status,
        error,
      } satisfies VideoProgress);
      return result;
    }
  }
}
