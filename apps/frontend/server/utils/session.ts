// Shared BFF helpers (auto-imported by Nitro). The browser-facing httpOnly cookie holds the
// opaque backend session token verbatim; the server routes forward it as `Authorization:
// Bearer <token>` to the backend over the internal Docker network.

import type { H3Event } from 'h3';

/** httpOnly cookie whose value IS the backend session token. */
export const SESSION_COOKIE = 'ypd_session';
/** Short-lived CSRF cookie pinning the OAuth `state` across the Google round-trip. */
export const OAUTH_STATE_COOKIE = 'ypd_oauth_state';

/** Path the state cookie is scoped to — covers `/api/auth/google/callback`. */
export const OAUTH_STATE_PATH = '/api/auth';

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
const OAUTH_STATE_MAX_AGE_S = 60 * 10; // 10 min

/** Internal backend base URL — server-only runtime config, never sent to the browser. */
export function backendBase(): string {
  return useRuntimeConfig().backendUrl;
}

/** Whether to mark cookies `Secure` (true in prod behind HTTPS; false for http dev). */
function cookieSecure(): boolean {
  return useRuntimeConfig().cookieSecure;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure(),
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  };
}

export function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure(),
    path: OAUTH_STATE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_S,
  };
}

/** Create a fresh anonymous backend session and return its opaque token. Forwards the browser
 *  User-Agent and the client IP (as X-Forwarded-For) so the backend binds them to the session
 *  as authenticity/audit signals. The caller stores the returned token in the session cookie. */
export async function mintSession(event: H3Event): Promise<string> {
  const userAgent = getRequestHeader(event, 'user-agent');
  const ip = getRequestIP(event, { xForwardedFor: true });
  const res = await $fetch<{ token: string }>(`${backendBase()}/auth/session`, {
    method: 'POST',
    headers: {
      ...(userAgent ? { 'user-agent': userAgent } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
  });
  return res.token;
}

/** Parse a single cookie value out of a raw `Cookie` header (used on the WS upgrade, which
 *  has no h3 event to call getCookie on). */
export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return undefined;
}
