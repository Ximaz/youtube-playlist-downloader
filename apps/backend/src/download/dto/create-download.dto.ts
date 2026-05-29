import { DownloadRequestSchema } from '@ypd/shared';
import { createZodDto } from 'nestjs-zod';

/** POST /downloads body. The "at least one of playlistId / videoIds" rule is enforced
 * inside DownloadService (it was a 400 from the service, not the pipe, before this
 * migration — keeping that surface). */
export class CreateDownloadDto extends createZodDto(DownloadRequestSchema) {}
