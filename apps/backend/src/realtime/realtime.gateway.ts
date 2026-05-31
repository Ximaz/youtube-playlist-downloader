import { InjectQueue } from '@nestjs/bullmq';
import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { roomForWork, type VideoProgress, workJobId, WorkSelectorSchema } from '@ypd/shared';
import { QueueEvents, type Queue } from 'bullmq';
import type { Server, Socket } from 'socket.io';

import { AppConfigService } from '../config/app-config.service';
import { WorkStore } from '../download/work-store.service';
import { CONVERT_QUEUE, DOWNLOAD_QUEUE } from '../jobs/job.types';
import { parseRedisUrl } from '../jobs/redis-connection';
import { PrismaService } from '../prisma/prisma.service';

/**
 * No `cors:` option needed — the backend is reached only over the internal Docker network
 * by the Nuxt BFF proxy, never by a browser directly, so there is no cross-origin handshake.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;
  private queueEvents: QueueEvents[] = [];

  constructor(
    private readonly config: AppConfigService,
    private readonly store: WorkStore,
    private readonly prisma: PrismaService,
    @InjectQueue(DOWNLOAD_QUEUE) private readonly downloadQueue: Queue,
    @InjectQueue(CONVERT_QUEUE) private readonly convertQueue: Queue,
  ) {}

  onModuleInit(): void {
    // Token auth on the handshake: only clients carrying a valid session token can connect.
    // The Nuxt BFF proxy resolves its httpOnly cookie to the backend session token and injects
    // it as `Authorization: Bearer <token>` on the upstream handshake (it also accepts the
    // socket.io `auth.token` field). Unauthenticated handshakes are rejected before any
    // `subscribe` message is processed.
    this.server.use(async (socket, next) => {
      try {
        const sessionId = handshakeToken(socket);
        if (!sessionId) return next(new Error('unauthorized'));
        const exists = await this.prisma.session.findUnique({
          where: { id: sessionId },
          select: { id: true },
        });
        if (!exists) return next(new Error('unauthorized'));
        (socket.data as { sessionId?: string }).sessionId = sessionId;
        next();
      } catch (err) {
        this.logger.warn(`WS handshake error: ${(err as Error).message}`);
        next(new Error('unauthorized'));
      }
    });

    // BullMQ progress events from both pools → the per-work-item room. Reuses the parsed
    // Valkey URL (same shape JobsModule uses; no second hand-built connection).
    const connection = { ...parseRedisUrl(this.config.cache.url), maxRetriesPerRequest: null };
    for (const queue of [DOWNLOAD_QUEUE, CONVERT_QUEUE]) {
      const events = new QueueEvents(queue, { connection });
      events.on('progress', ({ data }) => {
        const p = data as unknown as VideoProgress;
        if (p?.videoId && p.selection && p.format) {
          this.server.to(roomForWork(p.videoId, p.selection, p.format)).emit('video:progress', p);
        }
      });
      // Without an error handler, a Valkey blip would surface as an unhandled 'error' event
      // and could crash the process under socket.io's default error propagation.
      events.on('error', (err) => {
        this.logger.warn(`QueueEvents(${queue}) error: ${err.message}`);
      });
      this.queueEvents.push(events);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.queueEvents.map((e) => e.close()));
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() raw: unknown): Promise<void> {
    // The same Zod schema POST /downloads/status validates against — single source of truth.
    const parsed = WorkSelectorSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(`WS subscribe rejected: ${parsed.error.issues[0]?.message}`);
      return;
    }
    const req = parsed.data;

    // Join rooms first so any progress event firing during the replay is captured live.
    for (const videoId of req.videoIds) {
      client.join(roomForWork(videoId, req.selection, req.format));
    }
    // Catch-up via one MGET-shaped lookup (WorkStore.getResults is the pipelined path)
    // instead of N sequential GETs.
    const results = await this.store.getResults(req);
    const haveResult = new Set<string>();
    for (const r of results) {
      haveResult.add(r.videoId);
      client.emit('video:progress', {
        videoId: r.videoId,
        selection: r.selection,
        format: r.format,
        step: r.status,
        title: r.title,
        error: r.error,
      });
    }
    // For videos with NO terminal/in-flight WorkResult, peek at the BullMQ job. The download
    // processor calls job.updateProgress({...,pct}) so a mid-flight refresh can see the actual
    // % instead of "queued" for the entire download window.
    const need = req.videoIds.filter((id) => !haveResult.has(id));
    await Promise.all(
      need.map(async (videoId) => {
        const dl = await this.#peekJobProgress(this.downloadQueue, 'dl', videoId, req);
        if (dl) {
          client.emit('video:progress', dl);
          return;
        }
        const cv = await this.#peekJobProgress(this.convertQueue, 'cv', videoId, req);
        if (cv) client.emit('video:progress', cv);
      }),
    );
  }

  /** Look up the BullMQ job by its deterministic id. If it's in flight and has a recorded
   *  progress payload, return it; otherwise undefined (the client paints 'queued' itself). */
  async #peekJobProgress(
    queue: Queue,
    stage: 'dl' | 'cv',
    videoId: string,
    req: { selection: VideoProgress['selection']; format: VideoProgress['format'] },
  ): Promise<VideoProgress | undefined> {
    const job = await queue.getJob(workJobId(stage, videoId, req.selection, req.format));
    if (!job) return undefined;
    const p = job.progress;
    if (p && typeof p === 'object' && 'videoId' in p) return p as VideoProgress;
    return undefined;
  }
}

/** Pulls the session token from the handshake: `Authorization: Bearer <token>` (injected by
 *  the Nuxt proxy) or the socket.io `auth.token` field. Returns undefined when absent. */
function handshakeToken(socket: Socket): string | undefined {
  const header = socket.handshake.headers.authorization;
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1];
  }
  const authToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  return typeof authToken === 'string' && authToken ? authToken : undefined;
}
