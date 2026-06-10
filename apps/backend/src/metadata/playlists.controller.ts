import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlaylistIdSchema } from '@ypd/shared';
import { ZodValidationPipe } from 'nestjs-zod';

import { MetadataService } from '@ypd/backend-core';

import { PlaylistMetadataDto } from './dto/metadata.dto';

/** Read-only playlist metadata (public/unlisted; private playlists go through /auth/playlists). */
@ApiTags('playlists')
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly metadata: MetadataService) {}

  @Get(':id')
  @ApiOkResponse({ type: PlaylistMetadataDto })
  get(
    @Param('id', new ZodValidationPipe(PlaylistIdSchema)) id: string,
  ): Promise<PlaylistMetadataDto> {
    return this.metadata.getPlaylist(id);
  }
}
