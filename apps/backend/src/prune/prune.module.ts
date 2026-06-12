import { Module } from '@nestjs/common';
import { CacheModule, ConfigModule } from '@ypd/backend-core';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

// Minimal root module for the anonymous-session GC CronJob (main.prune.ts). It pulls only what
// AuthService.pruneAnonymousSessions needs — config, Prisma, cache — and deliberately NOT the
// HTTP server, Socket.IO gateway or BullMQ stack the API image boots, so the job starts fast and
// touches nothing it shouldn't.
@Module({
  imports: [ConfigModule, PrismaModule, CacheModule, AuthModule],
})
export class PruneModule {}
