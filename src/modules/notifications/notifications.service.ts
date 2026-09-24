import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListNotificationsQuery,
  NotificationResponse,
  UnreadCountResponse,
} from './dto/notification.dto';

/**
 * Every notification the customer app can raise.
 *
 * Titles and bodies live here rather than at each call site so the wording stays
 * consistent, and so a copy change is one edit rather than a search. `{{token}}`
 * placeholders are filled from the data passed in.
 */
export const NOTIFICATION_TEMPLATES = {
  BOOKING_APPROVED: {
    title: 'Booking Approved',
    body: 'Your {{item}} booking has been approved. Complete payment to confirm.',
  },
  PAYMENT_VERIFIED: {
    title: 'Payment Verified',
    body: 'Your payment for {{reference}} has been confirmed.',
  },
  PAYMENT_REJECTED: {
    title: 'Payment Needs Attention',
    body: 'We could not verify your payment for {{reference}}. {{reason}}',
  },
  AGREEMENT_READY: {
    title: 'Agreement Ready to Sign',
    body: 'Download, sign and upload the agreement for {{reference}} to continue.',
  },
  AGREEMENT_APPROVED: {
    title: 'Agreement Approved',
    body: 'Your signed agreement for {{reference}} has been accepted.',
  },
  AGREEMENT_REJECTED: {
    title: 'Agreement Needs Re-uploading',
    body: 'The signed copy for {{reference}} could not be accepted. {{reason}}',
  },
  OUT_FOR_DELIVERY: {
    title: 'Equipment Out for Delivery',
    body: 'Your equipment is on the way. Arriving {{eta}}.',
  },
  DELIVERED: {
    title: 'Equipment Delivered',
    body: 'Your {{item}} has been delivered. Your rental period has started.',
  },
  RETURN_REMINDER: {
    title: 'Return Reminder',
    body: 'Your rental ends tomorrow. Arrange your return in the app.',
  },
  RETURN_SCHEDULED: {
    title: 'Return Scheduled',
    body: 'Your return for {{reference}} is booked for {{when}}.',
  },
  BOOKING_COMPLETED: {
    title: 'Booking Completed',
    body: 'Your rental {{reference}} has been successfully completed.',
  },
  FEEDBACK_REQUESTED: {
    title: 'Feedback Requested',
    body: 'We would love to hear about your {{item}} rental. Please rate your experience.',
  },
  INCIDENT_RECEIVED: {
    title: 'Issue Report Received',
    body: 'We have received your report {{reference}} and will be in touch shortly.',
  },
  INCIDENT_RESOLVED: {
    title: 'Issue Resolved',
    body: 'Your report {{reference}} has been resolved. {{resolution}}',
  },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TEMPLATES;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Raises a notification.
   *
   * Writes the in-app row synchronously — that is what the bell icon reads, and it must be
   * there the moment the triggering request returns. Telegram and SMS delivery will hang
   * off the same call once those channels exist; the interface is already channel-aware so
   * adding them does not touch any call site.
   *
   * Never throws. A booking must not fail because a notification could not be written.
   */
  async send(
    userId: string,
    type: NotificationType,
    values: Record<string, string> = {},
    data?: Prisma.InputJsonValue,
  ): Promise<void> {
    const template = NOTIFICATION_TEMPLATES[type];

    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type,
          title: template.title,
          body: this.interpolate(template.body, values),
          data,
          channels: [NotificationChannel.IN_APP],
        },
      });
    } catch (error) {
      this.logger.error(`Could not write ${type} notification for ${userId}: ${String(error)}`);
    }
  }

  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<CursorPage<NotificationResponse>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasNext = rows.length > query.limit;
    const page = hasNext ? rows.slice(0, query.limit) : rows;

    return {
      data: page.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data as Record<string, unknown> | null,
        isRead: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
      meta: {
        limit: query.limit,
        nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
        hasNext,
      },
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountResponse> {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Marks one as read. Already-read is not an error — the client may retry. */
  async markRead(userId: string, notificationId: string): Promise<NotificationResponse> {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!existing) throw new NotFoundException('Notification not found');

    const updated = existing.readAt
      ? existing
      : await this.prisma.notification.update({
          where: { id: notificationId },
          data: { readAt: new Date() },
        });

    return {
      id: updated.id,
      type: updated.type,
      title: updated.title,
      body: updated.body,
      data: updated.data as Record<string, unknown> | null,
      isRead: updated.readAt !== null,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async markAllRead(userId: string): Promise<UnreadCountResponse> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { unread: 0 };
  }

  /** Replaces `{{token}}`. An unfilled token is dropped rather than left visible. */
  private interpolate(template: string, values: Record<string, string>): string {
    return template
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => values[key] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
