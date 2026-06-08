import { monitorEventLoopDelay } from 'node:perf_hooks';

// youtubei.js work (getInfo parsing, signature deciphering, PO-token/BotGuard generation) runs
// on the single Node event loop. When the loop falls behind, the process is genuinely saturated
// — measured directly via the event-loop delay histogram (≈free), not an arbitrary request cap.
// The recent p99 lag drives both /ready (so K8s drains a saturated pod) and a request-path 429
// (so the backend backs off / falls back). Streaming byte-piping is I/O, not loop-bound, so
// in-flight downloads keep flowing; only NEW extraction is shed.
const LAG_BUDGET_MS = Math.max(1, Number(process.env.PROVIDER_LAG_BUDGET_MS ?? 250));
const SAMPLE_INTERVAL_MS = Math.max(250, Number(process.env.PROVIDER_LAG_SAMPLE_MS ?? 1000));

class SaturationMonitor {
  readonly #histogram = monitorEventLoopDelay({ resolution: 20 });
  #lagMs = 0;

  constructor() {
    this.#histogram.enable();
    // Recompute the rolling p99 each window and reset, so the signal reflects RECENT lag rather
    // than the lifetime histogram. unref() so this never keeps the process alive on shutdown.
    const timer = setInterval(() => {
      this.#lagMs = this.#histogram.percentile(99) / 1e6; // ns → ms
      this.#histogram.reset();
    }, SAMPLE_INTERVAL_MS);
    timer.unref();
  }

  /** Recent p99 event-loop delay, milliseconds. */
  get lagMs(): number {
    return Math.round(this.#lagMs * 10) / 10;
  }

  get saturated(): boolean {
    return this.#lagMs > LAG_BUDGET_MS;
  }

  get budgetMs(): number {
    return LAG_BUDGET_MS;
  }
}

/** Process-wide singleton — one event loop, one monitor. */
export const saturation = new SaturationMonitor();
