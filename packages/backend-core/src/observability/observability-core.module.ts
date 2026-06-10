import { Global, Module } from '@nestjs/common';

import { MetricsService } from './metrics.service';

// Process-wide Prometheus registry (default Node metrics) + the custom YPD gauges, shared by
// the API and worker images. The HTTP `/metrics` controller is registered per-app (the API keeps
// its Swagger-excluded one; the worker exposes a plain one) so this module — and therefore both
// images — stay free of `@nestjs/swagger`. @Global so any provider can inject MetricsService.
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityCoreModule {}
