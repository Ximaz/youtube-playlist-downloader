import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { VideoIdSchema } from '@ypd/shared';
import { ZodValidationPipe } from 'nestjs-zod';

import { VideoMetadataDto } from './dto/metadata.dto';
import { MetadataService } from './metadata.service';

/** Read-only video metadata. Split out of the original (unprefixed) MetadataController so
 *  each resource has a dedicated controller — easier to find, easier to namespace later. */
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly metadata: MetadataService) {}

  @Get(':id')
  @ApiOkResponse({ type: VideoMetadataDto })
  get(@Param('id', new ZodValidationPipe(VideoIdSchema)) id: string): Promise<VideoMetadataDto> {
    return this.metadata.getVideo(id);
  }
}
