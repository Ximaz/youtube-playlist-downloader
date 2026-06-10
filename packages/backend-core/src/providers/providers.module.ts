import { Module } from '@nestjs/common';

import { ProviderClientService } from './provider-client.service';
import { ProviderRegistry } from './provider-registry.service';

// Explicit-imports only — was @Global() but the audit confirmed the graph is acyclic
// (only MetadataModule + DownloadModule consume it). Reserving @Global() for true infra.
@Module({
  providers: [ProviderRegistry, ProviderClientService],
  exports: [ProviderClientService, ProviderRegistry],
})
export class ProvidersModule {}
