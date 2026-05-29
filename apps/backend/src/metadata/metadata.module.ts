import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module';
import { MetadataService } from './metadata.service';
import { PlaylistsController } from './playlists.controller';
import { VideosController } from './videos.controller';

// One controller per resource preserves the existing GET /videos/:id and GET /playlists/:id
// URLs (no client churn) while giving each path its own focused file.
@Module({
  imports: [ProvidersModule],
  controllers: [VideosController, PlaylistsController],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
