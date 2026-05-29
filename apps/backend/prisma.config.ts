// Prisma 7 configuration. The connection URL lives here (Prisma 7 removed `url`
// from schema.prisma); the runtime client uses the @prisma/adapter-pg driver
// instantiated inside PrismaService.
//
// `process.env.DATABASE_URL ?? ''` (NOT the prisma/config `env()` helper, which throws
// when missing) so that `prisma generate` succeeds at build time without a DB — generate
// only reads the schema. `prisma migrate deploy` at container start has DATABASE_URL set.

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
