import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OAuthPlaylistSummary, PlaylistMetadata } from '@ypd/shared';
import { PlaylistIdSchema } from '@ypd/shared';
import { ZodValidationPipe } from 'nestjs-zod';

import { SessionId } from '../auth/session-id.decorator';
import { PlaylistMetadataDto } from './dto/metadata.dto';
import { PlaylistsService } from './playlists.service';

/** The `/playlists` resource. `GET /playlists` is the signed-in user's playlists (OAuth required);
 *  `GET /playlists/:id` is auth-optional — official Data API when signed in (covers the user's
 *  private playlists), public/unlisted provider fallback otherwise. PlaylistsService picks the
 *  source per request; the controller just delegates. */
@ApiTags('playlists')
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  @ApiOperation({
    summary:
      "The signed-in user's playlists (id + title + itemCount + thumbnail). Requires Google OAuth; 401 for an anonymous session or none. Items are fetched lazily per playlist via GET /playlists/:id.",
  })
  myPlaylists(@SessionId() sessionId?: string): Promise<OAuthPlaylistSummary[]> {
    return this.playlists.listMyPlaylists(sessionId);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One playlist with its playable (public + unlisted) video ids. Auth-optional: the official YouTube Data API when signed in with Google (so the user’s own private playlists work), the public/unlisted provider extraction otherwise. A private/absent playlist is unreachable without auth → 404 with a sign-in hint.',
  })
  @ApiOkResponse({ type: PlaylistMetadataDto })
  playlist(
    @SessionId() sessionId: string | undefined,
    @Param('id', new ZodValidationPipe(PlaylistIdSchema)) id: string,
  ): Promise<PlaylistMetadata> {
    return this.playlists.getPlaylist(sessionId, id);
  }
}
