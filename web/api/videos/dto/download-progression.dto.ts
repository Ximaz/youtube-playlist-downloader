import z from "zod";

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
