import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { SESSION_COOKIE } from './session-cookie.service';

/**
 * `@SessionId() sessionId?: string` — pulls the session cookie out of the request without
 * the controller having to fish through `req.cookies`. Returns `undefined` when absent so
 * each handler can decide whether anonymous access is OK.
 */
export const SessionId = createParamDecorator((_, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const raw = req.cookies?.[SESSION_COOKIE];
  return typeof raw === 'string' ? raw : undefined;
});
