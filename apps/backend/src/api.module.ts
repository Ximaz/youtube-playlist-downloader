import { Module } from '@nestjs/common';
import { CacheModule, ConfigModule, JobsModule, StorageModule } from '@ypd/backend-core';

import { AuthModule } from './auth/auth.module';
import { DownloadApiModule } from './download/download.module';
import { HealthModule } from './health/health.module';
import { MetadataModule } from './metadata/metadata.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';

// API image root. Boots the shared @Global infra (config/cache/storage/jobs) from backend-core, then
// the API-only feature modules: Prisma (auth + WS session lookup + migrations), the metadata/download
// HTTP controllers, the Socket.IO gateway, OAuth, observability (/metrics) and health probes. The
// BullMQ processors, pipeline and ffmpeg live in the worker image (apps/worker).
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    StorageModule,
    JobsModule,
    MetadataModule,
    RealtimeModule,
    DownloadApiModule,
    AuthModule,
    ObservabilityModule,
    HealthModule,
  ],
})
export class ApiModule {}
