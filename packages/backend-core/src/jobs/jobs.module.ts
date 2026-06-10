import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';
import { CONVERT_QUEUE, DOWNLOAD_QUEUE } from './job.types';
import { parseRedisUrl } from './redis-connection';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: { ...parseRedisUrl(config.cache.url), maxRetriesPerRequest: null },
      }),
    }),
    BullModule.registerQueue({ name: DOWNLOAD_QUEUE }, { name: CONVERT_QUEUE }),
  ],
  exports: [BullModule],
})
export class JobsModule {}
