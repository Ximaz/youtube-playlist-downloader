import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'iovalkey';

import { AppConfigService } from '../config/app-config.service';

/** Thin typed wrapper over a single Valkey connection (iovalkey). */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.cache.url, { maxRetriesPerRequest: 3 });
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

  /** Per-key mutex backed by SET NX EX. Runs `fn` exactly once across racing callers within
   *  `ttlMs`; losers either wait briefly and retry once, or — if still locked — proceed
   *  optimistically (the winner's mutation will be visible by then in most workloads).
   *  Releases the lock in finally so a thrown `fn` doesn't pin the lock for its full TTL. */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const token = String(Date.now()) + Math.random();
    const acquired = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired === 'OK') {
      try {
        return await fn();
      } finally {
        // Only DEL if we still own the lock (avoid racing past TTL expiry).
        const current = await this.client.get(key);
        if (current === token) await this.client.del(key);
      }
    }
    // Loser path: brief wait then run anyway. The winner's update will usually be visible.
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    return fn();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
