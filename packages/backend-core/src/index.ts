// Public barrel for @ypd/backend-core — shared NestJS infrastructure consumed by both the
// API (apps/backend) and worker (apps/worker) images. Keeps each module/service granular so each
// app composes exactly the subset it needs.

// Config
export * from './config/configuration';
export { default as configuration } from './config/configuration';
export * from './config/app-config.service';
export * from './config/config.module';

// Cache (Valkey)
export * from './cache/cache.service';
export * from './cache/cache.module';

// Storage (S3)
export * from './storage/storage.service';
export * from './storage/storage.module';

// Jobs (BullMQ connection, queue names, job payload types)
export * from './jobs/job.types';
export * from './jobs/redis-connection';
export * from './jobs/jobs.module';

// Providers (ordered-fallback metadata + stream client)
export * from './providers/provider-registry.service';
export * from './providers/provider-client.service';
export * from './providers/providers.module';

// Metadata (cache-aside service; HTTP controllers live in the API app)
export * from './metadata/metadata.service';
export * from './metadata/metadata.module';

// Work store + deliverable domain (Valkey-backed shared state)
export * from './workstore/work-store.service';
export * from './workstore/batch.module';
export * from './workstore/deliverable';

// Observability (shared metrics registry/service; controllers per-app)
export * from './observability/metrics.service';
export * from './observability/observability-core.module';
