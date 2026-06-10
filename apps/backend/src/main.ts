import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { cleanupOpenApiDoc, ZodValidationPipe } from 'nestjs-zod';

import { AppConfigService } from '@ypd/backend-core';

import { ApiModule } from './api.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

const REQUEST_ID_HEADER = 'x-ypd-request-id';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule);
  const config = app.get(AppConfigService);
  const logger = new Logger('Bootstrap');

  // Process-level safety net. The API serves HTTP + the WebSocket gateway in one process, so a
  // single stray rejection — e.g. a fire-and-forget emit in the gateway — must not silently crash
  // it. Log every unhandledRejection; on an uncaughtException the process state is unknown, so
  // drain gracefully and exit non-zero for the orchestrator to restart.
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : reason}`);
  });
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception, shutting down: ${err.stack ?? err.message}`);
    void app.close().finally(() => process.exit(1));
  });

  // Without this, OnModuleDestroy on PrismaService / CacheService / RealtimeGateway and
  // @nestjs/bullmq's worker.close() never fire on SIGTERM — in-flight jobs get SIGKILL'd
  // and dangling connections leak on every deploy.
  app.enableShutdownHooks();

  // Cross-replica WebSocket fan-out: the Valkey-backed Socket.IO adapter must be set before listen()
  // (the gateway's io server is created during init). Reuses CACHE_URL — no new service.
  const ioAdapter = new RedisIoAdapter(app, config.cache.url);
  await ioAdapter.connect();
  app.useWebSocketAdapter(ioAdapter);
  logger.log('Socket.IO Valkey adapter enabled (cross-replica room fan-out)');

  // No CORS / cookie middleware: the backend is a pure token API reached only over the internal
  // Docker network by the Nuxt BFF proxy (never a browser), and auth rides the `Authorization`
  // header. Socket.IO likewise uses the default adapter (no cross-origin handshake).
  // Adopt or mint an x-ypd-request-id so logs + downstream provider calls share a correlation
  // id. Stamped on the request object for handlers that want to forward it; echoed on the
  // response for clients/log scrapers.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    (req as Request & { ypdRequestId: string }).ypdRequestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  });
  // ZodValidationPipe replaces class-validator's ValidationPipe. Bodies/queries declared
  // with a `createZodDto(SharedSchema)` DTO are parsed by the shared Zod schema; anything
  // else passes through unchanged. Validation errors become a 400 with the Zod issue list.
  app.useGlobalPipes(new ZodValidationPipe());
  // Uniform `{ error: { code, message } }` envelope across the whole HTTP surface, matching
  // what provider-ytdl + provider-youtubejs already emit. Catches anything the pipe missed.
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('YPD API')
    .setDescription('YouTube Playlist Downloader — metadata, downloads, archive, OAuth.')
    .setVersion('0.1.0')
    .build();
  // cleanupOpenApiDoc post-processes the document for Zod-derived DTOs: rewrites schemas,
  // resolves refs, and normalizes nullable/null handling. Replaces the old patchNestjsSwagger.
  const doc = cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerConfig));
  SwaggerModule.setup('docs', app, doc);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`YPD API listening on :${config.port}`);
}

void bootstrap();
