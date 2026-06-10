import { Readable } from 'node:stream';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PlaylistMetadataSchema,
  ProviderErrorEnvelopeSchema,
  type ProviderErrorCode,
  VideoMetadataSchema,
} from '@ypd/shared';
import type { PlaylistMetadata, VideoMetadata } from '@ypd/shared';
import pLimit, { type LimitFunction } from 'p-limit';
import type { z } from 'zod';

import { CacheService } from '../cache/cache.service';
import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../observability/metrics.service';
import { type MediaKind } from '../workstore/deliverable';
import { ProviderRegistry } from './provider-registry.service';

export interface ProviderStreamResult {
  provider: string;
  status: number;
  contentType: string;
  contentLength?: number;
  itag?: string;
  container?: string;
  codec?: string;
  ext?: string;
  stream: Readable;
}

/** Thrown when every configured provider failed for transport reasons (timeout / 5xx / network),
 *  i.e. **NOT** because the video is genuinely missing upstream. Callers map this to a
 *  retryable failure (`status: 'failed'`) rather than the terminal `'cached'/'unavailable'`. */
export class ProvidersUnavailableError extends Error {
  constructor(
    public readonly kind: 'video' | 'playlist' | 'stream',
    public readonly target: string,
  ) {
    super(`No provider is currently available for ${kind} ${target}`);
    this.name = 'ProvidersUnavailableError';
  }
}

/** No keep-alive idleness allowed once headers arrive: a slowloris upstream wedges a worker. */
const STREAM_INACTIVITY_MS = Number(process.env.STREAM_INACTIVITY_MS ?? 30_000);
/** Per-PROVIDER concurrency cap (was a single global). Keyed by provider name so a degraded
 *  provider holding slots open for the full timeout can't starve the healthy one, and so each
 *  provider replica fleet has its own budget. Default 16 matches the in-service batches. */
const PROVIDER_CONCURRENCY = Math.max(1, Number(process.env.PROVIDER_GLOBAL_CONCURRENCY ?? 16));
/** Circuit breaker: after this many CONSECUTIVE transport failures a provider is skipped for
 *  the cooldown window, so a hard-down provider stops costing a full timeout per request (and
 *  stops filling the concurrency budget) before fallback to the next provider. */
const BREAKER_THRESHOLD = Math.max(1, Number(process.env.PROVIDER_BREAKER_THRESHOLD ?? 5));
const BREAKER_COOLDOWN_MS = Math.max(0, Number(process.env.PROVIDER_BREAKER_COOLDOWN_MS ?? 30_000));
/** Negative-result cache (Valkey) for videoIds where every provider returned NOT_FOUND.
 *  60 s is short on purpose — a transient classification problem self-corrects soon. */
const NEG_CACHE_TTL_SECONDS = 60;
const NEG_VIDEO_KEY = (id: string): string => `provider:neg:video:${id}`;
const NEG_PLAYLIST_KEY = (id: string): string => `provider:neg:playlist:${id}`;

/**
 * Talks to the provider servers with ordered fallback: tries each provider in
 * PROVIDER_ORDER until one returns 2xx. Distinguishes "missing upstream" (NotFoundException —
 * all providers returned a NOT_FOUND envelope) from "providers down" (ProvidersUnavailableError
 * — at least one transport-level failure, none succeeded).
 */
