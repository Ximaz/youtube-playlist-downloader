import { type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

import { AppConfigService } from '../config/app-config.service';

/**
 * Socket.IO adapter that pins CORS to AppConfigService.frontendOrigin and enables credentials
 * so the browser sends the `ypd_session` cookie on the WS handshake. This replaces the
 * `@WebSocketGateway({ cors: ... })` decorator option, which defaulted to `*` when the env var
 * was unset and bypassed the typed config layer entirely.
 *
 * Auth itself is enforced inside the gateway's `server.use(...)` middleware (see RealtimeGateway).
 */
export class SecureIoAdapter extends IoAdapter {
  constructor(appOrContext: INestApplicationContext) {
    super(appOrContext);
    this.config = appOrContext.get(AppConfigService);
  }

  private readonly config: AppConfigService;

  override createIOServer(
    port: number,
    options?: ServerOptions,
  ): ReturnType<IoAdapter['createIOServer']> {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.config.frontendOrigin,
        credentials: true,
      },
    });
  }
}
