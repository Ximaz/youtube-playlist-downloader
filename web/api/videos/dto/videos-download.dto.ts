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
