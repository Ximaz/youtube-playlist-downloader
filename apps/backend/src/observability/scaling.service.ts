import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { CONVERT_QUEUE, DOWNLOAD_QUEUE } from '@ypd/backend-core';
import type { Queue } from 'bullmq';

/** Pending-work counts per pool plus their sum — what the KEDA metrics-api scaler reads. */
export interface QueueBacklog {
  download: number;
  convert: number;
  total: number;
}

/**
 * Cluster-internal autoscaling signal. `backlog()` reports how many jobs are WAITING to start
 * (not yet active), summed across the three not-started states: `waiting` (no priority),
 * `prioritized` (jobs enqueued with a priority — downloads always set `durationPriority`, so they
 * land here, not in `waiting`), and `delayed` (scheduled / in retry back-off). Active jobs are
 * excluded so the scaler targets the queue depth that more replicas would drain. Runs on the API
 * because that's where the queues are already injected (for enqueue) and `getJobCounts` is cheap.
 */
@Injectable()
export class ScalingService {
  constructor(
    @InjectQueue(DOWNLOAD_QUEUE) private readonly downloadQueue: Queue,
    @InjectQueue(CONVERT_QUEUE) private readonly convertQueue: Queue,
  ) {}

  async backlog(): Promise<QueueBacklog> {
    const [download, convert] = await Promise.all([
      this.#pending(this.downloadQueue),
      this.#pending(this.convertQueue),
    ]);
    return { download, convert, total: download + convert };
  }

  async #pending(queue: Queue): Promise<number> {
    // Sum the three named states explicitly. Do NOT reduce Object.values(): bullmq's
    // getJobCounts injects a 'paused' key whenever 'waiting' is requested, which would fold a
    // paused queue's jobs into the backlog and over-scale workers that can't drain them.
    const counts = await queue.getJobCounts('waiting', 'prioritized', 'delayed');
    return (
      Number(counts.waiting ?? 0) + Number(counts.prioritized ?? 0) + Number(counts.delayed ?? 0)
    );
  }
}
