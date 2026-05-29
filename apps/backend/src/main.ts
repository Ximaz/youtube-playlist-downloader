import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { cleanupOpenApiDoc, ZodValidationPipe } from 'nestjs-zod';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AppConfigService } from './config/app-config.service';
import { SecureIoAdapter } from './realtime/secure-io.adapter';

const REQUEST_ID_HEADER = 'x-ypd-request-id';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  // Without this, OnModuleDestroy on PrismaService / CacheService / RealtimeGateway and
  // @nestjs/bullmq's worker.close() never fire on SIGTERM — in-flight jobs get SIGKILL'd
  // and dangling connections leak on every deploy.
  app.enableShutdownHooks();

  app.enableCors({ origin: config.frontendOrigin, credentials: true });
  // Pin Socket.IO CORS to the same origin and enable credentials so the browser sends the
  // `ypd_session` cookie on the WS handshake (the gateway middleware reads it).
  app.useWebSocketAdapter(new SecureIoAdapter(app));
  app.use(cookieParser());
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
}

void bootstrap();
