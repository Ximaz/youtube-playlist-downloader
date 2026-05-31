// POST /api/auth/sign-out — drop the backend session (best-effort) and clear the local cookie.
// A dedicated handler (not the generic proxy) because it must delete the browser cookie.
export default defineEventHandler(async (event) => {
  const token = getCookie(event, SESSION_COOKIE);
  if (token) {
    try {
      await $fetch(`${backendBase()}/auth/sign-out`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      // Best-effort: clear the cookie regardless so the user is signed out locally.
    }
  }
  deleteCookie(event, SESSION_COOKIE, { path: '/' });
  setResponseStatus(event, 204);
  return null;
});
