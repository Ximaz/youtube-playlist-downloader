import type { UUID } from "node:crypto";
import z from "zod";

export const zDownloadPlaylistWorkerParams = z
  .object({
    playlistId: z.string().nonempty(),
    forceRefresh: z.boolean().optional().default(false),
    audio: z.boolean().optional().default(false),
    video: z.boolean().optional().default(false),
  })
  .refine(({ audio, video }) => audio || video, {
    error: "At least one type of stream must be supplied.",
  });

export type DownloadPlaylistWorkerParams = {
  jobId: UUID;
  params: z.infer<typeof zDownloadPlaylistWorkerParams>;
};

export const zDownloadPlaylistArchive = z
  .object({
    audio: z
      .union([z.literal("true"), z.literal("false")])
      .optional()
      .default("false"),
    video: z
      .union([z.literal("true"), z.literal("false")])
      .optional()
      .default("false"),
  })
  .refine(({ audio, video }) => "true" === audio || "true" === video, {
    error: "At least one type of stream must be supplied.",
  });
