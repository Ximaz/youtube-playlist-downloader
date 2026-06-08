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
 * assign it directly into the existing download flow.
 *
 * `videoTitles` maps videoId → title for the videos whose title is known at list time
 * (carried free from the Data API's playlistItems.snippet). The UI seeds each queue row's
 * label from it so titles show immediately instead of raw ids; absent entries fall back to
 * the id and get backfilled by the live `video:progress` events. */
export const OAuthPlaylistSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    videoIds: z.array(z.string()),
    videoTitles: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type OAuthPlaylist = z.infer<typeof OAuthPlaylistSchema>;

/** Billing/scheduling tier carried by every Session. `paid` for everyone today (no paid flow
 *  yet); drives the future free/paid queueing + bandwidth without a schema change. */
export const SessionTierSchema = z.enum(["free", "paid"]);
export type SessionTier = z.infer<typeof SessionTierSchema>;

/** GET /auth/me response — cheap signed-in check that doesn't touch the YouTube API.
 * `name`/`picture` come from the OpenID id_token captured at sign-in (the `profile` scope),
 * so the navbar can show the real account without a separate Google userinfo call. Both are
 * optional: a session predating the `profile` scope, or an account with no picture, omits them.
 * `tier` is present whenever a valid backend Session exists (anonymous or signed-in); its
 * ABSENCE signals a stale/missing session, which the frontend self-heals by minting a new one. */
export const AuthMeSchema = z
  .object({
    signedIn: z.boolean(),
    tier: SessionTierSchema.optional(),
    name: z.string().optional(),
    picture: z.url().optional(),
  })
  .strict();
export type AuthMe = z.infer<typeof AuthMeSchema>;
