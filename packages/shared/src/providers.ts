/** Provider error contract. Both backend (ProviderClient) and the providers themselves
 *  agree on this shape; the providers emit it and the backend decodes it on non-2xx. */

import { z } from "zod";

export const ProviderErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "VIDEO_NOT_FOUND",
  "PLAYLIST_NOT_FOUND",
  "FORMAT_NOT_FOUND",
  "UPSTREAM_ERROR",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "INTERNAL",
]);
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;

export const ProviderErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: ProviderErrorCodeSchema,
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type ProviderErrorEnvelope = z.infer<typeof ProviderErrorEnvelopeSchema>;
