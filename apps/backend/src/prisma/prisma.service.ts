import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { AppConfigService } from '../config/app-config.service';

/**
 * Prisma 7 with the @prisma/adapter-pg driver. The connection URL lives on AppConfig
 * (DATABASE_URL); the adapter pools connections to the 'database' service. $connect /
 * $disconnect are driven by Nest's lifecycle so the pool is owned by the application
 * lifetime, not lazily by the first query.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfigService) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is required for PrismaService.');
    }
    super({ adapter: new PrismaPg(config.databaseUrl) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
