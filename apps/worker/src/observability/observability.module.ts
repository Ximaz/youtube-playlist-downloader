import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONVERT_QUEUE, DOWNLOAD_QUEUE } from '@ypd/backend-core';

import { MetricsController } from './metrics.controller';
import { QueueDepthCollector } from './queue-depth.collector';

// /metrics endpoint + the BullMQ queue-depth gauge poller. registerQueue re-binds the named queues
// so @InjectQueue resolves inside the collector (JobsModule already configured the shared connection
// at root). MetricsService comes from the @Global ObservabilityCoreModule.
@Module({
  imports: [BullModule.registerQueue({ name: DOWNLOAD_QUEUE }, { name: CONVERT_QUEUE })],
  controllers: [MetricsController],
  providers: [QueueDepthCollector],
})
export class WorkerObservabilityModule {}
