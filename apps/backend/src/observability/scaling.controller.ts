import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { type QueueBacklog, ScalingService } from './scaling.service';

/** Cluster-internal autoscaling endpoint: `GET /scaling/backlog` → pending job counts the KEDA
 *  metrics-api scaler reads to size the `backend-worker` Deployment. Excluded from Swagger — it's
 *  an operational signal, not part of the public API surface. */
@ApiExcludeController()
@Controller('scaling')
export class ScalingController {
  constructor(private readonly scaling: ScalingService) {}

  @Get('backlog')
  backlog(): Promise<QueueBacklog> {
    return this.scaling.backlog();
  }
}
