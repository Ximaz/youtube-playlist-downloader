import { Module } from '@nestjs/common';
import { MetadataModule as MetadataCoreModule } from '@ypd/backend-core';

import { AuthModule } from '../auth/auth.module';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';
import { VideosController } from './videos.controller';
import { YouTubeDataService } from './youtube-data.service';

// API HTTP surface for metadata: GET /videos/:id, GET /playlists and GET /playlists/:id. The
// token-free cache-aside MetadataService comes from backend-core's MetadataModule (also used by
// the worker pipeline); PlaylistsService adds the authenticated path (the official Data API via
// YouTubeDataService) and picks between the two per request. AuthModule is imported so
// PlaylistsService can inject AuthService for token vending + the signed-in check.
@Module({
  imports: [MetadataCoreModule, AuthModule],
  controllers: [VideosController, PlaylistsController],
  providers: [PlaylistsService, YouTubeDataService],
})
export class MetadataModule {}
