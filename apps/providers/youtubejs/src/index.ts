import { randomUUID } from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

import { ProviderError } from './errors.js';
import { logger } from './logger.js';
import { YoutubeService } from './youtube.service.js';

const REQUEST_ID_HEADER = 'x-ypd-request-id';

// Prom-client registry kept local to the process; same metric names as the backend
// (path label normalized via pathLabel below).
const registry = new Registry();
collectDefaultMetrics({ register: registry });

const requestsTotal = new Counter({
  name: 'requests_total',
  help: 'Hono HTTP requests by path family + status family.',
  labelNames: ['path', 'status'],
});
const requestDuration = new Histogram({
  name: 'request_duration_seconds',
  help: 'Hono request handling latency by path family.',
  labelNames: ['path'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});
registry.registerMetric(requestsTotal);
registry.registerMetric(requestDuration);

const service = new YoutubeService();
const app = new Hono();

// One structured JSON log line per request (info), matching provider-ytdl's fields.
// Skip successful /health probes — they fire on the healthcheck interval and only add noise;
// errors (status >= 400) are still logged so an unhealthy container is visible.
// Also adopts/echoes x-ypd-request-id so backend logs can be correlated end-to-end, and feeds
// the prom-client histograms below.
app.use('*', async (c, next) => {
  const start = performance.now();
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  c.set('requestId' as never, requestId);
  c.res.headers.set(REQUEST_ID_HEADER, requestId);
  await next();
  const path = new URL(c.req.url).pathname;
  const pl = pathLabel(path);
  const duration = (performance.now() - start) / 1000;
  requestDuration.observe({ path: pl }, duration);
  requestsTotal.inc({ path: pl, status: statusFamily(c.res.status) });
  if (path === '/health' && c.res.status < 400) return;
  if (path === '/metrics') return;
  logger.info(
    {
      method: c.req.method,
      path,
      status: c.res.status,
      duration_ms: Math.round(duration * 10000) / 10,
      id: c.req.param('videoId') ?? c.req.param('playlistId'),
      request_id: requestId,
    },
    'request',
  );
});

app.get('/metrics', async (c) => {
  c.header('Content-Type', registry.contentType);
  return c.body(await registry.metrics());
});

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'youtubejs', version: YoutubeService.libraryVersion }),
);

app.get('/videos/:videoId', async (c) =>
  c.json(await service.getVideoMetadata(c.req.param('videoId'))),
);

app.get('/playlists/:playlistId', async (c) =>
  c.json(await service.getPlaylist(c.req.param('playlistId'))),
);

app.get('/videos/:videoId/stream', async (c) => {
  const kind = c.req.query('kind');
  if (kind !== 'audio' && kind !== 'video') {
    throw new ProviderError(400, 'BAD_REQUEST', "kind must be 'audio' or 'video'");
  }
  const { status, headers, body } = await service.stream(
    c.req.param('videoId'),
    kind,
    c.req.query('itag'),
    c.req.header('range'),
  );
  return c.body(body, status as ContentfulStatusCode, headers);
});

app.notFound((c) => c.json({ error: { code: 'VIDEO_NOT_FOUND', message: 'not found' } }, 404));

app.onError((err, c) => {
  if (err instanceof ProviderError) {
    const fields = { error_code: err.code, status: err.status, msg: err.message };
    if (err.status >= 500) logger.error(fields, 'request_error');
    else logger.warn(fields, 'request_error');
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ msg: message }, 'unexpected_error');
  return c.json({ error: { code: 'UPSTREAM_ERROR', message } }, 502);
});

const port = Number(process.env.PORT ?? 5001);
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
logger.info({ port }, 'provider-youtubejs listening');

// Graceful shutdown: stop accepting new connections, let in-flight requests finish, then exit.
// tini (PID 1) forwards SIGTERM to us; without this handler, Node would terminate immediately
// and any in-progress download segment would error out for the client.
const gracefulShutdown = (signal: string) => () => {
  logger.info({ signal }, 'provider-youtubejs shutting down');
  server.close(() => {
    logger.info('http server closed');
    process.exit(0);
  });
  // Belt-and-braces: hard-exit after 10s in case a long-running stream blocks close.
  setTimeout(() => {
    logger.warn('shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();
};
process.on('SIGTERM', gracefulShutdown('SIGTERM'));
process.on('SIGINT', gracefulShutdown('SIGINT'));

/** Bucket per-id paths so the prom labels stay low-cardinality. */
function pathLabel(path: string): string {
  if (path.startsWith('/videos/') && path.endsWith('/stream')) return '/videos/:id/stream';
  if (path.startsWith('/videos/')) return '/videos/:id';
  if (path.startsWith('/playlists/')) return '/playlists/:id';
  return path;
}
function statusFamily(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return 'other';
}
