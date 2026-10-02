import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Offset pagination for admin/vendor tables, which need a total and jump-to-page.
 * Public browse endpoints use CursorPaginationQuery instead — offset paging drifts and
 * degrades once a catalogue is large.
 */
export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export class SortQuery {
  @ApiPropertyOptional({
    example: 'createdAt',
    description: 'Field to sort by. Allowed values differ per endpoint.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}

export class SearchQuery {
  @ApiPropertyOptional({ example: 'FX3', description: 'Free-text search.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}

export class CursorPaginationQuery {
  @ApiPropertyOptional({
    example: 'eyJpZCI6IjViMGMyZjllIn0',
    description: 'Opaque cursor from the previous page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface CursorPage<T> {
  data: T[];
  meta: { limit: number; nextCursor: string | null; hasNext: boolean };
}

export function paginate<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  const totalPages = query.limit > 0 ? Math.ceil(total / query.limit) : 0;
  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrevious: query.page > 1,
    },
  };
}

/**
 * Trims an over-fetched row set (limit + 1) into a cursor page.
 * Pass `limit + 1` rows so `hasNext` is known without a second count query.
 */
export function toCursorPage<T>(
  rows: T[],
  limit: number,
  getCursor: (row: T) => string,
): CursorPage<T> {
  const hasNext = rows.length > limit;
  const data = hasNext ? rows.slice(0, limit) : rows;
  return {
    data,
    meta: {
      limit,
      hasNext,
      nextCursor: hasNext && data.length > 0 ? getCursor(data[data.length - 1]) : null,
    },
  };
}
