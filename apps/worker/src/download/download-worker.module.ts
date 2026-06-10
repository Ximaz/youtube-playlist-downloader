import { Module } from '@nestjs/common';
import { BatchModule, MetadataModule, ProvidersModule } from '@ypd/backend-core';

import { ConvertProcessor } from './convert.processor';
import { DownloadProcessor } from './download.processor';
import { FfmpegService } from './ffmpeg.service';
import { PipelineService } from './pipeline.service';

// The two BullMQ WorkerHosts + the streaming/ffmpeg pipeline. MetadataService (probe/title),
// ProviderClientService (stream open) and WorkStore (result state) come from backend-core; the
// shared BullMQ connection + queues come from the @Global JobsModule. StorageService is @Global.
@Module({
  imports: [BatchModule, MetadataModule, ProvidersModule],
  providers: [DownloadProcessor, ConvertProcessor, PipelineService, FfmpegService],
})
export class DownloadWorkerModule {}
