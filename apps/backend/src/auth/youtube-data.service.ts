import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { OAuthThumbnail } from '@ypd/shared';
import { z } from 'zod';

/** Backend-only Zod schemas for the YouTube Data API responses we actually consume. Kept
 *  local to this service (not in `@ypd/shared`) — these are an external Google contract,
 *  not the frontend/backend API surface. */
const YtThumbnailSchema = z
  .object({
    url: z.string().url(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

const PlaylistsResponseSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string(),
          snippet: z
            .object({
              title: z.string().optional(),
              // YouTube's snippet.thumbnails is a free-form record keyed by size name
              // (default/medium/high/standard/maxres). We accept any keys and pick the
              // largest at extraction time. `.passthrough()` so unknown keys don't fail.
              thumbnails: z.record(z.string(), YtThumbnailSchema).optional(),
            })
            .partial()
            .optional(),
          contentDetails: z
            .object({ itemCount: z.number().int().nonnegative().optional() })
            .partial()
            .optional(),
        }),
      )
      .optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough();
type PlaylistsResponse = z.infer<typeof PlaylistsResponseSchema>;

const PlaylistItemsResponseSchema = z
  .object({
    items: z
      .array(
        z.object({
          contentDetails: z.object({ videoId: z.string().optional() }).partial().optional(),
          status: z.object({ privacyStatus: z.string().optional() }).partial().optional(),
        }),
      )
      .optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough();

const YT_PAGE_SIZE = 50;

export interface YouTubePlaylistSummary {
  id: string;
  title?: string;
  itemCount: number;
  thumbnail?: OAuthThumbnail;
}

/** Pick the largest thumbnail by area from YouTube's free-form thumbnails record.
 *  Returns undefined when the snippet has no thumbnails (rare). */
function bestThumbnail(
  thumbnails: Record<string, { url: string; width?: number; height?: number }> | undefined,
): OAuthThumbnail | undefined {
  if (!thumbnails) return undefined;
  let best: OAuthThumbnail | undefined;
  let bestArea = -1;
  for (const t of Object.values(thumbnails)) {
    const area = (t.width ?? 0) * (t.height ?? 0);
    if (area > bestArea) {
      bestArea = area;
      best = t;
    }
  }
  return best;
}

/**
 * Thin client over the YouTube Data v3 endpoints we use during the OAuth flow. Lives in its
 * own service so AuthService stays focused on the OAuth lifecycle (session, refresh, signOut)
 * and so the Zod-at-the-boundary discipline matches ProviderClientService.
 */
@Injectable()
export class YouTubeDataService {
  private readonly logger = new Logger(YouTubeDataService.name);

  /** Lists every playlist the authenticated user owns (paginated). */
  async listMyPlaylists(accessToken: string): Promise<YouTubePlaylistSummary[]> {
    const out: YouTubePlaylistSummary[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
      url.searchParams.set('part', 'snippet,contentDetails');
      url.searchParams.set('mine', 'true');
      url.searchParams.set('maxResults', String(YT_PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = await this.#get(url, accessToken, PlaylistsResponseSchema);
      for (const item of body.items ?? []) {
        out.push({
          id: item.id,
          title: item.snippet?.title,
          itemCount: item.contentDetails?.itemCount ?? 0,
          thumbnail: bestThumbnail(item.snippet?.thumbnails),
        });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getPlaylistTitle(accessToken: string, playlistId: string): Promise<string | undefined> {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('id', playlistId);
    url.searchParams.set('maxResults', '1');
    const body: PlaylistsResponse = await this.#get(url, accessToken, PlaylistsResponseSchema);
    return body.items?.[0]?.snippet?.title;
  }

  /** Playlist items for the playlist, filtered to public + unlisted (the ones we can download). */
  async listPlaylistVideoIds(accessToken: string, playlistId: string): Promise<string[]> {
    const out: string[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      url.searchParams.set('part', 'contentDetails,status');
      url.searchParams.set('playlistId', playlistId);
      url.searchParams.set('maxResults', String(YT_PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = await this.#get(url, accessToken, PlaylistItemsResponseSchema);
      for (const item of body.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        const privacy = item.status?.privacyStatus;
        if (videoId && (privacy === 'public' || privacy === 'unlisted')) out.push(videoId);
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  async #get<S extends z.ZodType>(url: URL, accessToken: string, schema: S): Promise<z.infer<S>> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) {
      throw new UnauthorizedException('YouTube Data API rejected the access token.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`YouTube Data API ${res.status}: ${text.slice(0, 200)}`);
    }
    const raw = await res.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `YouTube Data contract violation on ${url.pathname}: ${parsed.error.issues[0]?.message}`,
      );
      throw new Error('YouTube Data API returned an unexpected shape.');
    }
    return parsed.data;
  }
}
