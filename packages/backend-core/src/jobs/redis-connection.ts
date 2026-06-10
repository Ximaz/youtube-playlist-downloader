export interface RedisConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** Parse a redis:// URL (e.g. CACHE_URL) into BullMQ/ioredis connection options. */
export function parseRedisUrl(url: string): RedisConnection {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: decodeURIComponent(parsed.username) || undefined,
    password: decodeURIComponent(parsed.password) || undefined,
  };
}
