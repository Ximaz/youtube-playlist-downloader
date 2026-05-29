/** WebSocket (socket.io) message contracts. Schemas are the source of truth;
 * the gateway parses inbound `subscribe` payloads and frontends infer the
 * outbound `video:progress` shape via `z.infer<typeof VideoProgressSchema>`. */

import { z } from "zod";

import {
  MediaSelectionSchema,
  OutputFormatSchema,
  workKey,
  WorkSelectorSchema,
} from "./download";
import type { MediaSelection, OutputFormat, WorkSelector } from "./download";

/** Per-video lifecycle step.
 *  - `cached`: deliverable already in object storage; counted as done, no work performed.
 *  - `unavailable`: no provider could resolve the video (deleted / private / 404 mid-job). */
export const VideoStepSchema = z.enum([
  "queued",
  "download",
  "convert",
  "done",
  "cached",
  "failed",
  "unavailable",
]);
export type VideoStep = z.infer<typeof VideoStepSchema>;

/** Progress for one work item (videoId + selection + format). */
export const VideoProgressSchema = z
  .object({
    videoId: z.string(),
    selection: MediaSelectionSchema,
    format: OutputFormatSchema,
    step: VideoStepSchema,
    /** 0..100 for the current step where measurable (download/convert). */
    pct: z.number().int().min(0).max(100).optional(),
    title: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
export type VideoProgress = z.infer<typeof VideoProgressSchema>;

/** Re-export so consumers don't need a second import for the subscribe payload. */
export { WorkSelectorSchema };

/** A video's terminal step has no further progress; the client derives batch completion. */
export const TERMINAL_STEPS: ReadonlyArray<VideoStep> = [
  "done",
  "cached",
  "failed",
  "unavailable",
];

/** Server -> client events (socket.io event name -> payload). */
export interface ServerToClientEvents {
  "video:progress": (msg: VideoProgress) => void;
}

/** Client -> server events. The client subscribes to the work items it renders. */
export interface ClientToServerEvents {
  subscribe: (req: WorkSelector) => void;
}

/** socket.io room for live progress of one work item. */
export const roomForWork = (
  videoId: string,
  selection: MediaSelection,
  format: OutputFormat,
): string => `work:${workKey(videoId, selection, format)}`;
