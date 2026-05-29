import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { OAuthPlaylist, OAuthPlaylistSummary } from '@ypd/shared';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

import { CacheService } from '../cache/cache.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { YouTubeDataService } from './youtube-data.service';

/** YouTube Data API read-only scope: covers playlists + playlist items. */
const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
/** OIDC scope — required so Google returns an `id_token` we can verify to extract the
 * user's stable Google subject id (`sub`). Pure OAuth2 scopes don't trigger an id_token. */
const OPENID_SCOPE = 'openid';
const STATE_PREFIX = 'oauth:state:';
const STATE_TTL_SECONDS = 600; // 10 min — covers a normal consent screen.
/** Refresh the access token if it expires within this window of `now`. */
const REFRESH_LEEWAY_SECONDS = 60;
/** TTL for the per-user OAuth playlist caches. Short on purpose: a freshly renamed
 * or newly created playlist becomes visible within ~5 min without an explicit refresh.
 * Same trust boundary as the DB (ADR 0008) — cached entries hold private playlist titles. */
const PLAYLIST_CACHE_TTL_SECONDS = 300;
const SUMMARIES_KEY_PREFIX = 'oauth:summaries:';
const PLAYLIST_KEY_PREFIX = 'oauth:playlist:';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    private readonly youtube: YouTubeDataService,
  ) {}

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
      scope: [OPENID_SCOPE, YOUTUBE_READONLY_SCOPE],
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
    const googleSub = ticket.getPayload()?.sub;
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

  /** Cheap session check: does the cookie correspond to an account with stored tokens?
   * Returns false for unknown / signed-out sessions — never throws. */
  async hasSession(sessionId: string): Promise<boolean> {
    const account = await this.prisma.oAuthAccount.findUnique({
      where: { sessionId },
      select: { sessionId: true },
    });
    return account !== null;
  }

  /**
   * Lightweight per-playlist summary for the picker UI. One paginated playlists.list
   * call with `part=snippet,contentDetails` — `itemCount` lets the frontend show "(N
   * videos)" without doing a second round-trip. NO playlistItems.list calls fire here:
   * the items + privacy filter happen lazily in getUserPlaylist() once a row is picked.
   *
   * Cached in Valkey for PLAYLIST_CACHE_TTL_SECONDS; signOut() invalidates the key.
   * A token revoked Google-side while the cache is warm stays cosmetically visible
   * until expiry — downloads still fail correctly because they don't use this cache.
   */
  async listUserPlaylistSummaries(sessionId: string): Promise<OAuthPlaylistSummary[]> {
    const cacheKey = SUMMARIES_KEY_PREFIX + sessionId;
    const cached = await this.cache.getJson<OAuthPlaylistSummary[]>(cacheKey);
    if (cached) return cached;

    const accessToken = await this.#getValidAccessToken(sessionId);
    const summaries = await this.youtube.listMyPlaylists(accessToken);
    await this.cache.setJson(cacheKey, summaries, PLAYLIST_CACHE_TTL_SECONDS);
    return summaries;
  }

  /**
   * Full detail for one playlist: title + playable (public + unlisted) videoIds. The
   * title and items are fetched in parallel so a click on the picker resolves in ~one
   * Data API round-trip's worth of wall-clock. Cached per (sessionId, playlistId)
   * with the same TTL as the summaries.
   */
  async getUserPlaylist(sessionId: string, playlistId: string): Promise<OAuthPlaylist> {
    const cacheKey = `${PLAYLIST_KEY_PREFIX}${sessionId}:${playlistId}`;
    const cached = await this.cache.getJson<OAuthPlaylist>(cacheKey);
    if (cached) return cached;

    const accessToken = await this.#getValidAccessToken(sessionId);
    const [title, videoIds] = await Promise.all([
      this.youtube.getPlaylistTitle(accessToken, playlistId),
      this.youtube.listPlaylistVideoIds(accessToken, playlistId),
    ]);
    const result: OAuthPlaylist = { id: playlistId, ...(title ? { title } : {}), videoIds };
    await this.cache.setJson(cacheKey, result, PLAYLIST_CACHE_TTL_SECONDS);
    return result;
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
   * Return an access token that is valid for at least REFRESH_LEEWAY_SECONDS. Refresh against
   * Google + persist the new token if the stored one is close to expiry.
   *
   * A Valkey SETNX mutex per session serialises racing refreshes: the winner refreshes,
   * losers wait + re-read OAuthAccount and find the fresh token already persisted.
   * Transient Google errors (5xx / network) raise 503 and keep the session intact —
   * only `invalid_grant` / `invalid_token` (refresh_token revoked or expired) signs out.
   */
  async #getValidAccessToken(sessionId: string): Promise<string> {
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
