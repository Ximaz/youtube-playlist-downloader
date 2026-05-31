// Catch-all BFF proxy: forwards every /api/** request (that a more specific named route — auth
// google/callback/sign-out — didn't claim) to the backend over the internal Docker network.
// Strips the `/api` prefix, injects the session token as a Bearer header, and removes the
// browser cookie so the backend only ever sees the token. proxyRequest streams both directions,
// so POST bodies and the /downloads/:id/archive ZIP pass through without buffering.
export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE);
  // Auth rides the Bearer header only — never leak the browser cookie upstream.
  delete event.node.req.headers.cookie;

  const upstreamPath = event.path.replace(/^\/api/, '') || '/';
  return proxyRequest(event, `${backendBase()}${upstreamPath}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
});
