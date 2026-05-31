// GET /api/auth/google — login entry point. Asks the backend for the Google consent URL +
// CSRF state (the backend keeps the PKCE verifier server-side keyed by state), pins `state`
// as an httpOnly cookie, and redirects the browser to Google.
export default defineEventHandler(async (event) => {
  const { url, state } = await $fetch<{ url: string; state: string }>(
    `${backendBase()}/auth/google/url`,
  );
  setCookie(event, OAUTH_STATE_COOKIE, state, stateCookieOptions());
  return sendRedirect(event, url, 302);
});
