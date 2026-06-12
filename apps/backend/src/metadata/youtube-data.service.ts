import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { OAuthThumbnail } from '@ypd/shared';
import { z } from 'zod';

/** Backend-only Zod schemas for the YouTube Data API responses we actually consume. Kept
 *  local to this service (not in `@ypd/shared`) — these are an external Google contract,
 *  not the frontend/backend API surface. */
const YtThumbnailSchema = z
  .object({
    url: z.url(),
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
  .loose();
type PlaylistsResponse = z.infer<typeof PlaylistsResponseSchema>;

const PlaylistItemsResponseSchema = z
  .object({
    items: z
      .array(
        z.object({
          // snippet.title is the per-video title — carried free in the same call (the `snippet`
          // part) so the UI can label queue rows without a second videos.list round-trip.
          snippet: z.object({ title: z.string().optional() }).partial().optional(),
          contentDetails: z.object({ videoId: z.string().optional() }).partial().optional(),
          status: z.object({ privacyStatus: z.string().optional() }).partial().optional(),
        }),
      )
      .optional(),
    nextPageToken: z.string().optional(),
  })
  .loose();

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
 * Thin client over the official YouTube Data v3 endpoints — the *authenticated* metadata path,
 * the counterpart to the token-free provider extraction in MetadataService. Lives next to the
 * metadata controllers (not under auth/) because fetching playlist metadata is a metadata
 * concern, not an auth one: `auth/` only vends the token, `PlaylistsService` calls this. Every
 * method takes an `accessToken` because Google's official API is auth-only by design, not
 * because the data itself requires it. Zod-at-the-boundary discipline matches ProviderClientService.
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

  /** Playlist items (id + title) filtered to public + unlisted (the ones we can download).
   *  The `snippet` part carries the title in the same call — no extra videos.list round-trip. */
  async listPlaylistVideos(
    accessToken: string,
    playlistId: string,
  ): Promise<{ id: string; title?: string }[]> {
    const out: { id: string; title?: string }[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      url.searchParams.set('part', 'snippet,contentDetails,status');
      url.searchParams.set('playlistId', playlistId);
      url.searchParams.set('maxResults', String(YT_PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = await this.#get(url, accessToken, PlaylistItemsResponseSchema);
      for (const item of body.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        const privacy = item.status?.privacyStatus;
        if (videoId && (privacy === 'public' || privacy === 'unlisted')) {
          // YouTube reports deleted/private items with the placeholder titles below; drop those
          // so the row falls back to the id (and gets the real title from the download stage)
          // rather than showing a misleading "Deleted video".
          const title = item.snippet?.title;
          out.push({
            id: videoId,
            ...(title && title !== 'Deleted video' && title !== 'Private video' ? { title } : {}),
          });
        }
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
