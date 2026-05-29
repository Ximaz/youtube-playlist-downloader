import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { DownloadResponse, VideoProgress } from '@ypd/shared';
import type { Request } from 'express';

import { CreateDownloadDto } from './dto/create-download.dto';
import { StatusDownloadDto } from './dto/status-download.dto';
import { DownloadService } from './download.service';

const SESSION_COOKIE = 'ypd_session';

@ApiTags('downloads')
@Controller('downloads')
export class DownloadController {
  constructor(private readonly downloads: DownloadService) {}

  @Post()
  @ApiOkResponse({ description: 'Batch enqueued; subscribe to the videos over WebSocket.' })
  create(@Body() dto: CreateDownloadDto, @Req() req: Request): Promise<DownloadResponse> {
    // Bind the batch to the session if signed in, so the archive route can refuse cross-session
    // requests. Anonymous batches (no cookie) still work; their batchId UUID is the capability.
    const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
    return this.downloads.enqueue(dto, sessionId);
  }

  @Post('status')
  @ApiOkResponse({ description: 'Current state of each requested work item (UI resync on load).' })
  status(@Body() dto: StatusDownloadDto): Promise<VideoProgress[]> {
    return this.downloads.status(dto);
  }
}
