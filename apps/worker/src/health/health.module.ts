import { Module } from '@nestjs/common';
import { ProvidersModule } from '@ypd/backend-core';

import { HealthController } from './health.controller';

// /health + /ready probes. ProvidersModule supplies ProviderRegistry for the readiness check;
// CacheService + StorageService come from the @Global cache/storage modules booted at the root.
@Module({
  imports: [ProvidersModule],
  controllers: [HealthController],
})
export class HealthModule {}
