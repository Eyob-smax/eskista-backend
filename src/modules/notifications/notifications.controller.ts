import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/auth.decorators';
import {
  ListNotificationsQuery,
  NotificationResponse,
  UnreadCountResponse,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('customer · notifications', 'talent · notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@ApiExtraModels(NotificationResponse)
// One inbox per user, reachable from either app: a talent who also books equipment sees
// the same list on both paths.
@Controller({ path: ['customer/notifications', 'talent/notifications'], version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description: `
The **Notifications** screen. Newest first, cursor-paged.

Branch on \`type\`, never on \`title\` — the wording is copy and will change. \`data\`
carries what you need to deep-link, typically \`bookingReference\`; treat a missing key as
"not linkable" rather than an error, since the shape varies by type.

Pass \`unreadOnly=true\` for just the unread ones.
`.trim(),
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(NotificationResponse) } },
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            nextCursor: { type: 'string', nullable: true },
            hasNext: { type: 'boolean' },
          },
        },
      },
    },
  })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListNotificationsQuery,
  ): Promise<CursorPage<NotificationResponse>> {
    return this.notifications.list(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Count my unread notifications',
    description:
      'Just the number behind the bell badge. Cheap enough to poll, and far cheaper than ' +
      'fetching the list to count it.',
  })
  @ApiOkResponse({ type: UnreadCountResponse })
  unreadCount(@CurrentUser('id') userId: string): Promise<UnreadCountResponse> {
    return this.notifications.unreadCount(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark one as read',
    description:
      'Marking an already-read notification is not an error, so the client can retry ' +
      'freely without special-casing.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationResponse })
  @ApiNotFoundResponse({ description: 'No notification with that id belongs to you.' })
  markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything as read', description: 'Returns the new count: 0.' })
  @ApiOkResponse({ type: UnreadCountResponse })
  markAllRead(@CurrentUser('id') userId: string): Promise<UnreadCountResponse> {
    return this.notifications.markAllRead(userId);
  }
}
