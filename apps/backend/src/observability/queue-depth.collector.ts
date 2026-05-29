import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { CONVERT_QUEUE, DOWNLOAD_QUEUE } from '../jobs/job.types';
import { MetricsService } from './metrics.service';

const POLL_MS = 5000;

/** Polls BullMQ.getJobCounts every POLL_MS and writes them into the bullmq_queue_depth gauge.
 *  Replaces a per-event push model — counts are cheap (single HGETALL-shaped call per queue). */
@Injectable()
export class QueueDepthCollector implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly metrics: MetricsService,
    @InjectQueue(DOWNLOAD_QUEUE) private readonly downloadQueue: Queue,
    @InjectQueue(CONVERT_QUEUE) private readonly convertQueue: Queue,
  ) {}

  onModuleInit(): void {
    const tick = async (): Promise<void> => {
      await Promise.all([
        this.#sample('download', this.downloadQueue),
        this.#sample('convert', this.convertQueue),
      ]).catch(() => undefined);
    };
    // First sample now, then periodic. setInterval (not setTimeout) so transient errors
    // don't break the polling chain.
    void tick();
    this.timer = setInterval(() => void tick(), POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async #sample(queueLabel: string, queue: Queue): Promise<void> {
    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
    for (const [state, n] of Object.entries(counts)) {
      this.metrics.bullmqQueueDepth.set({ queue: queueLabel, state }, Number(n));
    }
  }
}
