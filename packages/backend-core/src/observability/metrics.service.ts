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

  // Worker capacity signal (per worker instance — Prometheus distinguishes pods by target labels).
  // active/concurrency = utilization; aggregate across pods in PromQL for fleet saturation, which a
  // KEDA/HPA scaler consumes (the worker pools are pull-based, so this drives autoscaling, not LB
  // routing). Only the worker image populates these; the API's /metrics simply never emits them.
  readonly workerActive = new Gauge({
    name: 'bullmq_worker_active',
    help: 'Jobs currently being processed by THIS worker instance, per pool.',
    labelNames: ['pool'],
  });

  readonly workerConcurrency = new Gauge({
    name: 'bullmq_worker_concurrency',
    help: 'Configured max concurrent jobs for THIS worker instance, per pool.',
    labelNames: ['pool'],
  });

  // Fleet size: how many worker instances are currently connected to each queue (via BullMQ's
  // client tracking). Populated on the API side, where the queues are injected for enqueue.
  readonly workersConnected = new Gauge({
    name: 'bullmq_workers_connected',
    help: 'Worker instances currently connected to each BullMQ queue (fleet size).',
    labelNames: ['queue'],
  });

  // Per-dependency readiness (1 = ok, 0 = failing), published by each /ready handler. `component` is
  // backend|worker; `check` is db|valkey|s3|provider:<name>. Surfaces exactly which dependency is
  // down per pod, beyond the binary pod-level readiness kube-state-metrics already exposes.
  readonly readinessCheck = new Gauge({
    name: 'ypd_readiness_check',
    help: 'Readiness of each downstream dependency from the /ready handler (1 = ok, 0 = failing).',
    labelNames: ['component', 'check'],
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
      this.workerActive,
      this.workerConcurrency,
      this.workersConnected,
      this.readinessCheck,
    ];
    for (const m of customs) this.registry.registerMetric(m);
  }

  /** Publish a /ready check map as gauges. Called by the health controllers on every probe. */
  setReadiness(component: string, checks: Record<string, { ok: boolean }>): void {
    for (const [check, { ok }] of Object.entries(checks)) {
      this.readinessCheck.set({ component, check }, ok ? 1 : 0);
    }
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
