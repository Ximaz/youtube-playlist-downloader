import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module';
import { MetadataService } from './metadata.service';

// Service-only module: the cache-aside MetadataService is shared by the API (videos/playlists
// controllers) and the worker (download pipeline). The HTTP controllers live in the API app's
// MetadataApiModule, which imports this module to inject MetadataService.
@Module({
  imports: [ProvidersModule],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
