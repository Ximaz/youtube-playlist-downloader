import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis, { type RedisOptions } from 'iovalkey';

import { AppConfigService } from '../config/app-config.service';

/**
 * Thin typed wrapper over Valkey (iovalkey) with a split keyspace: an *ephemeral* client
 * (`cache.url`) for evictable data (metadata/negative cache, `ws:sess:`, OAuth state, the
 * Socket.IO adapter) and a *durable* client (`cache.queueUrl`) for state that must survive
 * eviction (the WorkStore `result:`/`batch:` entries and `withLock`). When the two URLs are
 * equal — the default single-`CACHE_URL` setup — the durable client aliases the ephemeral one,
 * so dev/compose opens exactly one connection and behaves identically to before the split.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis;
  private readonly durable: Redis;
  /** True only when a separate durable connection was opened (split keyspace) — so destroy
   *  quits it once and never double-quits the aliased single-client case. */
  private readonly durableIsSeparate: boolean;

  constructor(config: AppConfigService) {
    // commandTimeout bounds every command so a wedged-but-connected Valkey (RDB save, slow
    // AOF rewrite, swap) rejects fast and AllExceptionsFilter turns it into a clean 503 —
    // instead of hanging metadata reads, WorkStore lookups, WS replay and locks forever.
    // retryStrategy is capped so reconnect attempts don't back off unboundedly.
    const options: RedisOptions = {
      maxRetriesPerRequest: 3,
      commandTimeout: config.cache.commandTimeoutMs,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    };
    this.client = this.#connect(config.cache.url, 'ephemeral', options);
    if (config.cache.queueUrl === config.cache.url) {
      // Single-instance default: one connection serves both sides.
      this.durable = this.client;
      this.durableIsSeparate = false;
    } else {
      this.durable = this.#connect(config.cache.queueUrl, 'durable', options);
      this.durableIsSeparate = true;
    }
  }

  /** Open one iovalkey connection with the shared timeout/retry config + error listeners.
   *  Without an 'error' listener iovalkey would emit it as an unhandled 'error' event and
   *  could crash the process on a transient Valkey blip. */
  #connect(url: string, label: string, options: RedisOptions): Redis {
    const client = new Redis(url, options);
    client.on('error', (err) => this.logger.warn(`Valkey ${label} error: ${err.message}`));
    client.on('reconnecting', () => this.logger.warn(`Valkey ${label} reconnecting`));
    client.on('end', () => this.logger.warn(`Valkey ${label} connection ended`));
    return client;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  /** Batched JSON read via MGET — one round-trip for N keys, with per-key JSON.parse on the
   *  client. Returns `null` in the slots where the key was absent or held invalid JSON. */
  async mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const values = await this.client.mget(...keys);
    return values.map((v) => {
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    });
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Cursor-based key scan — safe alternative to KEYS which is O(N) under the lock.
   *  Yields keys lazily; callers stop iterating to bound work. */
  async *scan(matchPattern: string, count = 100): AsyncGenerator<string> {
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', matchPattern, 'COUNT', count);
      cursor = next;
      for (const key of batch) yield key;
    } while (cursor !== '0');
  }

  /** Pipelined batch DEL — used after `scan()` to drop many keys in one round-trip. */
  async delMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.del(...keys);
  }

  // ---- Durable side (cache.queueUrl) — WorkStore state that must survive eviction. -------------

  /** JSON GET on the durable client. */
  async durableGetJson<T>(key: string): Promise<T | null> {
    const value = await this.durable.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  /** Batched JSON read via MGET on the durable client — one round-trip for N keys. Returns
   *  `null` in slots where the key was absent or held invalid JSON. */
  async durableMgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const values = await this.durable.mget(...keys);
    return values.map((v) => {
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    });
  }

  /** JSON SET with TTL on the durable client. */
  async durableSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.durable.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /** Per-key mutex backed by SET NX EX. Runs `fn` exactly once across racing callers within
   *  `ttlMs`; losers either wait briefly and retry once, or — if still locked — proceed
   *  optimistically (the winner's mutation will be visible by then in most workloads).
   *  Releases the lock in finally so a thrown `fn` doesn't pin the lock for its full TTL. */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    // Locks live on the durable client: a lock must not be evicted out from under its holder.
    const token = String(Date.now()) + Math.random();
    const acquired = await this.durable.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired === 'OK') {
      try {
        return await fn();
      } finally {
        // Only DEL if we still own the lock (avoid racing past TTL expiry).
        const current = await this.durable.get(key);
        if (current === token) await this.durable.del(key);
      }
    }
    // Loser path: brief wait then run anyway. The winner's update will usually be visible.
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    return fn();
  }

  async onModuleDestroy(): Promise<void> {
    // Best-effort, independent quits (matches RedisIoAdapter.disconnect): a rejected quit on one
    // client — a wedged Valkey can reject under the commandTimeout during shutdown — must not skip
    // closing the other. durableIsSeparate guards the aliased single-connection default.
    await Promise.allSettled([
      this.client.quit(),
      this.durableIsSeparate ? this.durable.quit() : Promise.resolve(),
    ]);
  }
}
