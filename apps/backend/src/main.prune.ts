import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AuthService } from './auth/auth.service';
import { PruneModule } from './prune/prune.module';

/**
 * Standalone entrypoint for the anonymous-session GC (ADR-0014's follow-up). Boots a minimal Nest
 * application context (no HTTP listener), deletes account-less sessions older than
 * PRUNE_OLDER_THAN_DAYS (default 30), then closes — which fires the OnModuleDestroy hooks so the
 * Valkey + Postgres connections drain cleanly. The K8s CronJob runs `node dist/main.prune.js`
 * against the ypd-backend image on a schedule; locally: `node dist/main.prune.js`.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Prune');
  const olderThanDays = Number(process.env.PRUNE_OLDER_THAN_DAYS ?? 30);
  const app = await NestFactory.createApplicationContext(PruneModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const deleted = await app.get(AuthService).pruneAnonymousSessions(olderThanDays);
    logger.log(`Pruned ${deleted} anonymous session(s) older than ${olderThanDays}d`);
  } finally {
    await app.close();
  }
}

void bootstrap().then(
  () => process.exit(0),
  (err: unknown) => {
    new Logger('Prune').error(`Prune failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  },
);
