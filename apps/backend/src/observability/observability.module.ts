import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONVERT_QUEUE, DOWNLOAD_QUEUE, ObservabilityCoreModule } from '@ypd/backend-core';

import { MetricsController } from './metrics.controller';
import { WorkersCollector } from './workers.collector';

// API metrics surface: the Swagger-excluded /metrics controller + the fleet-size collector
// (bullmq_workers_connected). MetricsService + the gauges + the process-default metrics live in
// backend-core's @Global ObservabilityCoreModule. The API does NOT run the queue-depth collector
// (job status is served from WorkStore/Valkey, not BullMQ counts) but DOES report the connected
// worker count, which only the queue-holding API can see centrally. registerQueue binds the named
// queues so @InjectQueue resolves inside the collector.
@Module({
  imports: [
    ObservabilityCoreModule,
    BullModule.registerQueue({ name: DOWNLOAD_QUEUE }, { name: CONVERT_QUEUE }),
  ],
  controllers: [MetricsController],
  providers: [WorkersCollector],
})
export class ObservabilityModule {}
