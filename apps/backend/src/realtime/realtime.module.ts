import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { BatchModule, CONVERT_QUEUE, DOWNLOAD_QUEUE } from '@ypd/backend-core';

import { RealtimeGateway } from './realtime.gateway';

// BullModule.registerQueue here is just a typed alias: JobsModule already configured the
// shared connection at root; this re-registers the named queues so @InjectQueue(...) inside
// RealtimeGateway resolves to the same singletons. BatchModule supplies the WorkStore.
@Module({
  imports: [
    BatchModule,
    BullModule.registerQueue({ name: DOWNLOAD_QUEUE }, { name: CONVERT_QUEUE }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
