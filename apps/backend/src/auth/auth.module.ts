import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  // Exported so MetadataModule's PlaylistsService can inject AuthService for token vending
  // (getValidAccessToken) and the signed-in check (hasGoogleAccount).
  exports: [AuthService],
})
export class AuthModule {}
