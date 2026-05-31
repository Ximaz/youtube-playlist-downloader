import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * `@SessionId() sessionId?: string` — pulls the opaque session token out of the
 * `Authorization: Bearer <token>` header (the token IS the session id). The browser
 * never reaches the backend directly: the Nuxt BFF proxy holds the session in an
 * httpOnly cookie and forwards it as this header. Returns `undefined` when absent so
 * each handler can decide whether anonymous access is OK.
 */
export const SessionId = createParamDecorator((_, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return bearerToken(req.headers.authorization);
});

/** Extracts the token from a case-insensitive `Bearer <token>` header. */
function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
