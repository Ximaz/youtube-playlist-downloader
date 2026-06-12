import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { OAuthPlaylist, OAuthPlaylistSummary, PlaylistMetadata } from '@ypd/shared';

import { CacheService, MetadataService } from '@ypd/backend-core';

import {
  AuthService,
  PLAYLIST_CACHE_TTL_SECONDS,
  PLAYLIST_KEY_PREFIX,
  SUMMARIES_KEY_PREFIX,
} from '../auth/auth.service';
import { YouTubeDataService } from './youtube-data.service';

/**
 * Orchestrates playlist metadata across the two retrieval paths, picking one per request:
 *  - authenticated (signed in with Google) → the official YouTube Data API via YouTubeDataService,
 *    which can see the user's own private playlists. AuthService only vends the token.
 *  - anonymous → the token-free provider extraction (MetadataService), good for public + unlisted.
 *
 * This is where "fetching playlist metadata" lives as its own concern, separate from auth: auth
 * owns the OAuth lifecycle + token, this owns deciding which source to read and shaping the result.
 */
@Injectable()
export class PlaylistsService {
  constructor(
    private readonly auth: AuthService,
    private readonly metadata: MetadataService,
    private readonly youtube: YouTubeDataService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The signed-in user's playlists (lightweight per-playlist summary for the picker UI). One
   * paginated playlists.list call with `part=snippet,contentDetails` — `itemCount` lets the
   * frontend show "(N videos)" without a second round-trip. NO playlistItems.list calls fire
   * here: the items + privacy filter happen lazily in getPlaylist() once a row is picked.
   *
   * Inherently auth-only ("MY playlists" has no token-free equivalent): throws 401 for an
   * anonymous session, or for a session with no OAuth account (via getValidAccessToken).
   * Cached in Valkey for PLAYLIST_CACHE_TTL_SECONDS; AuthService.signOut() invalidates the key.
   * A token revoked Google-side while the cache is warm stays cosmetically visible until expiry —
   * downloads still fail correctly because they don't use this cache.
   */
  async listMyPlaylists(sessionId: string | undefined): Promise<OAuthPlaylistSummary[]> {
    if (!sessionId) throw new UnauthorizedException('Not signed in.');
    const cacheKey = SUMMARIES_KEY_PREFIX + sessionId;
    const cached = await this.cache.getJson<OAuthPlaylistSummary[]>(cacheKey);
    if (cached) return cached;

    const accessToken = await this.auth.getValidAccessToken(sessionId);
    const summaries = await this.youtube.listMyPlaylists(accessToken);
    await this.cache.setJson(cacheKey, summaries, PLAYLIST_CACHE_TTL_SECONDS);
    return summaries;
  }

  /**
   * One playlist with its playable (public + unlisted) video ids. Auth-optional:
   *  - signed in with Google → the official Data API (so the user's own private playlists work),
   *  - otherwise → the token-free public/unlisted provider extraction.
   *
   * A private/absent playlist is unreachable without auth: the provider just 404s and a private
   * playlist is indistinguishable from a missing one, so the anonymous path surfaces a single 404
   * that nudges the user to sign in.
   */
  async getPlaylist(sessionId: string | undefined, playlistId: string): Promise<PlaylistMetadata> {
    if (sessionId && (await this.auth.hasGoogleAccount(sessionId))) {
      return this.#getOwnedPlaylist(sessionId, playlistId);
    }
    try {
      return await this.metadata.getPlaylist(playlistId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException(
          `Playlist ${playlistId} not found or private — sign in with Google to access private playlists.`,
        );
      }
      throw err;
    }
  }

  /**
   * Full detail for one of the signed-in user's playlists via the official Data API: title +
   * playable (public + unlisted) videoIds. Title and items are fetched in parallel so a click on
   * the picker resolves in ~one Data API round-trip's worth of wall-clock. Cached per
   * (sessionId, playlistId) with the same TTL as the summaries.
   */
  async #getOwnedPlaylist(sessionId: string, playlistId: string): Promise<OAuthPlaylist> {
    const cacheKey = `${PLAYLIST_KEY_PREFIX}${sessionId}:${playlistId}`;
    const cached = await this.cache.getJson<OAuthPlaylist>(cacheKey);
    if (cached) return cached;

    const accessToken = await this.auth.getValidAccessToken(sessionId);
    // playlistItems.snippet carries each item's title for free in the same call, so `videos`
    // already has the {id, title?} shape the UI labels rows from — no id→title splitting needed.
    const [title, videos] = await Promise.all([
      this.youtube.getPlaylistTitle(accessToken, playlistId),
      this.youtube.listPlaylistVideos(accessToken, playlistId),
    ]);
    const result: OAuthPlaylist = {
      id: playlistId,
      ...(title ? { title } : {}),
      videos,
    };
    await this.cache.setJson(cacheKey, result, PLAYLIST_CACHE_TTL_SECONDS);
    return result;
  }
}
