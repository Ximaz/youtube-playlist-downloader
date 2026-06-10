import { Module } from '@nestjs/common';
import {
  BatchModule,
  CacheModule,
  ConfigModule,
  JobsModule,
  ObservabilityCoreModule,
  StorageModule,
} from '@ypd/backend-core';

import { DownloadWorkerModule } from './download/download-worker.module';
import { HealthModule } from './health/health.module';
import { WorkerObservabilityModule } from './observability/observability.module';

// The worker runs the BullMQ download/convert pools and nothing user-facing. It boots the shared
// @Global infra (config/cache/storage/jobs/work-store/metrics) once, then the local worker modules.
// No Prisma (the worker never touches Postgres), no Auth, no Realtime gateway, no Swagger.
@Module({
  imports: [
    ConfigModule,
    CacheModule,
    StorageModule,
    JobsModule,
    BatchModule,
    ObservabilityCoreModule,
    DownloadWorkerModule,
    WorkerObservabilityModule,
    HealthModule,
  ],
})
export class WorkerModule {}
