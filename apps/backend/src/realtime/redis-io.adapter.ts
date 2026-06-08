import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'iovalkey';
import type { Server, ServerOptions } from 'socket.io';

import { parseRedisUrl } from '../jobs/redis-connection';

/**
 * Socket.IO adapter backed by the EXISTING Valkey pub/sub (reuses CACHE_URL — no new service),
 * so `server.to(room).emit(...)` reaches clients on ANY `backend-api` replica, not just the
 * local in-memory adapter. Without it, a horizontally-scaled API tier would silently drop
 * cross-pod room emits. Wired in main.ts (api role only) via `app.useWebSocketAdapter()`.
 *
 * Requires the Valkey ACL to grant `+@pubsub` (PUBLISH/SUBSCRIBE) — see docker-compose.yml.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pub?: Redis;
  private sub?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly cacheUrl: string,
  ) {
    super(app);
  }

  /** Open the pub/sub client pair and build the adapter factory. Call before createIOServer. */
  async connect(): Promise<void> {
    const conn = parseRedisUrl(this.cacheUrl);
    this.pub = new Redis(conn);
    this.sub = this.pub.duplicate();
    // Error handlers so a transient Valkey blip surfaces as a log line, not an unhandled
    // 'error' event that could crash the API process.
    this.pub.on('error', (err) => this.logger.warn(`adapter pub error: ${err.message}`));
    this.sub.on('error', (err) => this.logger.warn(`adapter sub error: ${err.message}`));
    this.adapterConstructor = createAdapter(this.pub, this.sub);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  /** Best-effort cleanup of the pub/sub clients on shutdown. */
  async disconnect(): Promise<void> {
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }
}
