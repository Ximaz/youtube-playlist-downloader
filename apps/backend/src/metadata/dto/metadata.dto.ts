import { PlaylistMetadataSchema, VideoMetadataSchema } from '@ypd/shared';
import { createZodDto } from 'nestjs-zod';

/** Response DTOs: thin wrappers so @nestjs/swagger and @ApiOkResponse have a class to
 * introspect. The actual schema and type live in @ypd/shared. */
export class VideoMetadataDto extends createZodDto(VideoMetadataSchema) {}
export class PlaylistMetadataDto extends createZodDto(PlaylistMetadataSchema) {}
