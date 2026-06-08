import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AppConfig,
  AppRole,
  CacheConfig,
  GoogleOAuthConfig,
  ProvidersConfig,
  StorageConfig,
} from './configuration';

/** Typed accessor over ConfigService so the rest of the app never touches process.env. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get port(): number {
    return this.config.get('port', { infer: true });
  }

  get appRole(): AppRole {
    return this.config.get('appRole', { infer: true });
  }

  /** True when this process runs the BullMQ worker pools (worker or all). */
  get runsWorkers(): boolean {
    return this.appRole === 'worker' || this.appRole === 'all';
  }

  /** True when this process serves the API + WebSocket gateway (api or all). */
  get runsApi(): boolean {
    return this.appRole === 'api' || this.appRole === 'all';
  }

  get publicBaseUrl(): string {
    return this.config.get('publicBaseUrl', { infer: true });
  }

  get frontendOrigin(): string {
    return this.config.get('frontendOrigin', { infer: true });
  }

  get downloadConcurrency(): number {
    return this.config.get('downloadConcurrency', { infer: true });
  }

  get convertConcurrency(): number {
    return this.config.get('convertConcurrency', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('databaseUrl', { infer: true });
  }

  get providers(): ProvidersConfig {
    return this.config.get('providers', { infer: true });
  }

  get storage(): StorageConfig {
    return this.config.get('storage', { infer: true });
  }

  get cache(): CacheConfig {
    return this.config.get('cache', { infer: true });
  }

  get google(): GoogleOAuthConfig {
    return this.config.get('google', { infer: true });
  }
}
