import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CacheService } from '../cache/cache.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { StorageService } from '../storage/storage.service';

interface ReadinessReport {
  status: 'ready' | 'degraded';
  service: string;
  checks: Record<string, { ok: boolean; error?: string }>;
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly providers: ProviderRegistry,
    private readonly config: AppConfigService,
  ) {}

  /** Liveness probe: cheap, dependency-free. The container is running and the event loop
   *  is responsive. Used by Docker's HEALTHCHECK (no I/O so it's safe to fire every 10s). */
  @Get('health')
  liveness(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'backend' };
  }

  /** Readiness probe: returns 200 only when every downstream dep responds. Used by
   *  orchestrators (compose / Kubernetes) to decide whether to route traffic. */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness(): Promise<ReadinessReport> {
    const [db, valkey, s3, ...providerChecks] = await Promise.all([
      this.#timed('prisma', () => this.prisma.$queryRaw`SELECT 1`),
      this.#timed('valkey', () => this.cache.get('ready-probe')),
      this.#timed('s3', () => this.storage.head('__ready_probe__')),
      ...this.providers.providers.map((p) =>
        this.#timed(`provider:${p.name}`, () =>
          fetch(`${p.baseUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((res) => {
            if (!res.ok) throw new Error(`status ${res.status}`);
            return undefined;
          }),
        ),
      ),
    ]);

    const checks: ReadinessReport['checks'] = { db, valkey, s3 };
    for (let i = 0; i < providerChecks.length; i++) {
      const provider = this.providers.providers[i];
      const check = providerChecks[i];
      if (provider && check) checks[`provider:${provider.name}`] = check;
    }

    // Infra (db/valkey/s3) is non-negotiable. Providers are ordered-fallback, so the backend
    // is still ready as long as AT LEAST ONE provider answers — requiring ALL of them would
    // pull every backend pod out of LB rotation on a single provider blip.
    const infraOk = db.ok && valkey.ok && s3.ok;
    const providersOk = providerChecks.length === 0 || providerChecks.some((c) => c.ok);
    const ready = infraOk && providersOk;
    const report: ReadinessReport = {
      status: ready ? 'ready' : 'degraded',
      service: 'backend',
      checks,
    };
    if (!ready) throw new ServiceUnavailableException(report);
    return report;
  }

  async #timed(
    _label: string,
    fn: () => Promise<unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
