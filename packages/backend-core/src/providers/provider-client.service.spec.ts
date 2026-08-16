import { Readable } from 'node:stream';

import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CacheService } from '../cache/cache.service';
import type { AppConfigService } from '../config/app-config.service';
import type { MetricsService } from '../observability/metrics.service';
import { ProviderClientService, ProvidersUnavailableError } from './provider-client.service';
import type { ProviderRegistry } from './provider-registry.service';

/** Minimal stubs so the service can construct without booting NestJS. */
function makeService(providers: { name: string; baseUrl: string }[]): {
  service: ProviderClientService;
  metrics: MetricsService;
  cacheGet: ReturnType<typeof vi.fn>;
  cacheSet: ReturnType<typeof vi.fn>;
} {
  const registry = { providers } as ProviderRegistry;
  const metrics = {
    providerRequestDuration: { startTimer: () => () => undefined },
    providerFallbacks: { inc: () => undefined },
    contractViolations: { inc: () => undefined },
  } as unknown as MetricsService;
  const cacheGet = vi.fn().mockResolvedValue(null);
  const cacheSet = vi.fn().mockResolvedValue(undefined);
  const cache = { get: cacheGet, set: cacheSet } as unknown as CacheService;
  const config = { providers: { timeoutMs: 5000 } } as unknown as AppConfigService;
  return {
    service: new ProviderClientService(registry, metrics, cache, config),
    metrics,
    cacheGet,
    cacheSet,
  };
}

const VALID_VIDEO_META = {
  id: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  thumbnails: [],
};

