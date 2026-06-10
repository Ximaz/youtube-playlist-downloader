import { Controller, Get, Header, Res } from '@nestjs/common';
import { MetricsService } from '@ypd/backend-core';
import type { Response } from 'express';

/** Plain-text Prometheus exposition at `/metrics`. The worker has no Swagger, so unlike the API's
 *  metrics controller this needs no `@ApiExcludeController`. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async render(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.contentType());
    res.send(await this.metrics.render());
  }
}
