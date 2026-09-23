import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
  /** Extra context an endpoint attached, e.g. `outstandingRequirements`. 4xx only. */
  [key: string]: unknown;
}

/** Keys the filter owns; anything else on a 4xx payload is the endpoint's own context. */
const RESERVED = new Set(['statusCode', 'message', 'error', 'path', 'timestamp']);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        error = exception.name;
      } else {
        const obj = res as { message?: string | string[]; error?: string };
        message = obj.message ?? exception.message;
        error = obj.error ?? exception.name;

        // Endpoints attach machine-readable context to a 4xx — `outstandingRequirements`
        // is the one the request wizards depend on. Preserve it, or the client is told
        // only that something is wrong and not what.
        //
        // 4xx only: a 5xx payload can carry driver or ORM internals, and those must never
        // reach the client.
        if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
          extra = Object.fromEntries(
            Object.entries(obj as Record<string, unknown>).filter(([k]) => !RESERVED.has(k)),
          );
        }
      }
    } else if (exception instanceof Error) {
      // Log the real cause; never return internals to the client.
      this.logger.error(exception.message, exception.stack);
    }

    const body: ErrorBody = {
      ...extra,
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }
}
