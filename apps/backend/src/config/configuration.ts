import { availableParallelism } from 'node:os';

/** Process role. `api` serves HTTP + the WebSocket gateway and enqueues work but runs NO BullMQ
 *  workers; `worker` runs the download/convert pools (and a metrics/health HTTP surface) but no
 *  user-facing gateway fan-out; `all` is both in one process (the default — keeps `docker
 *  compose up` and local dev a single container). Lets the worker pool scale independently of
 *  the API tier so ffmpeg/CPU never contends with request latency. */
export type AppRole = 'api' | 'worker' | 'all';

export function parseAppRole(value: string | undefined): AppRole {
  return value === 'api' || value === 'worker' ? value : 'all';
}

export interface ProvidersConfig {
  order: string[];
  urls: Record<string, string>;
  timeoutMs: number;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
  /** TCP connect timeout (ms) — a hung S3 must not stall a worker until the OS TCP timeout. */
  connectionTimeoutMs: number;
  /** Per-request socket timeout (ms) once connected. */
  requestTimeoutMs: number;
  /** SDK retry attempts (standard mode). */
  maxAttempts: number;
}

export interface CacheConfig {
  url: string;
  metadataTtlSeconds: number;
  /** Per-command timeout (ms): a wedged-but-connected Valkey rejects fast instead of hanging
   *  every code path forever (iovalkey defaults to enableOfflineQueue + no command timeout). */
  commandTimeoutMs: number;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppConfig {
  port: number;
  appRole: AppRole;
  publicBaseUrl: string;
  frontendOrigin: string;
  /** I/O-bound; each worker spends most of its time piping bytes to S3 — many cheap. */
  downloadConcurrency: number;
  /** CPU-bound; ffmpeg already uses all cores per process, so spawn ~cores/2 in parallel. */
  convertConcurrency: number;
  databaseUrl: string;
  providers: ProvidersConfig;
  storage: StorageConfig;
  cache: CacheConfig;
  google: GoogleOAuthConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function providerUrls(order: string[]): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const name of order) {
    urls[name] = required(`PROVIDER_${name.toUpperCase()}_URL`);
  }
  return urls;
}

export default (): AppConfig => {
  const order = (process.env.PROVIDER_ORDER ?? 'ytdl,youtubejs')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // node:os.availableParallelism (Node 20+) reports the effective parallelism for the process
  // (respects cgroups in containers), unlike cpus().length which reports the host.
  const cpus = availableParallelism();

  return {
    port: Number(process.env.BACKEND_PORT ?? 3000),
    appRole: parseAppRole(process.env.APP_ROLE),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
    frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:8080',
    downloadConcurrency: Number(process.env.DOWNLOAD_CONCURRENCY ?? 6),
    convertConcurrency: Number(
      process.env.CONVERT_CONCURRENCY ?? Math.max(1, Math.floor(cpus / 2)),
    ),
    databaseUrl: process.env.DATABASE_URL ?? '',
    providers: {
      order,
      urls: providerUrls(order),
      timeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS ?? 15000),
    },
    storage: {
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKey: required('S3_ACCESS_KEY'),
      secretKey: required('S3_SECRET_KEY'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      connectionTimeoutMs: Number(process.env.S3_CONNECTION_TIMEOUT_MS ?? 3000),
      requestTimeoutMs: Number(process.env.S3_REQUEST_TIMEOUT_MS ?? 30000),
      maxAttempts: Number(process.env.S3_MAX_ATTEMPTS ?? 3),
    },
    cache: {
      url: required('CACHE_URL'),
      metadataTtlSeconds: Number(process.env.METADATA_CACHE_TTL ?? 86400),
      commandTimeoutMs: Number(process.env.CACHE_COMMAND_TIMEOUT_MS ?? 5000),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      // The OAuth callback lands on the frontend BFF (/api/auth/google/callback), not the backend.
      redirectUri:
        process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:8080/api/auth/google/callback',
    },
  };
};
