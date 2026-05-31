// Socket.IO HTTP transport (engine.io polling + the initial handshake) proxied to the backend.
// Lives under server/routes (root path, not /api) because the client connects to `/socket.io`.
// The websocket UPGRADE for this same path is handled separately by server/plugins/socket-proxy.ts
// (Nitro doesn't route raw upgrades). Same auth model: cookie → Bearer, strip the cookie upstream.
export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE);
  delete event.node.req.headers.cookie;
  return proxyRequest(event, `${backendBase()}${event.path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
});
