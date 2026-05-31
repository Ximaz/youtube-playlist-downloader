import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** POST /auth/google/exchange body. Internal contract: called server-to-server by the Nuxt
 *  BFF callback route after it has validated `state` against its own httpOnly cookie. */
export const GoogleExchangeSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export class GoogleExchangeDto extends createZodDto(GoogleExchangeSchema) {}
