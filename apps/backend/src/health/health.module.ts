import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ProvidersModule],
  controllers: [HealthController],
})
export class HealthModule {}
