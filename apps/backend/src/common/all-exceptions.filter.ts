import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/** Uniform error envelope shared with the providers: `{ error: { code, message } }`. */
interface ErrorEnvelope {
  error: { code: string; message: string };
}

/**
 * Single global filter so HTTP errors look the same regardless of where they came from:
 * - HttpException     → its declared status + envelope (code derives from the Nest name).
 * - ZodError          → 400; defence in depth — ZodValidationPipe normally catches first.
 * - Anything else     → 500 with an opaque "internal error" message; full detail logged.
 *
 * The matching shape is what apps/providers/{ytdl,youtubejs} also emit, so the frontend's
 * api.ts parsing remains uniform across the whole stack.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { httpAdapter } = this.adapterHost;

    const envelope = this.#toEnvelope(exception);
    const status = this.#statusOf(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Log full exception (including stack) server-side. The opaque response body shields
      // internal error strings (paths, env-var names, raw provider data) from clients.
      this.logger.error(`unhandled ${req.method} ${req.url}`, this.#toLoggable(exception));
    }

    httpAdapter.reply(res, envelope, status);
  }

  #statusOf(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception instanceof ZodError) return HttpStatus.BAD_REQUEST;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  #toEnvelope(exception: unknown): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      return {
        error: {
          code: this.#httpCode(exception.getStatus()),
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      };
    }
    if (exception instanceof ZodError) {
      const issues = exception.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      return { error: { code: 'BAD_REQUEST', message: `Validation failed: ${issues}` } };
    }
    // Opaque message; the real detail is in the logger.error() call above.
    return { error: { code: 'INTERNAL', message: 'Internal server error.' } };
  }

  #httpCode(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST';
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.CONFLICT) return 'CONFLICT';
    if (status === HttpStatus.UNPROCESSABLE_ENTITY) return 'UNPROCESSABLE_ENTITY';
    if (status === HttpStatus.TOO_MANY_REQUESTS) return 'TOO_MANY_REQUESTS';
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'SERVICE_UNAVAILABLE';
    if (status >= 500) return 'INTERNAL';
    return 'HTTP_ERROR';
  }

  #toLoggable(exception: unknown): Error | string {
    if (exception instanceof Error) return exception;
    return typeof exception === 'string' ? exception : String(exception);
  }
}
