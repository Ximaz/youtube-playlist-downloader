/** Media + playlist metadata. Zod schemas are the single source of truth; the
 * inferred TS types preserve the prior public names so callers don't change. */

import { z } from "zod";

export const ThumbnailSchema = z
  .object({
    // Reject non-URL strings and javascript:/file:/data: at the boundary. The pipeline
    // additionally rejects private CIDRs + non-https (see PipelineService#downloadThumbnail).
    url: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//i.test(u), { message: "must be http(s)" }),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();
export type Thumbnail = z.infer<typeof ThumbnailSchema>;

export const FormatDescriptorSchema = z
  .object({
    /** itag: number, sometimes a string id for non-numeric itags. */
    itag: z.union([z.number(), z.string()]),
    /** File extension for the original download: weba | webm | m4a | mp4. */
    ext: z.string(),
    /** webm | mp4 */
    container: z.string(),
    /** opus | mp4a | vp9 | av01 | avc */
    codec: z.string().optional(),
    bitrate: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    contentLength: z.number().int().nonnegative().optional(),
  })
  .strict();
export type FormatDescriptor = z.infer<typeof FormatDescriptorSchema>;

export const VideoMetadataSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    author: z.string().optional(),
    channelId: z.string().optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    /** YYYY-MM-DD */
    publishedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    thumbnails: z.array(ThumbnailSchema),
    bestAudio: FormatDescriptorSchema.optional(),
    bestVideo: FormatDescriptorSchema.optional(),
  })
  .strict();
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

export const PlaylistMetadataSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    author: z.string().optional(),
    videoIds: z.array(z.string()),
    /** videoId → title for the videos whose title is known at list time. Providers carry it
     *  for free from their flat playlist extraction; the UI seeds queue-row labels from it so
     *  titles show immediately instead of raw ids (missing entries fall back to the id). */
    videoTitles: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type PlaylistMetadata = z.infer<typeof PlaylistMetadataSchema>;
