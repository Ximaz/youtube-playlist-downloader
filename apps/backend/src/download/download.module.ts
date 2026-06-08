import { type DynamicModule, Module } from '@nestjs/common';

import { parseAppRole } from '../config/configuration';
import { MetadataModule } from '../metadata/metadata.module';
import { ProvidersModule } from '../providers/providers.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BatchModule } from './batch.module';
import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';
import { ConvertProcessor } from './convert.processor';
import { DownloadController } from './download.controller';
import { DownloadProcessor } from './download.processor';
import { DownloadService } from './download.service';
import { FfmpegService } from './ffmpeg.service';
import { PipelineService } from './pipeline.service';

// Explicit imports: BatchModule (WorkStore), MetadataModule (probes), ProvidersModule
// (stream open), RealtimeModule (WS gateway emits into BatchModule's rooms).
//
// The two BullMQ WorkerHosts (DownloadProcessor/ConvertProcessor) are registered ONLY when this
// process runs workers (APP_ROLE worker|all). On an `api`-only process they are absent, so no
// download/ffmpeg work runs on the API event loop — the worker pool scales as its own
// deployment. The controllers + DownloadService stay everywhere so the API can enqueue and the
// (idle) worker still exposes a uniform surface; only the actual job execution is gated.
@Module({})
export class DownloadModule {
  static register(): DynamicModule {
    const runsWorkers = ['worker', 'all'].includes(parseAppRole(process.env.APP_ROLE));
    return {
      module: DownloadModule,
      imports: [BatchModule, MetadataModule, ProvidersModule, RealtimeModule],
      controllers: [DownloadController, ArchiveController],
      providers: [
        DownloadService,
        PipelineService,
        FfmpegService,
        ArchiveService,
        ...(runsWorkers ? [DownloadProcessor, ConvertProcessor] : []),
      ],
    };
  }
}
