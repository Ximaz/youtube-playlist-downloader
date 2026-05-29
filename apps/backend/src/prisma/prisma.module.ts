import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Global because every feature that needs the database (auth today, others later)
 * imports the same PrismaService rather than re-instantiating the client/pool.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
