import { availableParallelism } from 'node:os';

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
}

export interface CacheConfig {
  url: string;
  metadataTtlSeconds: number;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppConfig {
  port: number;
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
    },
    cache: {
      url: required('CACHE_URL'),
      metadataTtlSeconds: Number(process.env.METADATA_CACHE_TTL ?? 86400),
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
