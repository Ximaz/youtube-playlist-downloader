import { WorkSelectorSchema } from '@ypd/shared';
import { createZodDto } from 'nestjs-zod';

/** POST /downloads/status body — resync the UI's current view of these work items.
 * Schema lives in @ypd/shared; this wrapper is only here so Nest's IoC + Swagger have
 * a class to introspect. */
export class StatusDownloadDto extends createZodDto(WorkSelectorSchema) {}
