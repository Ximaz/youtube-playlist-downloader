import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { CacheService, ProviderRegistry, StorageService } from '@ypd/backend-core';

interface ReadinessReport {
  status: 'ready' | 'degraded';
  service: string;
  checks: Record<string, { ok: boolean; error?: string }>;
}

@Controller()
export class HealthController {
  constructor(
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly providers: ProviderRegistry,
  ) {}

  /** Liveness probe: cheap, dependency-free. The container is running and the event loop is
   *  responsive. Used by Docker's HEALTHCHECK (no I/O so it's safe to fire every 10s). */
  @Get('health')
  liveness(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'worker' };
  }

  /** Readiness probe: 200 only when the infra the worker needs to RUN jobs is reachable. Unlike
   *  the API, the worker never touches Postgres, so there is NO db check — only valkey + s3 +
   *  at-least-one provider (the pipeline calls MetadataService.getVideo and opens provider
   *  streams). Infra (valkey/s3) is non-negotiable; providers are ordered-fallback so one healthy
   *  provider is enough. */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness(): Promise<ReadinessReport> {
    const [valkey, s3, ...providerChecks] = await Promise.all([
      this.#timed(() => this.cache.get('ready-probe')),
      this.#timed(() => this.storage.head('__ready_probe__')),
      ...this.providers.providers.map((p) =>
        this.#timed(() =>
          fetch(`${p.baseUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((res) => {
            if (!res.ok) throw new Error(`status ${res.status}`);
            return undefined;
          }),
        ),
      ),
    ]);

    const checks: ReadinessReport['checks'] = { valkey, s3 };
    for (let i = 0; i < providerChecks.length; i++) {
      const provider = this.providers.providers[i];
      const check = providerChecks[i];
      if (provider && check) checks[`provider:${provider.name}`] = check;
    }

    const infraOk = valkey.ok && s3.ok;
    const providersOk = providerChecks.length === 0 || providerChecks.some((c) => c.ok);
    const ready = infraOk && providersOk;
    const report: ReadinessReport = {
      status: ready ? 'ready' : 'degraded',
      service: 'worker',
      checks,
    };
    if (!ready) throw new ServiceUnavailableException(report);
    return report;
  }

  async #timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