@Injectable()
export class ProviderClientService {
  private readonly logger = new Logger(ProviderClientService.name);
  private readonly timeoutMs: number;
  /** Per-provider concurrency budgets (lazily created) — see PROVIDER_CONCURRENCY. */
  private readonly limits = new Map<string, LimitFunction>();
  /** Per-provider circuit-breaker state — see BREAKER_THRESHOLD / BREAKER_COOLDOWN_MS. */
  private readonly breaker = new Map<string, { failures: number; openUntil: number }>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly metrics: MetricsService,
    private readonly cache: CacheService,
    config: AppConfigService,
  ) {
    this.timeoutMs = config.providers.timeoutMs;
  }

  async getVideoMetadata(videoId: string): Promise<VideoMetadata> {
    if (await this.cache.get(NEG_VIDEO_KEY(videoId))) {
      throw new NotFoundException(`video ${videoId} marked not-found (negative cache)`);
    }
    return this.#requireFetch('video', videoId, async () => {
      const out = await this.#fetchJson(
        `/videos/${encodeURIComponent(videoId)}`,
        VideoMetadataSchema,
      );
      if (out.value === null && out.sawNotFound && !out.transportError) {
        await this.cache.set(NEG_VIDEO_KEY(videoId), '1', NEG_CACHE_TTL_SECONDS);
      }
      return out;
    });
  }

  async getPlaylist(playlistId: string): Promise<PlaylistMetadata> {
    if (await this.cache.get(NEG_PLAYLIST_KEY(playlistId))) {
      throw new NotFoundException(`playlist ${playlistId} marked not-found (negative cache)`);
    }
    return this.#requireFetch('playlist', playlistId, async () => {
      const out = await this.#fetchJson(
        `/playlists/${encodeURIComponent(playlistId)}`,
        PlaylistMetadataSchema,
      );
      if (out.value === null && out.sawNotFound && !out.transportError) {
        await this.cache.set(NEG_PLAYLIST_KEY(playlistId), '1', NEG_CACHE_TTL_SECONDS);
      }
      return out;
    });
  }

  /** Opens a streaming connection to the first provider that succeeds. */
  async openStream(videoId: string, kind: MediaKind, itag?: string): Promise<ProviderStreamResult> {
    let sawNotFound = false;
    let sawTransportError = false;
    for (const provider of this.registry.providers) {
      // Skip a provider whose breaker is open: don't pay the full timeout on a known-down one.
      if (this.#breakerOpen(provider.name)) {
        sawTransportError = true;
        this.metrics.providerFallbacks.inc({ from: provider.name, reason: 'circuit_open' });
        continue;
      }
      const url = new URL(`${provider.baseUrl}/videos/${encodeURIComponent(videoId)}/stream`);
      url.searchParams.set('kind', kind);
      if (itag) url.searchParams.set('itag', itag);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const endTimer = this.metrics.providerRequestDuration.startTimer({
        provider: provider.name,
        path: '/stream',
      });
      try {
        // Honour the per-provider concurrency cap so 100-video probes can't open 100 sockets per
        // provider; pLimit queues the request until a slot frees.
        const res = await this.#limitFor(provider.name)(() =>
          fetch(url, { signal: controller.signal }),
        );
        // Headers have arrived; let the (potentially long) body stream without a header timeout,
        // but install an inactivity watchdog so a stalled body releases the worker.
        clearTimeout(timer);
        endTimer({ status: statusFamily(res.status) });
        if (!res.ok || !res.body) {
          this.logger.warn(`[${provider.name}] stream ${videoId} (${kind}) -> ${res.status}`);
          const code = await this.#peekErrorCode(res);
          if (code === 'VIDEO_NOT_FOUND' || code === 'FORMAT_NOT_FOUND') {
            sawNotFound = true;
            this.#recordSuccess(provider.name); // provider is healthy; the video is just gone
          } else {
            sawTransportError = true;
            this.#recordFailure(provider.name);
          }
          this.metrics.providerFallbacks.inc({
            from: provider.name,
            reason: code ?? `http_${res.status}`,
          });
          continue;
        }
        this.#recordSuccess(provider.name);
        return {
          provider: provider.name,
          status: res.status,
          contentType: res.headers.get('content-type') ?? 'application/octet-stream',
          contentLength: this.#num(res.headers.get('content-length')),
          itag: res.headers.get('x-format-itag') ?? undefined,
          container: res.headers.get('x-format-container') ?? undefined,
          codec: res.headers.get('x-format-codec') ?? undefined,
          ext: res.headers.get('x-format-ext') ?? undefined,
          // `fetch`'s web ReadableStream (DOM lib) and node's stream/web ReadableStream differ
          // structurally in this package's type env; the runtime value is a real web stream that
          // Readable.fromWeb accepts, so cast to its expected param type.
          stream: withInactivityTimeout(
            Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
            STREAM_INACTIVITY_MS,
          ),
        };
      } catch (err) {
        clearTimeout(timer);
        endTimer({ status: 'error' });
        this.logger.warn(`[${provider.name}] stream ${videoId} (${kind}) failed: ${asMsg(err)}`);
        this.metrics.providerFallbacks.inc({ from: provider.name, reason: 'transport' });
        sawTransportError = true;
        this.#recordFailure(provider.name);
      }
    }
    if (sawTransportError || !sawNotFound) {
      throw new ProvidersUnavailableError('stream', `${videoId}/${kind}`);
    }
    throw new NotFoundException(`No provider could stream ${kind} for video ${videoId}`);
  }

  /** Wraps a JSON-fetch fallback chain: if every provider had a transport-level failure (no
   *  body or non-decodable JSON), throw ProvidersUnavailableError instead of misreporting it
   *  as "not found upstream". A genuine 404 envelope on every provider → NotFoundException. */
  async #requireFetch<T>(
    kind: 'video' | 'playlist',
    target: string,
    fn: () => Promise<{ value: T | null; transportError: boolean; sawNotFound: boolean }>,
  ): Promise<T> {
    const { value, transportError, sawNotFound } = await fn();
    if (value !== null) return value;
    if (transportError || !sawNotFound) throw new ProvidersUnavailableError(kind, target);
    throw new NotFoundException(`${kind} ${target} not found via any provider`);
  }

  /**
   * Walk providers in fallback order, validating every JSON response with the shared Zod
   * schema. A contract violation is treated the same as a network error: log a clear
   * "[provider] contract violation on /path: <issues>" and try the next provider. This is
   * the boundary that protects the rest of the backend from misbehaving providers — see
   * docs/provider-contract.schema.json for the language-agnostic contract.
   */
  async #fetchJson<S extends z.ZodType>(
    path: string,
    schema: S,
  ): Promise<{ value: z.infer<S> | null; transportError: boolean; sawNotFound: boolean }> {
    let transportError = false;
    let sawNotFound = false;
    for (const provider of this.registry.providers) {
      if (this.#breakerOpen(provider.name)) {
        transportError = true;
        this.metrics.providerFallbacks.inc({ from: provider.name, reason: 'circuit_open' });
        continue;
      }
      const endTimer = this.metrics.providerRequestDuration.startTimer({
        provider: provider.name,
        path: pathLabel(path),
      });
      try {
        let res = await this.#limitFor(provider.name)(() =>
          fetch(`${provider.baseUrl}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) }),
        );
        // 429 with Retry-After: pause + retry ONCE on the same provider before falling
        // through. The bounded retry stops a stuck Retry-After loop from stalling forever.
        if (res.status === 429) {
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          await res.body?.cancel().catch(() => undefined);
          if (retryAfterMs !== null && retryAfterMs <= 30_000) {
            this.logger.warn(`[${provider.name}] 429 on ${path}; waiting ${retryAfterMs}ms`);
            await new Promise((r) => setTimeout(r, retryAfterMs));
            res = await this.#limitFor(provider.name)(() =>
              fetch(`${provider.baseUrl}${path}`, {
                signal: AbortSignal.timeout(this.timeoutMs),
              }),
            );
          }
        }
        endTimer({ status: statusFamily(res.status) });
        if (!res.ok) {
          const code = await this.#peekErrorCode(res);
          this.logger.warn(
            `[${provider.name}] GET ${path} -> ${res.status}${code ? ' ' + code : ''}`,
          );
          if (code === 'VIDEO_NOT_FOUND' || code === 'PLAYLIST_NOT_FOUND') {
            sawNotFound = true;
            this.#recordSuccess(provider.name); // provider is healthy; the entity is just gone
          } else {
            transportError = true;
            this.#recordFailure(provider.name);
          }
          this.metrics.providerFallbacks.inc({
            from: provider.name,
            reason: code ?? `http_${res.status}`,
          });
          continue;
        }
        const parsed = schema.safeParse(await res.json());
        if (!parsed.success) {
          this.logger.warn(
            `[${provider.name}] contract violation on ${path}: ${zodIssueSummary(parsed.error)}`,
          );
          this.metrics.contractViolations.inc({
            provider: provider.name,
            path: pathLabel(path),
          });
          transportError = true;
          this.#recordFailure(provider.name);
          continue;
        }
        this.#recordSuccess(provider.name);
        return { value: parsed.data, transportError, sawNotFound };
      } catch (err) {
        endTimer({ status: 'error' });
        this.logger.warn(`[${provider.name}] GET ${path} failed: ${asMsg(err)}`);
        this.metrics.providerFallbacks.inc({ from: provider.name, reason: 'transport' });
        transportError = true;
        this.#recordFailure(provider.name);
      }
    }
    return { value: null, transportError, sawNotFound };
  }

  /** Best-effort: parse a ProviderError envelope from a non-2xx response. Returns the code
   *  if the body is a valid envelope, otherwise undefined. Always consumes the body. */
  async #peekErrorCode(res: Response): Promise<ProviderErrorCode | undefined> {
    try {
      const body = (await res.json()) as unknown;
      const parsed = ProviderErrorEnvelopeSchema.safeParse(body);
      return parsed.success ? parsed.data.error.code : undefined;
    } catch {
      await res.body?.cancel().catch(() => undefined);
      return undefined;
    }
  }

  #num(value: string | null): number | undefined {
    if (!value) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Lazily-created per-provider concurrency budget. */
  #limitFor(name: string): LimitFunction {
    let limit = this.limits.get(name);
    if (!limit) {
      limit = pLimit(PROVIDER_CONCURRENCY);
      this.limits.set(name, limit);
    }
    return limit;
  }

  /** True while a provider's breaker is open (recent consecutive transport failures). */
  #breakerOpen(name: string): boolean {
    const state = this.breaker.get(name);
    return state !== undefined && Date.now() < state.openUntil;
  }

  /** A clean response resets the breaker; a NOT_FOUND does NOT (the provider is healthy). */
  #recordSuccess(name: string): void {
    if (this.breaker.has(name)) this.breaker.delete(name);
  }

  /** A transport-level failure trips the breaker after BREAKER_THRESHOLD consecutive failures. */
  #recordFailure(name: string): void {
    const state = this.breaker.get(name) ?? { failures: 0, openUntil: 0 };
    state.failures += 1;
    if (state.failures >= BREAKER_THRESHOLD) {
      state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      this.logger.warn(
        `[${name}] circuit opened for ${BREAKER_COOLDOWN_MS}ms after ${state.failures} failures`,
      );
    }
    this.breaker.set(name, state);
  }
}

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Bucket per-id paths (`/videos/{id}`, `/playlists/{id}`) so the label stays low-cardinality. */
function pathLabel(path: string): string {
  if (path.startsWith('/videos/')) return '/videos/:id';
  if (path.startsWith('/playlists/')) return '/playlists/:id';
  return path;
}

/** 1xx → '1xx', etc. Same low-cardinality bucketing the Prometheus best-practices recommend. */
function statusFamily(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return 'other';
}

/** Parse RFC 9110 Retry-After (seconds or HTTP-date). Returns ms, or null when unparseable. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - Date.now());
}

/** First few issues, formatted as `path: message` and joined — enough for a useful
 * log line without dumping a wall of JSON. */
function zodIssueSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}

/** Destroys the stream with a clear error if no bytes flow for `idleMs`. The data path is
 *  unchanged — this just installs a watchdog timer that resets on every chunk. */
function withInactivityTimeout(source: Readable, idleMs: number): Readable {
  let timer: NodeJS.Timeout = setTimeout(timeoutFired, idleMs);
  function timeoutFired(): void {
    source.destroy(new Error(`stream inactivity > ${idleMs}ms`));
  }
  function reset(): void {
    clearTimeout(timer);
    timer = setTimeout(timeoutFired, idleMs);
  }
  source.on('data', reset);
  source.once('end', () => clearTimeout(timer));
  source.once('close', () => clearTimeout(timer));
  source.once('error', () => clearTimeout(timer));
  return source;
}
