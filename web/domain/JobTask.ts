import type { UUID } from "node:crypto";
import type { Worker } from "node:worker_threads";
import type { WSContext } from "hono/ws";

export enum JobStatus {
  PENDING = "PENDING",
  READY = "READY",
  RUNNING = "RUNNING",
  DONE = "DONE",
  ERROR = "ERROR",
  CANCELLED = "CANCELLED",
}

export interface JobTask {
  id: UUID;
  start: () => Worker;
  websocket: WSContext | null;
  status: JobStatus;
}
