import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigService } from '@ypd/backend-core';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule);
  const config = app.get(AppConfigService);
  const logger = new Logger('WorkerBootstrap');

  // Process-level safety net. The download + convert pools run in this process, so a single stray
  // rejection — e.g. a fire-and-forget `void job.updateProgress(...)` — must not crash all of them.
  // Log every unhandledRejection; on an uncaughtException the process state is unknown, so drain
  // gracefully and exit non-zero for the orchestrator to restart.
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : reason}`);
  });
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception, shutting down: ${err.stack ?? err.message}`);
    void app.close().finally(() => process.exit(1));
  });

  // Without this, @nestjs/bullmq's worker.close() never fires on SIGTERM — in-flight jobs get
  // SIGKILL'd and BullMQ only re-runs them after the 90s stall lock. enableShutdownHooks lets the
  // pools drain (finish or cleanly abort) and close Valkey/S3 connections on every deploy.
  app.enableShutdownHooks();

  // The worker serves ONLY operational probes (/health, /ready, /metrics) over HTTP — no REST, no
  // WebSocket, no Swagger, no validation pipe. Job progress crosses to the API via the BullMQ
  // Valkey stream (job.updateProgress), which the API's QueueEvents bridge to Socket.IO.
  await app.listen(config.port, '0.0.0.0');
  logger.log(
    `YPD worker listening on :${config.port} ` +
      `(download=${config.downloadConcurrency}, convert=${config.convertConcurrency})`,
  );
}

void bootstrap();
