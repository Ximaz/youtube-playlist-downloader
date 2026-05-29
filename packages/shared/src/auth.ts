/** Auth-domain contracts shared between backend and frontend. Schemas are the
 * source of truth; the inferred TS types carry the same names. */

import { z } from "zod";

/** A thumbnail URL + dimensions (subset of the YouTube Data API thumbnail shape we keep). */
export const OAuthThumbnailSchema = z
  .object({
    url: z.url(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();
export type OAuthThumbnail = z.infer<typeof OAuthThumbnailSchema>;

/** GET /auth/playlists — lightweight per-playlist summary for the picker. itemCount
 * comes from the Data API's contentDetails part; thumbnails come from the snippet part
 * (same call, no extra round-trip). The videoIds are NOT fetched here (lazy: clicking a
 * playlist hits /auth/playlists/:id). */
export const OAuthPlaylistSummarySchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    itemCount: z.number().int().nonnegative(),
    /** Best available thumbnail (largest by area) the picker grid renders. Optional
     *  because some playlists (rare) report no thumbnails on the snippet. */
    thumbnail: OAuthThumbnailSchema.optional(),
  })
  .strict();
export type OAuthPlaylistSummary = z.infer<typeof OAuthPlaylistSummarySchema>;

/** GET /auth/playlists/:id — one playlist's playable (public + unlisted) videos,
 * filtered server-side. The shape mirrors PlaylistMetadata so the frontend can
 * assign it directly into the existing download flow. */
export const OAuthPlaylistSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    videoIds: z.array(z.string()),
  })
  .strict();
export type OAuthPlaylist = z.infer<typeof OAuthPlaylistSchema>;

/** GET /auth/me response — cheap signed-in check that doesn't touch the YouTube API. */
export const AuthMeSchema = z.object({ signedIn: z.boolean() }).strict();
export type AuthMe = z.infer<typeof AuthMeSchema>;
