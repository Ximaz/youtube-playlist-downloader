import { Module } from '@nestjs/common';
import { BatchModule, MetadataModule } from '@ypd/backend-core';

import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';

// API side of downloads: enqueue + status (DownloadService) and archive zip streaming
// (ArchiveService). The BullMQ download/convert processors, the streaming pipeline and ffmpeg live
// in the worker image (apps/worker) — this module never runs them. WorkStore (BatchModule) +
// MetadataService come from backend-core; StorageService is @Global.
@Module({
  imports: [BatchModule, MetadataModule],
  controllers: [DownloadController, ArchiveController],
  providers: [DownloadService, ArchiveService],
})
export class DownloadApiModule {}
