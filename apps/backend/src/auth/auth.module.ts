import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionCookieService } from './session-cookie.service';
import { YouTubeDataService } from './youtube-data.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionCookieService, YouTubeDataService],
})
export class AuthModule {}
