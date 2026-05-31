import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { DownloadResponse, VideoProgress } from '@ypd/shared';

import { SessionId } from '../auth/session-id.decorator';
import { CreateDownloadDto } from './dto/create-download.dto';
import { StatusDownloadDto } from './dto/status-download.dto';
import { DownloadService } from './download.service';

@ApiTags('downloads')
@Controller('downloads')
export class DownloadController {
  constructor(private readonly downloads: DownloadService) {}

  @Post()
  @ApiOkResponse({ description: 'Batch enqueued; subscribe to the videos over WebSocket.' })
  create(
    @Body() dto: CreateDownloadDto,
    @SessionId() sessionId?: string,
  ): Promise<DownloadResponse> {
    // Bind the batch to the session if signed in, so the archive route can refuse cross-session
    // requests. Anonymous batches (no token) still work; their batchId UUID is the capability.
    return this.downloads.enqueue(dto, sessionId);
  }

  @Post('status')
  @ApiOkResponse({ description: 'Current state of each requested work item (UI resync on load).' })
  status(@Body() dto: StatusDownloadDto): Promise<VideoProgress[]> {
    return this.downloads.status(dto);
  }
}
