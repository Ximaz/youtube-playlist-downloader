import z from "zod";

export const videosDownloadDto = z
  .object({
    videoIds: z.array(z.string()).nonempty(),
    audio: z.boolean().optional().default(false),
    video: z.boolean().optional().default(false),
    convert: z.boolean().optional().default(false),
    forceRefresh: z.boolean().optional().default(false),
  })
  .refine(({ audio, video }) => audio || video, {
    error: "At least one channel type must be set to 'true': audio, video",
  });

export type VideosDownloadDto = z.infer<typeof videosDownloadDto>;

export const videosExportDto = z
  .object({
    videoIds: z.array(z.string()).nonempty(),
    audio: z.boolean().optional().default(false),
    video: z.boolean().optional().default(false),
    convert: z.boolean().optional().default(false),
  })
  .refine(({ audio, video }) => audio || video, {
    error: "At least one channel type must be set to 'true': audio, video",
  });

export type VideosExportDto = z.infer<typeof videosExportDto>;

export const videoDownloadDto = z
  .object({
    videoId: z.string().nonempty(),
    audio: z.boolean().optional().default(false),
    video: z.boolean().optional().default(false),
    convert: z.boolean().optional().default(false),
    forceRefresh: z.boolean().optional().default(false),
  })
  .refine(({ audio, video }) => audio || video, {
    error: "At least one channel type must be set to 'true': audio, video",
  });

export type VideoDownloadDto = z.infer<typeof videoDownloadDto>;

export const videoDownloadProgressDto = z.object({
  videoId: z.string().nonempty(),
  total: z.number(),
  processed: z.number(),
  step: z.union([
    z.literal("downloading"),
    z.literal("converting"),
    z.literal("storing"),
    z.literal("compressing"),
  ]),
});

export type VideoDownloadProgressDto = z.infer<typeof videoDownloadProgressDto>;
