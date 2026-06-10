import { Module } from '@nestjs/common';
import { MetadataModule as MetadataCoreModule } from '@ypd/backend-core';

import { PlaylistsController } from './playlists.controller';
import { VideosController } from './videos.controller';

// API HTTP surface for metadata: GET /videos/:id and GET /playlists/:id. The cache-aside
// MetadataService is provided by backend-core's MetadataModule (also used by the worker pipeline);
// this module only adds the two read-only controllers.
@Module({
  imports: [MetadataCoreModule],
  controllers: [VideosController, PlaylistsController],
})
export class MetadataModule {}
