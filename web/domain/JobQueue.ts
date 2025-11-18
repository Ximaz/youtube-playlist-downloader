import type { UUID } from "node:crypto";
import type { WSContext } from "hono/ws";
import { JobStatus, type JobTask } from "@web/domain/JobTask";

export default class JobQueue {
  private readonly jobs: Map<UUID, JobTask> = new Map();

  add(jobId: UUID, start: JobTask["start"]) {
    this.jobs.set(jobId, {
      id: jobId,
      start,
      websocket: null,
      status: JobStatus.PENDING,
    });
  }

  bindWebsocket(jobId: UUID, websocket: WSContext) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`No job ${jobId} found.`);
    job.websocket = websocket;
    if (job.status === JobStatus.PENDING) job.status = JobStatus.READY;
  }

  markRunning(jobId: UUID) {
    const job = this.jobs.get(jobId);
    if (job) job.status = JobStatus.RUNNING;
  }

  markDone(jobId: UUID) {
    const job = this.jobs.get(jobId);
    if (job) this.jobs.delete(jobId);
  }

  markError(jobId: UUID) {
    const job = this.jobs.get(jobId);
    if (job) this.jobs.delete(jobId);
  }

  cancel(jobId: UUID) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = JobStatus.CANCELLED;
      this.jobs.delete(jobId);
    }
  }

  getReadyJobs(): JobTask[] {
    return Array.from(this.jobs.values()).filter(
      (j) => j.status === JobStatus.READY,
    );
  }

  getRunningJobs(): JobTask[] {
    return Array.from(this.jobs.values()).filter(
      (j) => j.status === JobStatus.RUNNING,
    );
  }

  get(jobId: UUID): JobTask | undefined {
    return this.jobs.get(jobId);
  }
}
