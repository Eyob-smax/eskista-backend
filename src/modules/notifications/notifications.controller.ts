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
  ApiOkResponse,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiEndpoint,
  ApiStandardErrors,
} from '../../common/dto/api-docs';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/auth.decorators';
import {
  ListNotificationsQuery,
  NotificationResponse,
  UnreadCountResponse,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

const NOTIFICATION_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  example: '550e8400-e29b-41d4-a716-446655440000',
  description: 'The notification UUID.',
};

@ApiTags('customer · notifications', 'talent · notifications', 'vendor · notifications')
@ApiBearerAuth()
@ApiExtraModels(NotificationResponse)
@Controller({
  path: ['customer/notifications', 'talent/notifications', 'vendor/notifications'],
  version: '1',
})
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List my notifications',
    does: 'Cursor-paginated feed of notifications for the signed-in user, ordered newest first with optional unread filter.',
    behind: [
      'Read only: queries user notifications by recipient userId.',
      'Supports deep-link payload metadata (e.g. bookingReference).',
    ],
    seenBy: [
      'User interface: populates the in-app Notifications tray and badge indicators.',
    ],
    rules: [
      '401 if unauthenticated.',
    ],
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(NotificationResponse) } },
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'number', example: 20 },
            nextCursor: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000', nullable: true },
            hasNext: { type: 'boolean', example: false },
          },
        },
      },
    },
  })
  @ApiStandardErrors()
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListNotificationsQuery,
  ): Promise<CursorPage<NotificationResponse>> {
    return this.notifications.list(userId, query);
  }

  @Get('unread-count')
  @ApiEndpoint({
    summary: 'Count my unread notifications',
    does: 'Returns the count of unread notifications for badge rendering without loading messages.',
    behind: [
      'Read only: fast SQL count of unread notifications for the user.',
    ],
    seenBy: [
      'Bell icon badge in top navigation.',
    ],
    rules: [
      '401 if unauthenticated.',
    ],
  })
  @ApiOkResponse({ type: UnreadCountResponse })
  @ApiStandardErrors()
  unreadCount(@CurrentUser('id') userId: string): Promise<UnreadCountResponse> {
    return this.notifications.unreadCount(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Mark one notification as read',
    does: 'Marks a single notification as read. Retrying on already-read notification is a safe no-op.',
    behind: [
      'Updates isRead = true on Notification row.',
    ],
    seenBy: [
      'Removes unread dot next to notification item in notification center.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if notification not found or belongs to another user.',
    ],
  })
  @ApiParam(NOTIFICATION_ID_PARAM)
  @ApiOkResponse({ type: NotificationResponse })
  @ApiStandardErrors({ notFound: 'No notification with that id belongs to you.' })
  markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Mark all notifications as read',
    does: 'Marks every unread notification belonging to the signed-in user as read in bulk and returns zero count.',
    behind: [
      'Bulk updates all unread notifications for this user: isRead = true.',
    ],
    seenBy: [
      'Clears notification badge counter to zero.',
    ],
    rules: [
      '401 if unauthenticated.',
    ],
  })
  @ApiOkResponse({ type: UnreadCountResponse })
  @ApiStandardErrors()
  markAllRead(@CurrentUser('id') userId: string): Promise<UnreadCountResponse> {
    return this.notifications.markAllRead(userId);
  }
}
