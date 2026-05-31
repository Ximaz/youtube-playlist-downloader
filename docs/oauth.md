# OAuth2.0 — private playlists

> Status: **implemented**. End-to-end Google sign-in (with PKCE), private playlist picker, and
> session-scoped batches are live. The flow needs real `GOOGLE_CLIENT_ID` /
> `GOOGLE_CLIENT_SECRET` values in [secrets/backend/.env](../secrets/backend/.env); without
> them, the `/auth/google/url` exchange throws at the first `OAuth2Client` instantiation. The
> `GOOGLE_REDIRECT_URI` must point at the **frontend** BFF callback
> (`…/api/auth/google/callback`) and be registered in the Google Cloud Console.

## Goal

Let a user authorize YPD (read-only) to **enumerate their own playlists**, including private ones,
and gather the **public/unlisted videos inside** them. We deliberately do **not** attempt to
download private *videos* — the download path (yt-dlp / youtube.js) is unauthenticated, so private
video streams would fail. We only use the official API to *discover* video ids, then filter to
playable (public/unlisted) ones.

YPD is **not** an account system. OAuth here is a token broker: it obtains a Google token bound to a
YouTube user purely to read their playlists.

## Architecture: Backend-for-Frontend (BFF)

The browser only ever talks to the **Nuxt** origin. The backend is a pure **token API** (no
cookies, no CORS) reached only by the Nuxt Nitro server over the internal Docker network. Nuxt
owns the browser's httpOnly cookie — whose value **is** the opaque backend session token — and
forwards it to the backend as `Authorization: Bearer <token>`. So the OAuth `state` cookie and
the session cookie are set by **Nuxt**, while the backend keeps only the Google-facing logic
(PKCE, token exchange/refresh, persistence).

## Flow

1. `GET /api/auth/google` (Nuxt) — calls the backend `GET /auth/google/url`, which generates a
   random `state` + RFC 7636 PKCE `codeVerifier`, stores `{ codeVerifier }` in Valkey under
   `oauth:state:{state}` (10-min TTL), and returns the Google consent URL (scope `openid profile`
   + `youtube.readonly`, SHA-256 `code_challenge`). Nuxt pins `state` as a short-lived httpOnly
   `ypd_oauth_state` cookie and redirects the browser to Google.
2. `GET /api/auth/google/callback?code=…&state=…` (Nuxt) — Google redirects here. Nuxt requires
   the **cookie** to match the **query** `state` (login-CSRF guard), then calls the backend
   `POST /auth/google/exchange { code, state }`, which loads + **single-use consumes** the stored
   `codeVerifier`, exchanges `code` + verifier for tokens, persists them in Postgres keyed by an
   opaque session id, and returns `{ token }`. Nuxt stores `token` in the httpOnly `ypd_session`
   cookie, clears the state cookie, and redirects to the app.
