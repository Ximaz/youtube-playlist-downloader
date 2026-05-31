import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { SessionId } from '../auth/session-id.decorator';
import { ArchiveService } from './archive.service';

@ApiTags('downloads')
@Controller('downloads')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Get(':batchId/archive')
  @ApiProduces('application/zip')
  async download(
    @Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string,
    @Res() res: Response,
    @SessionId() sessionId?: string,
  ): Promise<void> {
    await this.archive.stream(batchId, sessionId, res);
  }
}
