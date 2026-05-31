import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';

import { createProxyServer } from 'httpxy';

// Proxies the Socket.IO WebSocket UPGRADE to the backend. Nitro routes normal HTTP requests
// (the engine.io polling transport is handled by server/routes/socket.io/[...].ts), but it does
// not route raw `upgrade` events, so we bind one ourselves on the underlying http.Server.
//
// The node-server preset doesn't expose the http.Server via a hook, so we grab it lazily from
// the first request's socket (`req.socket.server`) and attach a single `upgrade` listener. In
// practice the SPA fires many HTTP requests (HTML, assets, /api/auth/me) before any socket
// connects, so the listener is always bound by the time the WS upgrade arrives.
export default defineNitroPlugin((nitroApp) => {
  const target = useRuntimeConfig().backendUrl;
  const proxy = createProxyServer({});
  let bound = false;

  nitroApp.hooks.hook('request', (event) => {
    if (bound) return;
    const server = (event.node.req.socket as { server?: Server }).server;
    if (!server) return;
    bound = true;

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      // Only claim Socket.IO upgrades; leave anything else for other potential handlers.
      if (!req.url?.startsWith('/socket.io')) return;
      // Resolve the session token from the browser cookie, inject it as a Bearer header for the
      // backend handshake, and strip the cookie so the backend never sees it.
      const token = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
      if (token) req.headers.authorization = `Bearer ${token}`;
      delete req.headers.cookie;
      proxy.ws(req, socket, head, { target }).catch(() => socket.destroy());
    });
  });
});
