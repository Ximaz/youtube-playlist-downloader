import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { MetricsService } from './metrics.service';

/** Plain-text Prometheus exposition at `/metrics`. Excluded from Swagger — it's an
 *  operational endpoint, not an API surface. */
@ApiExcludeController()
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
