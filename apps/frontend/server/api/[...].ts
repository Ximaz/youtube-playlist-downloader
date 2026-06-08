// Catch-all BFF proxy: forwards every /api/** request (that a more specific named route — auth
// google/callback/sign-out — didn't claim) to the backend over the internal Docker network.
// Strips the `/api` prefix, injects the session token as a Bearer header, and removes the
// browser cookie so the backend only ever sees the token. proxyRequest streams both directions,
// so POST bodies and the /downloads/:id/archive ZIP pass through without buffering.
// The archive route streams a (potentially large/slow) ZIP — it must NOT carry a control-plane
// timeout. Everything else is a short request/response, so we bound the upstream leg so a hung
// backend can't pin a Nitro connection indefinitely (the browser already has its own timeout).
const CONTROL_PLANE_TIMEOUT_MS = 60_000;
const IS_ARCHIVE = /^\/api\/downloads\/[^/]+\/archive$/;

export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE);
  // Auth rides the Bearer header only — never leak the browser cookie upstream.
  delete event.node.req.headers.cookie;

  const upstreamPath = event.path.replace(/^\/api/, '') || '/';
  return proxyRequest(event, `${backendBase()}${upstreamPath}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(IS_ARCHIVE.test(event.path)
      ? {}
      : { fetchOptions: { signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS) } }),
  });
});
