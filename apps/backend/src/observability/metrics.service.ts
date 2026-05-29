import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  type Metric,
  Registry,
} from 'prom-client';

/**
 * Single shared registry + the YPD-specific counters/histograms.
 *
 * Naming follows prom conventions: `<subsystem>_<unit_plural>_<base_unit>` (e.g.
 * `provider_request_duration_seconds`, `s3_op_duration_seconds`). All labels are
 * cardinality-bounded — provider names, queue names, HTTP status families.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly providerRequestDuration = new Histogram({
    name: 'provider_request_duration_seconds',
    help: 'Duration of provider HTTP calls (JSON metadata + stream open).',
    labelNames: ['provider', 'path', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  });

  readonly providerFallbacks = new Counter({
    name: 'provider_fallbacks_total',
    help: 'A provider failed and the next was tried (or none was available).',
    labelNames: ['from', 'reason'],
  });

  readonly contractViolations = new Counter({
    name: 'contract_violations_total',
    help: 'Provider response failed Zod validation against @ypd/shared schemas.',
    labelNames: ['provider', 'path'],
  });

  readonly s3OpDuration = new Histogram({
    name: 's3_op_duration_seconds',
    help: 'Duration of S3 ops by name (head, get, put, head-bucket).',
    labelNames: ['op'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 1, 5],
  });

  readonly bullmqQueueDepth = new Gauge({
    name: 'bullmq_queue_depth',
    help: 'BullMQ jobs in each state per queue.',
    labelNames: ['queue', 'state'],
  });

  onModuleInit(): void {
    // Default Node + process metrics (event-loop lag, GC, memory, fd counts).
    collectDefaultMetrics({ register: this.registry });
    const customs: Metric<string>[] = [
      this.providerRequestDuration,
      this.providerFallbacks,
      this.contractViolations,
      this.s3OpDuration,
      this.bullmqQueueDepth,
    ];
    for (const m of customs) this.registry.registerMetric(m);
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