3. `GET /api/auth/playlists` (summaries) / `GET /api/auth/playlists/:id` (details) — Nuxt proxies
   to the backend with the Bearer token; the backend uses the stored access token (refreshing via
   the refresh token when within 60s of expiry) to call the YouTube Data API and **filter items
   to `privacyStatus` public/unlisted** (private videos can't be streamed without auth at the
   download layer, so they're dropped at this seam).

The single-use Valkey verifier (consumed in `completeGoogleSignIn`) is the anti-replay guard; the
`state`-vs-cookie comparison is now enforced in the Nuxt callback before the exchange call.

The summaries call is cached per session in Valkey (5-min TTL); per-playlist detail calls are
cached per (sessionId, playlistId). `POST /api/auth/sign-out` proxies to the backend (which drops
the session + caches via a SCAN over `oauth:playlist:{sessionId}:*`, never `KEYS` — see
[ADR 0011](decisions/README.md#0011--scan-not-keys-for-per-session-cache-invalidation)) and then
deletes the `ypd_session` cookie.

The frontend's "Sign in with Google" link points at `/api/auth/google`; after the callback the
picker section lists the user's playlists and feeds a chosen one into the normal download flow.

## Storage (Prisma + Postgres)

```prisma
model Session {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  account   OAuthAccount?
}

model OAuthAccount {
  sessionId    String   @id
  session      Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  googleSub    String                 // Google account subject id
  accessToken  String
  refreshToken String
  expiresAt    DateTime
  scope        String
  updatedAt    DateTime @updatedAt
}
```

`DATABASE_URL` (backend's `.env`) and `POSTGRES_*` (the `database` service's `.env`) are wired
in [secrets/](../secrets/) and [docker-compose.yml](../docker-compose.yml). The backend's
container `CMD` runs `prisma migrate deploy` before starting Nest, so the schema is in sync on
every `docker compose up`.

### Encryption at rest

Tokens are stored as plaintext `String` columns; at-rest protection is the database **volume's**
responsibility (LUKS / cloud-provider encrypted volume in prod). See [ADR 0008](decisions/README.md#0008--oauth-tokens-at-rest-disk-encryption-not-app-level)
for the rationale and the accepted tradeoff (a `pg_dump` leak or compromised DB role yields raw
tokens — mitigated by least-privilege roles + TLS to Postgres + an encrypted volume in prod).

## Implementation notes

- `google-auth-library` (official) handles the token exchange + refresh; full Passport machinery
  is overkill for a token broker with no app accounts. PKCE arguments use the library's
  `CodeChallengeMethod.S256` enum.
- The YouTube Data API calls live in a dedicated **`YouTubeDataService`**
  ([apps/backend/src/auth/youtube-data.service.ts](../apps/backend/src/auth/youtube-data.service.ts)),
  not `AuthService` — same boundary discipline as `ProviderClientService`. Every response is
  Zod-validated at the seam so an unexpected Google response shape fails loud with a clear
  contract-violation log instead of silently flowing into the rest of the app.
- Cookies are owned entirely by the **Nuxt BFF** ([apps/frontend/server/](../apps/frontend/server/)):
  the auth routes set/clear `ypd_oauth_state` + `ypd_session`, and the catch-all proxy +
  socket-proxy plugin swap the cookie for a Bearer header upstream. The backend is cookie-free;
  controllers receive `sessionId` via a `@SessionId()` param decorator that reads the
  `Authorization: Bearer <token>` header, keeping `AuthController` handlers thin.
- **Refresh resilience**: `#getValidAccessToken` distinguishes Google's `invalid_grant` /
  `invalid_token` / `unauthorized_client` (permanent — drop the session, force re-auth) from
  transient 5xx / network failures (surface 503; keep the session intact). A per-session Valkey
  `SET NX EX` mutex (`oauth:refresh-lock:{sessionId}` via `CacheService.withLock`) serialises
  racing refreshes so concurrent in-flight `/auth/playlists` + a download trigger don't double-
  refresh and race a stale token into Postgres.
- `state` + session id are random UUIDs, opaque, and short-lived; tokens never leave the
  backend.

### WebSocket auth

The browser opens Socket.IO against its own origin (`/socket.io`); a single Nuxt BFF middleware
([server/middleware/socketio.ts](../apps/frontend/server/middleware/socketio.ts)) proxies both the
HTTP polling transport (via h3 `proxyRequest`) and the WebSocket `upgrade` (via `httpxy`, bound on
the underlying http.Server), injecting `Authorization: Bearer <token>` (from the `ypd_session`
cookie) onto the upstream handshake and stripping the cookie. Inside the gateway, `server.use(...)` reads that Bearer token
and rejects any handshake whose token doesn't resolve to a `Session` row in Postgres (no
`SecureIoAdapter`/CORS — the handshake is same-network, never cross-origin). The `subscribe`
payload is validated with the same `WorkSelectorSchema` the REST resync endpoint uses, so the WS
contract has no second source of truth.
