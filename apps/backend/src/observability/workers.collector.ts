import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CONVERT_QUEUE, DOWNLOAD_QUEUE, MetricsService } from '@ypd/backend-core';
import type { Queue } from 'bullmq';

const POLL_MS = 5000;

/** Exposes the worker fleet size as bullmq_workers_connected{queue}. Runs on the API (where the
 *  queues are already injected for enqueue) so the central /metrics answers "how many worker
 *  instances are alive", complementing each worker's own per-instance bullmq_worker_active /
 *  bullmq_worker_concurrency. getWorkers() is a CLIENT LIST-backed call over Valkey, so it stays
 *  cheap at this cadence. Pull-based pools → this feeds autoscaling/observability, not LB routing. */
@Injectable()
export class WorkersCollector implements OnModuleInit, OnModuleDestroy {
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
    // First sample now, then periodic. setInterval (not chained setTimeout) so a transient Valkey
    // error doesn't break the polling chain.
    void tick();
    this.timer = setInterval(() => void tick(), POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async #sample(queueLabel: string, queue: Queue): Promise<void> {
    const workers = await queue.getWorkers();
    this.metrics.workersConnected.set({ queue: queueLabel }, workers.length);
  }
}
