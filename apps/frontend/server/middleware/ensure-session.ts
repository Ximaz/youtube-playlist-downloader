// Ensure every visitor has a backend session cookie BEFORE the SPA boots, so the realtime
// WebSocket (which requires a valid session — ADR 0013) works for anonymous, not-signed-in
// users too. Runs only on top-level document navigations: the API proxy, the socket.io
// transport, Nuxt internals, and static assets are skipped (they don't need to mint, and the
// document load always precedes them). If a cookie already exists we leave it alone; a stale
// cookie (session gone) is self-healed client-side via POST /api/session when /auth/me reports
// no tier. Backend-unreachable here is non-fatal — the page still loads and the client retries.
export default defineEventHandler(async (event) => {
  const path = event.path;
  if (
    path.startsWith('/api') ||
    path.startsWith('/socket.io') ||
    path.startsWith('/_') ||
    path === '/healthz' ||
    /\.[a-z0-9]+($|\?)/i.test(path)
  ) {
    return;
  }
  // Only real browser document navigations mint a session — they send `Accept: text/html`.
  // Health probes (wget/curl), bots, and monitors send `*/*`, so they can't spam session rows.
  if (!getRequestHeader(event, 'accept')?.includes('text/html')) return;
  if (getCookie(event, SESSION_COOKIE)) return;
  try {
    const token = await mintSession(event);
    setCookie(event, SESSION_COOKIE, token, sessionCookieOptions());
  } catch {
    // Backend unreachable — let the page load; useAuth.init() self-heals once it's back.
  }
});
