import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CursorPaginationQuery } from '../../../common/dto/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class ListNotificationsQuery extends CursorPaginationQuery {
  @ApiPropertyOptional({
    description: 'Only notifications not yet read. Use it for the badge list.',
    default: false,
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unreadOnly?: boolean;
}

export class NotificationResponse {
  @ApiProperty({ format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({
    description:
      'Stable machine key — branch on this, not on the title. Deep-link targets live in ' +
      '`data`.',
    example: 'RETURN_REMINDER',
  })
  type!: string;

  @ApiProperty({ example: 'Return Reminder' })
  title!: string;

  @ApiProperty({ example: 'Your rental ends tomorrow. Arrange your return in the app.' })
  body!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Context for deep-linking, e.g. `{ "bookingReference": "ESK-10482" }`. Shape varies ' +
      'by `type`; treat a missing key as "no link" rather than an error.',
    example: { bookingReference: 'ESK-10482' },
  })
  data!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Drives the unread dot.', example: false })
  isRead!: boolean;

  @ApiProperty({
    description: 'Render relative — "2m ago", "Tomorrow" — as the design does.',
    example: '2026-08-20T14:30:00.000Z',
  })
  createdAt!: string;
}

export class UnreadCountResponse {
  @ApiProperty({ description: 'For the badge on the bell icon.', example: 3 })
  unread!: number;
}
