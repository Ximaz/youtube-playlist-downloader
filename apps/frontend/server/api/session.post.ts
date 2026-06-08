// POST /api/session — mint a fresh anonymous backend session and store it in the httpOnly
// cookie. A dedicated route (not the generic /api proxy) because it must SET the browser
// cookie. The SPA calls this to self-heal when /auth/me reports no valid session (a stale
// cookie left over after the backend's session was dropped, e.g. a DB reset in dev).
export default defineEventHandler(async (event) => {
  const token = await mintSession(event);
  setCookie(event, SESSION_COOKIE, token, sessionCookieOptions());
  setResponseStatus(event, 201);
  return { ok: true };
});
