// GET /api/auth/google/callback — Google redirects the browser here. Validate `state` against
// the httpOnly cookie (login-CSRF guard), exchange `code` for a session token server-to-server,
// store the token in the httpOnly session cookie, and bounce to the app.
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = typeof query.code === 'string' ? query.code : undefined;
  const state = typeof query.state === 'string' ? query.state : undefined;
  const cookieState = getCookie(event, OAUTH_STATE_COOKIE);
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH });

  if (!code || !state || !cookieState || cookieState !== state) {
    return sendRedirect(event, '/?auth=error', 302);
  }

  let token: string;
  try {
    const res = await $fetch<{ token: string }>(`${backendBase()}/auth/google/exchange`, {
      method: 'POST',
      body: { code, state },
    });
    token = res.token;
  } catch {
    return sendRedirect(event, '/?auth=error', 302);
  }

  setCookie(event, SESSION_COOKIE, token, sessionCookieOptions());
  return sendRedirect(event, '/', 302);
});
