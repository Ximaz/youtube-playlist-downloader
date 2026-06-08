import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { CacheModule } from './cache/cache.module';
import { ConfigModule } from './config/config.module';
import { DownloadModule } from './download/download.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { MetadataModule } from './metadata/metadata.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    StorageModule,
    JobsModule,
    MetadataModule,
    RealtimeModule,
    DownloadModule.register(),
    AuthModule,
    ObservabilityModule,
    HealthModule,
  ],
})
export class AppModule {}
