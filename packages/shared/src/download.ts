/** Download request/response contracts between frontend and backend. Schemas
 * are the source of truth — the inferred types keep the prior public names. */

import { z } from "zod";

/** What the user wants per video. `merged` muxes video+audio into one file. */
export const MediaSelectionSchema = z.enum(["audio", "video", "merged"]);
export type MediaSelection = z.infer<typeof MediaSelectionSchema>;

/** `original` = no transcode (weba/webm). `converted` = ffmpeg (m4a/mp4). */
export const OutputFormatSchema = z.enum(["original", "converted"]);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

/** YouTube video id: fixed 11-char URL-safe base64-ish. */
export const VideoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/, "invalid YouTube video id");
/** YouTube playlist id: variable-length URL-safe base64-ish; tolerant of all the public
 *  formats yt-dlp / youtubejs accept (PL…, RD…, OL…, etc.). */
export const PlaylistIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{13,42}$/, "invalid YouTube playlist id");

/** POST /downloads body. The "at least one of playlistId / videoIds" rule is enforced
 *  via `refine` here — single source of truth (the previous service-level BadRequest is
 *  now a clean 400 at the pipe). */
export const DownloadRequestSchema = z
  .object({
    playlistId: PlaylistIdSchema.optional(),
    videoIds: z.array(VideoIdSchema).min(1).optional(),
    selection: MediaSelectionSchema,
    format: OutputFormatSchema,
  })
  .strict()
  .refine((d) => Boolean(d.playlistId) || (d.videoIds?.length ?? 0) > 0, {
    message: "one of playlistId or videoIds is required",
  });
export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;

/** POST /downloads response. */
export const DownloadResponseSchema = z
  .object({
    /** Thin handle that groups the downloadable videos for the archive URL. */
    batchId: z.string(),
    /** Videos that will be downloaded (excludes unavailable). */
    videoIds: z.array(z.string()),
    /** Videos no provider could resolve — surfaced to the UI, never queued. */
    unavailable: z.array(z.string()),
  })
  .strict();
export type DownloadResponse = z.infer<typeof DownloadResponseSchema>;

/**
 * Identifies a set of work items: each (videoId, selection, format) is processed once,
 * regardless of how many playlists/requests reference it. Used as the POST /downloads/status
 * body AND the WebSocket `subscribe` payload — same shape, same validation.
 */
export const WorkSelectorSchema = z
  .object({
    videoIds: z.array(z.string()).min(1),
    selection: MediaSelectionSchema,
    format: OutputFormatSchema,
  })
  .strict();
export type WorkSelector = z.infer<typeof WorkSelectorSchema>;

/**
 * The unit of processing. One video can appear in many playlists, but a given
 * (videoId, selection, format) is only ever downloaded/converted once.
 */
export function workKey(
  videoId: string,
  selection: MediaSelection,
  format: OutputFormat,
): string {
  return `${videoId}:${selection}:${format}`;
}

/**
 * Deterministic BullMQ job id for a work item's stage (`dl` download / `cv` convert).
 * Colon-free because BullMQ forbids `:` in custom ids. Re-adding the same id while it is
 * in flight is a no-op, which is what dedups re-clicks and videos shared across playlists.
 */
export function workJobId(
  stage: "dl" | "cv",
  videoId: string,
  selection: MediaSelection,
  format: OutputFormat,
): string {
  return `${stage}_${videoId}_${selection}_${format}`;
}

/**
 * Deterministic output extension for a given selection+format. For `original`
 * audio/video the true extension comes from the provider stream headers
 * (usually weba/webm), so this only resolves the unambiguous cases.
 */
export function convertedExtension(selection: MediaSelection): "m4a" | "mp4" {
  return selection === "audio" ? "m4a" : "mp4";
}
