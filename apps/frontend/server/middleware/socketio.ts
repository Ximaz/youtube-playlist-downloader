import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { createProxyServer } from 'httpxy';

// Socket.IO proxy. Lives in middleware (not a route) for two reasons:
//   1. engine.io hits the bare path `/socket.io/` (transport/sid are query params), which a
//      `routes/socket.io/[...].ts` catch-all does NOT match — middleware matches any prefix.
//   2. The middleware runs on every request, giving us a reliable handle on the underlying
//      http.Server (`req.socket.server`) to bind the websocket `upgrade` listener that Nitro
//      itself doesn't route.
// Same auth model as the REST proxy: the httpOnly cookie → `Authorization: Bearer`, cookie
// stripped before the request reaches the backend.

const proxy = createProxyServer({});
// ProxyServer is an EventEmitter; without an 'error' listener an upstream WS failure would
// emit an unhandled 'error' and crash the process. We destroy the socket on failure instead.
proxy.on('error', () => {});
let upgradeBound = false;

export default defineEventHandler((event) => {
  // Bind the websocket upgrade proxy once, lazily, on the first request we see. The node-server
  // preset exposes no startup hook for the http.Server, so we grab it from a request's socket.
  // The SPA always issues HTTP requests (HTML, assets, /api/auth/me) before any socket connects,
  // so the listener is bound well before the first WS upgrade. (If a WS upgrade ever arrives
  // first, Node routes it through the HTTP handler below and the client falls back to polling.)
  if (!upgradeBound) {
    const server = (event.node.req.socket as { server?: Server }).server;
    if (server) {
      upgradeBound = true;
      server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!req.url?.startsWith('/socket.io')) return; // leave non-socket upgrades alone
        const token = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
        if (token) req.headers.authorization = `Bearer ${token}`;
        delete req.headers.cookie;
        // httpxy's signature is (req, socket, opts, head) — opts 3rd, head 4th. The 'upgrade'
        // event types socket as Duplex, but it's a net.Socket at runtime (what httpxy wants).
        proxy
          .ws(req, socket as Socket, { target: backendBase() }, head)
          .catch(() => socket.destroy());
      });
    }
  }

  // Proxy the HTTP transport (engine.io polling + handshake at `/socket.io/`). Returning the
  // proxied response short-circuits the middleware chain; other paths fall through to /api + SPA.
  if (event.path.startsWith('/socket.io')) {
    const token = getCookie(event, SESSION_COOKIE);
    delete event.node.req.headers.cookie;
    return proxyRequest(event, `${backendBase()}${event.path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }
});
