import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthMe, SessionTier } from '@ypd/shared';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

import { AppConfigService, CacheService } from '@ypd/backend-core';

import { PrismaService } from '../prisma/prisma.service';

/** YouTube Data API read-only scope: covers playlists + playlist items. */
const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
/** OIDC scope — required so Google returns an `id_token` we can verify to extract the
 * user's stable Google subject id (`sub`). Pure OAuth2 scopes don't trigger an id_token. */
const OPENID_SCOPE = 'openid';
/** OIDC `profile` scope — adds the `name` + `picture` claims to the id_token so we can show
 * the real account in the navbar without a separate Google userinfo call. Adding it means
 * existing sessions (granted before this scope) must sign in again to populate the profile. */
const PROFILE_SCOPE = 'profile';
const STATE_PREFIX = 'oauth:state:';
const STATE_TTL_SECONDS = 600; // 10 min — covers a normal consent screen.
/** Refresh the access token if it expires within this window of `now`. */
const REFRESH_LEEWAY_SECONDS = 60;
/**
 * The per-session OAuth playlist cache namespace. `auth/` owns the `oauth:`-prefixed,
 * session-scoped cache keys and their teardown (signOut clears them) because cache
 * invalidation is part of the session lifecycle; `PlaylistsService` owns what goes in them
 * (it imports these to read/write the signed-in playlist responses). Exported, not private,
 * so the two sides agree on one key scheme without a DI edge back into auth.
 *
 * TTL is short on purpose: a freshly renamed or newly created playlist becomes visible within
 * ~5 min without an explicit refresh. Same trust boundary as the DB (ADR 0008) — cached entries
 * hold private playlist titles.
 */
