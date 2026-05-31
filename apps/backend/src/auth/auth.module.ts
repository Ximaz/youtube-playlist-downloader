import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { YouTubeDataService } from './youtube-data.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, YouTubeDataService],
})
export class AuthModule {}
