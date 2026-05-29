# OAuth2.0 — private playlists

> Status: **implemented**. End-to-end Google sign-in (with PKCE), private playlist picker, and
> session-scoped batches are live. The flow needs real `GOOGLE_CLIENT_ID` /
> `GOOGLE_CLIENT_SECRET` values in [secrets/backend/.env](../secrets/backend/.env); without
> them, `/auth/google` throws at the first `OAuth2Client` instantiation.

## Goal

Let a user authorize YPD (read-only) to **enumerate their own playlists**, including private ones,
and gather the **public/unlisted videos inside** them. We deliberately do **not** attempt to
download private *videos* — the download path (yt-dlp / youtube.js) is unauthenticated, so private
video streams would fail. We only use the official API to *discover* video ids, then filter to
playable (public/unlisted) ones.

YPD is **not** an account system. OAuth here is a token broker: it obtains a Google token bound to a
YouTube user purely to read their playlists.

## Flow

1. `GET /auth/google` — generate a random `state` + RFC 7636 PKCE `codeVerifier`, store
   `{ codeVerifier }` in Valkey under `oauth:state:{state}` (10-min TTL), set the `state` as a
   short-lived httpOnly `ypd_oauth_state` cookie scoped to `/auth`, then redirect to Google's
   consent screen with scope `openid` + `https://www.googleapis.com/auth/youtube.readonly` and a
   SHA-256 `code_challenge`.
2. `GET /auth/google/callback?code=…&state=…` — require the **cookie** to match the **query**
   `state` (login-CSRF guard), load the stored `codeVerifier`, exchange `code` + verifier for
   tokens, persist them in Postgres keyed by an opaque session id, clear the `oauth_state`
   cookie, set the `ypd_session` cookie, redirect back to the frontend.
3. `GET /auth/playlists` (summaries) / `GET /auth/playlists/:id` (details) — using the stored
   access token (refreshing via the refresh token when within 60s of expiry), call the YouTube
   Data API `playlists.list?mine=true` / `playlistItems.list` and **filter items to
   `privacyStatus` public/unlisted** (private videos can't be streamed without auth at the
   download layer, so they're dropped at this seam).

The summaries call is cached per session in Valkey (5-min TTL); per-playlist detail calls are
cached per (sessionId, playlistId). `POST /auth/sign-out` clears all cached entries for the
session via a SCAN over `oauth:playlist:{sessionId}:*` (never `KEYS` — see
[ADR 0011](decisions/README.md#0011--scan-not-keys-for-per-session-cache-invalidation)).

The frontend's "Sign in with Google" link points at `/auth/google`; after the callback the
picker section in `App.vue` lists the user's playlists and feeds a chosen one into the normal
download flow.

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
- Cookie naming, flag derivation, and `clearCookie` paths are owned by
  **`SessionCookieService`**; controllers receive `sessionId` via a `@SessionId()` param
  decorator and never touch `req.cookies` directly. This keeps `AuthController` handlers thin
  (the project's standing convention).
- **Refresh resilience**: `#getValidAccessToken` distinguishes Google's `invalid_grant` /
  `invalid_token` / `unauthorized_client` (permanent — drop the session, force re-auth) from
  transient 5xx / network failures (surface 503; keep the session intact). A per-session Valkey
  `SET NX EX` mutex (`oauth:refresh-lock:{sessionId}` via `CacheService.withLock`) serialises
  racing refreshes so concurrent in-flight `/auth/playlists` + a download trigger don't double-
  refresh and race a stale token into Postgres.
- `state` + session id are random UUIDs, opaque, and short-lived; tokens never leave the
  backend.

### WebSocket auth

The Socket.IO gateway uses a custom **`SecureIoAdapter`**
([apps/backend/src/realtime/secure-io.adapter.ts](../apps/backend/src/realtime/secure-io.adapter.ts))
that pins CORS to `AppConfigService.frontendOrigin` with `credentials: true` (so the browser
sends `ypd_session` on the WS handshake). Inside the gateway, `server.use(...)` rejects any
handshake whose `ypd_session` cookie doesn't resolve to a `Session` row in Postgres. The
`subscribe` payload is validated with the same `WorkSelectorSchema` the REST resync endpoint
uses, so the WS contract has no second source of truth.
