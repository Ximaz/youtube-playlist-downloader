import { Module } from '@nestjs/common';

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
@Module({
  imports: [BatchModule, MetadataModule, ProvidersModule, RealtimeModule],
  controllers: [DownloadController, ArchiveController],
  providers: [
    DownloadService,
    DownloadProcessor,
    ConvertProcessor,
    PipelineService,
    FfmpegService,
    ArchiveService,
  ],
})
export class DownloadModule {}
