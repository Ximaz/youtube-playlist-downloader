import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';

export interface ProviderEndpoint {
  name: string;
  baseUrl: string;
}

/** Ordered list of providers, built from PROVIDER_ORDER + PROVIDER_<NAME>_URL. */
@Injectable()
export class ProviderRegistry {
  readonly providers: ProviderEndpoint[];

  constructor(config: AppConfigService) {
    const { order, urls } = config.providers;
    this.providers = order
      .filter((name) => urls[name])
      .map((name) => ({ name, baseUrl: urls[name].replace(/\/+$/, '') }));
  }
}
