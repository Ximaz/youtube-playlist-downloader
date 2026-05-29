import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { VideoProgress } from '@ypd/shared';
import type { Job } from 'bullmq';

import { AppConfigService } from '../config/app-config.service';
import { CONVERT_QUEUE, type ConvertVideoJobData } from '../jobs/job.types';
import { PipelineService } from './pipeline.service';
import { type WorkResult, WorkStore } from './work-store.service';

/** Convert pool: pulls the originals back from S3 and runs ffmpeg. Independent of the
 *  download pool, so converted/merged batches process download + convert concurrently.
 *  Concurrency set in onModuleInit from AppConfigService (see DownloadProcessor note). */
@Processor(CONVERT_QUEUE)
export class ConvertProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ConvertProcessor.name);

  constructor(
    private readonly pipeline: PipelineService,
    private readonly store: WorkStore,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.worker.concurrency = this.config.convertConcurrency;
    this.logger.log(`convert pool concurrency = ${this.worker.concurrency}`);
  }

  async process(job: Job<ConvertVideoJobData>): Promise<WorkResult> {
    const { videoId, selection, format, sources } = job.data;
    const report = (step: VideoProgress['step'], pct?: number): void => {
      void job.updateProgress({ videoId, selection, format, step, pct } satisfies VideoProgress);
    };

    let result: WorkResult;
    try {
      const out = await this.pipeline.convert(videoId, selection, format, sources, report);
      result = {
        videoId,
        selection,
        format,
        status: 'done',
        title: out.title,
        key: out.key,
        ext: out.ext,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`video ${videoId} convert failed: ${error}`);
      result = { videoId, selection, format, status: 'failed', error };
    }

    await this.store.setResult(result);
    void job.updateProgress({
      videoId,
      selection,
      format,
      step: result.status,
      title: result.title,
      error: result.error,
    } satisfies VideoProgress);
    return result;
  }
}
