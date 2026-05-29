import { Controller, Get, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ArchiveService } from './archive.service';

const SESSION_COOKIE = 'ypd_session';

@ApiTags('downloads')
@Controller('downloads')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Get(':batchId/archive')
  @ApiProduces('application/zip')
  async download(
    @Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
    await this.archive.stream(batchId, sessionId, res);
  }
}