describe('ProviderClientService — JSON fallback', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the first provider that produces a valid VideoMetadata response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_VIDEO_META), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { service } = makeService([{ name: 'ytdl', baseUrl: 'http://provider' }]);
    const meta = await service.getVideoMetadata('dQw4w9WgXcQ');
    expect(meta.id).toBe('dQw4w9WgXcQ');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls through to the next provider on a 404 VIDEO_NOT_FOUND envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'VIDEO_NOT_FOUND', message: 'gone' } }), {
        status: 404,
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_VIDEO_META), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { service } = makeService([
      { name: 'ytdl', baseUrl: 'http://a' },
      { name: 'youtubejs', baseUrl: 'http://b' },
    ]);
    const meta = await service.getVideoMetadata('dQw4w9WgXcQ');
    expect(meta.id).toBe('dQw4w9WgXcQ');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws NotFoundException when EVERY provider returns VIDEO_NOT_FOUND', async () => {
    const notFound = (): Response =>
      new Response(JSON.stringify({ error: { code: 'VIDEO_NOT_FOUND', message: 'gone' } }), {
        status: 404,
      });
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(notFound());
    const { service, cacheSet } = makeService([
      { name: 'ytdl', baseUrl: 'http://a' },
      { name: 'youtubejs', baseUrl: 'http://b' },
    ]);
    await expect(service.getVideoMetadata('dQw4w9WgXcQ')).rejects.toBeInstanceOf(NotFoundException);
    // Negative-result cache should have been primed.
    expect(cacheSet).toHaveBeenCalledWith('provider:neg:video:dQw4w9WgXcQ', '1', 60);
  });

  it('throws ProvidersUnavailableError when transport errors mask a partial NOT_FOUND set', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'VIDEO_NOT_FOUND', message: 'gone' } }), {
        status: 404,
      }),
    );
    const { service } = makeService([
      { name: 'ytdl', baseUrl: 'http://a' },
      { name: 'youtubejs', baseUrl: 'http://b' },
    ]);
    await expect(service.getVideoMetadata('dQw4w9WgXcQ')).rejects.toBeInstanceOf(
      ProvidersUnavailableError,
    );
  });

  it('rejects + falls through on a contract violation (schema mismatch)', async () => {
    // First provider responds 200 with a missing required field (`id`).
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ title: 'no id here', thumbnails: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_VIDEO_META), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { service } = makeService([
      { name: 'ytdl', baseUrl: 'http://a' },
      { name: 'youtubejs', baseUrl: 'http://b' },
    ]);
    const meta = await service.getVideoMetadata('dQw4w9WgXcQ');
    expect(meta.id).toBe('dQw4w9WgXcQ');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('ProviderClientService — openStream fallback (download balancing)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const streamOk = (): Response =>
    new Response('audio-bytes', {
      status: 200,
      headers: {
        'content-type': 'audio/webm',
        'content-length': '11',
        'x-format-itag': '251',
        'x-format-container': 'webm',
        'x-format-ext': 'weba',
      },
    });
  const upstream502 = (): Response =>
    new Response(JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'boom' } }), {
      status: 502,
    });

  const twoProviders = (): ReturnType<typeof makeService> =>
    makeService([
      { name: 'ytdl', baseUrl: 'http://a' },
      { name: 'youtubejs', baseUrl: 'http://b' },
    ]);

  // The whole point of the ytdl pre-flight cascade: a failing ytdl returns a clean 502 (before
  // committing 200), so the loop reaches youtubejs. A truncated 200 would strand it on ytdl.
  it('falls through to youtubejs when ytdl returns a clean 502', async () => {
    fetchMock.mockResolvedValueOnce(upstream502()); // ytdl
    fetchMock.mockResolvedValueOnce(streamOk()); // youtubejs
    const { service } = twoProviders();
    const res = await service.openStream('dQw4w9WgXcQ', 'audio');
    expect(res.provider).toBe('youtubejs');
    expect(res.itag).toBe('251');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    res.stream.destroy();
  });

  it('returns ytdl and never calls youtubejs when ytdl succeeds (2xx)', async () => {
    fetchMock.mockResolvedValueOnce(streamOk());
    const { service } = twoProviders();
    const res = await service.openStream('dQw4w9WgXcQ', 'audio');
    expect(res.provider).toBe('ytdl');
    expect(fetchMock).toHaveBeenCalledOnce();
    res.stream.destroy();
  });

  it('falls through when ytdl fetch throws (transport error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET')); // ytdl
    fetchMock.mockResolvedValueOnce(streamOk()); // youtubejs
    const { service } = twoProviders();
    const res = await service.openStream('dQw4w9WgXcQ', 'audio');
    expect(res.provider).toBe('youtubejs');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    res.stream.destroy();
  });

  it('throws ProvidersUnavailableError when both providers 502', async () => {
    fetchMock.mockResolvedValueOnce(upstream502()).mockResolvedValueOnce(upstream502());
    const { service } = twoProviders();
    await expect(service.openStream('dQw4w9WgXcQ', 'audio')).rejects.toBeInstanceOf(
      ProvidersUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Regression: the inactivity watchdog used to reset its timer from a `'data'` listener, which
  // put the source into flowing mode as soon as openStream returned. The caller does an S3
  // `exists()` round trip before piping, and every chunk that landed in that window was dropped —
  // the upload then finalised a SHORT object with no error anywhere (ffmpeg later failed with
  // "moov atom not found"). The stream must still hold every byte for a late consumer.
  it('loses no bytes when the consumer attaches after an await', async () => {
    const payload = 'audio-bytes';
    fetchMock.mockResolvedValueOnce(streamOk());
    const { service } = twoProviders();
    const res = await service.openStream('dQw4w9WgXcQ', 'audio');

    // Stand in for `storage.exists()`: real async work between openStream and the pipe.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const chunks: Buffer[] = [];
    for await (const chunk of res.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe(payload);
  });

  it('propagates a source error to the consumer instead of ending cleanly', async () => {
    const source = new Readable({ read() {} });
    fetchMock.mockResolvedValueOnce(
      new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {
        status: 200,
        headers: { 'content-type': 'audio/webm', 'x-format-ext': 'weba' },
      }),
    );
    const { service } = twoProviders();
    const res = await service.openStream('dQw4w9WgXcQ', 'audio');
    source.push('partial');
    source.destroy(new Error('upstream died'));

    await expect(
      (async () => {
        for await (const chunk of res.stream) void chunk; // drain
      })(),
    ).rejects.toThrow();
  });
});
