import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

/**
 * Swagger helpers shared by every controller: the error envelope AllExceptionsFilter
 * writes, the paginated wrapper `paginate()` returns, and the usual error responses.
 */

/** Every error, from any endpoint, has this shape (see AllExceptionsFilter). */
export class ApiErrorResponse {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'The booking is awaiting payment; it cannot move to delivery pickup from there',
    description: 'A sentence for people, or the list of validation failures on a 400.',
  })
  message!: string | string[];

  @ApiProperty({ example: 'Conflict' })
  error!: string;

  @ApiProperty({ example: '/api/v1/admin/bookings/ESK-10484/delivery' })
  path!: string;

  @ApiProperty({ example: '2026-09-28T09:41:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Wait for the vendor to accept the request first'],
    description:
      'Some 4xx responses add machine-readable context beside `message` — `blockers`, ' +
      '`outstandingRequirements`, `unitIds`, `talentProfileIds`. Present only when relevant.',
  })
  blockers?: string[];
}

const EXAMPLE_BASE = {
  path: '/api/v1/admin/…',
  timestamp: '2026-09-28T09:41:00.000Z',
};

const errorContent = (example: Partial<ApiErrorResponse>) => ({
  schema: {
    allOf: [{ $ref: getSchemaPath(ApiErrorResponse) }],
    example: { ...example, ...EXAMPLE_BASE },
  },
});

/** Offset-page metadata, as `paginate()` writes it. */
export class PageMetaResponse {
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 57, description: 'Rows matching the filters, across all pages.' })
  total!: number;
  @ApiProperty({ example: 3 }) totalPages!: number;
  @ApiProperty({ example: true }) hasNext!: boolean;
  @ApiProperty({ example: false }) hasPrevious!: boolean;
}

/**
 * `200` with `{ data: Model[], meta: PageMeta }` — what every `?page=&limit=` list returns.
 */
export function ApiPaginatedResponse(model: Type<unknown>, description?: string) {
  return applyDecorators(
    ApiExtraModels(PageMetaResponse, model),
    ApiOkResponse({
      description: description ?? 'One page of results. Pass `page` and `limit` for the next.',
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMetaResponse) },
        },
      },
    }),
  );
}

export interface StandardErrors {
  /** Validation failed, or a business rule rejected the input. */
  badRequest?: string | false;
  notFound?: string | false;
  conflict?: string | false;
}

/**
 * The error responses an endpoint can return, each with the real envelope. 401 is always
 * possible (every route needs a session); 403 comes from AdminAccess.
 */
export function ApiStandardErrors(errors: StandardErrors = {}) {
  const decorators = [
    ApiExtraModels(ApiErrorResponse),
    ApiUnauthorizedResponse({
      description: 'No session, or it expired. Sign in again.',
      ...errorContent({
        statusCode: 401,
        message: 'Authentication required',
        error: 'Unauthorized',
      }),
    }),
  ];
  if (errors.badRequest !== false && errors.badRequest !== undefined) {
    decorators.push(
      ApiBadRequestResponse({
        description: errors.badRequest,
        ...errorContent({
          statusCode: 400,
          message: ['reason must be longer than or equal to 5 characters'],
          error: 'Bad Request',
        }),
      }),
    );
  }
  if (errors.notFound !== false && errors.notFound !== undefined) {
    decorators.push(
      ApiNotFoundResponse({
        description: errors.notFound,
        ...errorContent({ statusCode: 404, message: errors.notFound, error: 'Not Found' }),
      }),
    );
  }
  if (errors.conflict !== false && errors.conflict !== undefined) {
    decorators.push(
      ApiConflictResponse({
        description: errors.conflict,
        ...errorContent({ statusCode: 409, message: errors.conflict, error: 'Conflict' }),
      }),
    );
  }
  return applyDecorators(...decorators);
}
