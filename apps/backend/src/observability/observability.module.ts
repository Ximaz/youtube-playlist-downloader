import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { CONVERT_QUEUE, DOWNLOAD_QUEUE } from '../jobs/job.types';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { QueueDepthCollector } from './queue-depth.collector';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: DOWNLOAD_QUEUE }, { name: CONVERT_QUEUE })],
  controllers: [MetricsController],
  providers: [MetricsService, QueueDepthCollector],
  exports: [MetricsService],
})
export class ObservabilityModule {}