export const PLAYLIST_CACHE_TTL_SECONDS = 300;
export const SUMMARIES_KEY_PREFIX = 'oauth:summaries:';
export const PLAYLIST_KEY_PREFIX = 'oauth:playlist:';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Create an ANONYMOUS session (no OAuthAccount) so a not-signed-in visitor gets a real,
   * server-issued opaque token — the realtime WS handshake and batch session-scoping then work
   * without sign-in. `userAgent`/`ip` are recorded as authenticity/audit signals bound to the
   * token; `tier` defaults to 'paid' (no paid flow yet). A later Google sign-in mints its own
   * session (with the OAuthAccount) and the BFF swaps the cookie.
   */
  async createSession(
    userAgent?: string,
    ip?: string,
  ): Promise<{ sessionId: string; tier: SessionTier }> {
    const session = await this.prisma.session.create({
      data: {
        // Bound the stored strings so a hostile/oversized UA header can't bloat the row.
        ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
        ...(ip ? { ip: ip.slice(0, 128) } : {}),
      },
      select: { id: true, tier: true },
    });
    return { sessionId: session.id, tier: normalizeTier(session.tier) };
  }

  /** Build the Google consent URL. Stores PKCE `codeVerifier` under the `state` key in Valkey
   *  and returns `state` so the controller can also pin it as an httpOnly cookie — the callback
   *  enforces cookie-vs-query match (login-CSRF guard) and exchanges `code` + `codeVerifier`. */
  async startGoogleSignIn(): Promise<{ url: string; state: string }> {
    const state = randomUUID();
    // RFC 7636: 43-128 char URL-safe verifier; SHA-256 challenge transmitted to Google.
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    await this.cache.setJson(STATE_PREFIX + state, { codeVerifier }, STATE_TTL_SECONDS);

    const client = this.oauthClient();
    const url = client.generateAuthUrl({
      access_type: 'offline', // ensures we get a refresh_token
      prompt: 'consent', // forces refresh_token even on repeat sign-in
      scope: [OPENID_SCOPE, PROFILE_SCOPE, YOUTUBE_READONLY_SCOPE],
      state,
      include_granted_scopes: true,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    return { url, state };
  }

  /**
   * Validate `state` (single-use; must match the `oauth_state` cookie the controller sets),
   * exchange `code` for tokens with the stored PKCE `codeVerifier`, persist a Session +
   * OAuthAccount, return the new session id so the controller can set the session cookie.
   *
   * The cookie-state guard is the login-CSRF defence: an attacker pre-fetching /auth/google
   * captures only their own (state, verifier) pair — the victim's browser has no matching
   * cookie, so a forged callback URL is rejected before the token exchange runs.
   */
  async completeGoogleSignIn(
    code: string,
    state: string,
    cookieState: string | undefined,
  ): Promise<{ sessionId: string }> {
    if (!cookieState || cookieState !== state) {
      throw new BadRequestException('OAuth state did not match cookie (possible CSRF).');
    }
    const stateKey = STATE_PREFIX + state;
    const stored = await this.cache.getJson<{ codeVerifier?: string }>(stateKey);
    if (!stored?.codeVerifier) throw new BadRequestException('Invalid or expired OAuth state.');
    await this.cache.del(stateKey); // single use, consume immediately

    const client = this.oauthClient();
    const { tokens } = await client.getToken({ code, codeVerifier: stored.codeVerifier });
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
      throw new BadRequestException('Google did not return the expected tokens.');
    }
    if (!tokens.id_token) {
      throw new BadRequestException('Google did not return an id_token.');
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.config.google.clientId,
    });
    const payload = ticket.getPayload();
    const googleSub = payload?.sub;
    if (!googleSub) throw new BadRequestException('Google id_token has no subject.');

    const session = await this.prisma.session.create({ data: {} });
    await this.prisma.oAuthAccount.create({
      data: {
        sessionId: session.id,
        googleSub,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expiry_date),
        scope: tokens.scope ?? YOUTUBE_READONLY_SCOPE,
        // Profile claims from the verified id_token (present when the `profile` scope is granted).
        name: payload?.name ?? null,
        picture: payload?.picture ?? null,
      },
    });
    return { sessionId: session.id };
  }

  /** Drop the session row (cascade deletes OAuthAccount), the user's playlist summaries
   * cache, and every cached per-playlist detail for this session. SCAN is used (never KEYS)
   * to avoid blocking Valkey under load. Idempotent. */
  async signOut(sessionId: string): Promise<void> {
    const playlistKeys: string[] = [];
    for await (const key of this.cache.scan(`${PLAYLIST_KEY_PREFIX}${sessionId}:*`)) {
      playlistKeys.push(key);
    }
    await Promise.all([
      this.cache.del(SUMMARIES_KEY_PREFIX + sessionId),
      this.cache.delMany(playlistKeys),
      this.prisma.session.deleteMany({ where: { id: sessionId } }),
    ]);
  }

  /** Cheap signed-in check + profile for the navbar. Resolves the Session itself so it can
   * report the `tier`: a valid session (anonymous OR signed-in) returns `tier`; an unknown/stale
   * session returns `{ signedIn: false }` with NO tier, which the frontend reads as "mint a new
   * session". Never throws, never touches the YouTube Data API. `name`/`picture` come from the
   * row populated at sign-in (no Google round-trip). */
  async getMe(sessionId: string): Promise<AuthMe> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { tier: true, account: { select: { name: true, picture: true } } },
    });
    if (!session) return { signedIn: false };
    const tier = normalizeTier(session.tier);
    if (!session.account) return { signedIn: false, tier };
    return {
      signedIn: true,
      tier,
      ...(session.account.name ? { name: session.account.name } : {}),
      ...(session.account.picture ? { picture: session.account.picture } : {}),
    };
  }

  /** True when the session is signed in with Google (has an OAuthAccount). Cheap existence check
   *  used by GET /playlists/:id to decide between the official Data API and the public fallback. */
  async hasGoogleAccount(sessionId: string): Promise<boolean> {
    const account = await this.prisma.oAuthAccount.findUnique({
      where: { sessionId },
      select: { sessionId: true },
    });
    return account !== null;
  }

  // ---------------------------------------------------------------- private helpers

  private oauthClient(): OAuth2Client {
    const { clientId, clientSecret, redirectUri } = this.config.google;
    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are required for OAuth.');
    }
    return new OAuth2Client(clientId, clientSecret, redirectUri);
  }

  /**
   * Token-vending entry point for the authenticated metadata path: returns an access token
   * valid for at least REFRESH_LEEWAY_SECONDS, refreshing against Google + persisting the new
   * token if the stored one is close to expiry. `PlaylistsService` calls this; `auth/` keeps
   * the whole token lifecycle so the metadata layer never touches refresh tokens or Google.
   * Throws UnauthorizedException for an anonymous / signed-out session.
   *
   * A Valkey SETNX mutex per session serialises racing refreshes: the winner refreshes,
   * losers wait + re-read OAuthAccount and find the fresh token already persisted.
   * Transient Google errors (5xx / network) raise 503 and keep the session intact —
   * only `invalid_grant` / `invalid_token` (refresh_token revoked or expired) signs out.
   */
  async getValidAccessToken(sessionId: string): Promise<string> {
    const initial = await this.prisma.oAuthAccount.findUnique({ where: { sessionId } });
    if (!initial) throw new UnauthorizedException('Not signed in.');
    if (!this.#needsRefresh(initial.expiresAt)) return initial.accessToken;

    return this.cache.withLock(`oauth:refresh-lock:${sessionId}`, 5000, async () => {
      // Re-read inside the lock: another caller may have just refreshed.
      const account = await this.prisma.oAuthAccount.findUnique({ where: { sessionId } });
      if (!account) throw new UnauthorizedException('Not signed in.');
      if (!this.#needsRefresh(account.expiresAt)) return account.accessToken;

      const client = this.oauthClient();
      client.setCredentials({ refresh_token: account.refreshToken });
      try {
        const { credentials } = await client.refreshAccessToken();
        if (!credentials.access_token || !credentials.expiry_date) {
          throw new Error('Refresh response missing access_token / expiry_date.');
        }
        await this.prisma.oAuthAccount.update({
          where: { sessionId },
          data: {
            accessToken: credentials.access_token,
            expiresAt: new Date(credentials.expiry_date),
            // refresh_token only re-issued when Google chooses to; keep the existing one otherwise.
            ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}),
          },
        });
        return credentials.access_token;
      } catch (err) {
        const code = this.#googleErrorCode(err);
        // Permanent: refresh_token revoked, expired, or audience mismatch — re-auth required.
        if (
          code === 'invalid_grant' ||
          code === 'invalid_token' ||
          code === 'unauthorized_client'
        ) {
          this.logger.warn(`Refresh permanently failed for ${sessionId}: ${code}`);
          await this.signOut(sessionId);
          throw new UnauthorizedException('Google refused token refresh; please sign in again.');
        }
        // Transient (5xx / network / quota / unknown): keep the session, surface 503 so the
        // frontend can retry instead of forcing the user back through consent.
        this.logger.warn(`Transient refresh failure for ${sessionId}: ${(err as Error).message}`);
        throw new ServiceUnavailableException('Could not refresh access token, please retry.');
      }
    });
  }

  #needsRefresh(expiresAt: Date): boolean {
    return expiresAt.getTime() - Date.now() < REFRESH_LEEWAY_SECONDS * 1000;
  }

  /** Pull a `{ error: 'invalid_grant' | ... }` code from gaxios / google-auth-library errors.
   *  Returns undefined for plain network failures (timeout, ECONNRESET). */
  #googleErrorCode(err: unknown): string | undefined {
    const r = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object' && 'error' in r) {
      const nested = (r as { error?: unknown }).error;
      if (typeof nested === 'string') return nested;
    }
    return undefined;
  }
}

/** Narrow the free-form `tier` column to the SessionTier union (defaults to 'paid'). */
function normalizeTier(tier: string): SessionTier {
  return tier === 'free' ? 'free' : 'paid';
}
