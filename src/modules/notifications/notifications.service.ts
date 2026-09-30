import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AdminTier, NotificationChannel, Prisma, Role } from '@prisma/client';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListNotificationsQuery,
  NotificationResponse,
  UnreadCountResponse,
} from './dto/notification.dto';

/**
 * Every notification the customer and talent apps can raise.
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

  // ── Customer: talent hire ──
  TALENT_ACCEPTED: {
    title: 'Talent Accepted',
    body: '{{talent}} is available for {{reference}}. Choose your talent within {{hours}} hours.',
  },
  TALENT_DECLINED: {
    title: 'Talent Unavailable',
    body: '{{talent}} is not available for {{reference}}.',
  },
  SELECTION_REMINDER: {
    title: 'Choose Your Talent',
    body: 'You have 24 hours left to choose who to hire for {{reference}}.',
  },
  REQUEST_EXPIRED: {
    title: 'Request Expired',
    body: '{{reason}} Your request {{reference}} has been closed. You can send a new one any time.',
  },
  TALENT_HIRED_CONFIRMATION: {
    title: 'Talent Hired',
    body: 'You hired {{talent}} for {{reference}}. Sign the agreement and pay to confirm.',
  },

  // ── Talent ──
  HIRE_REQUEST_RECEIVED: {
    title: 'New Hire Request',
    body: 'You have a new {{project}} request for {{dates}}. Reply within {{hours}} hours.',
  },
  HIRE_REQUEST_EXPIRED: {
    title: 'Request Expired',
    body: 'A hire request for {{dates}} expired before you replied.',
  },
  HIRE_REQUEST_CANCELLED: {
    title: 'Request Cancelled',
    body: 'The client cancelled the {{project}} request for {{dates}}.',
  },
  YOU_WERE_HIRED: {
    title: 'You Were Hired',
    body: 'You have been hired for {{reference}} on {{dates}}. Sign your agreement to confirm.',
  },
  NOT_SELECTED: {
    title: 'Not Selected',
    body: 'The client chose another talent for the {{project}} request on {{dates}}.',
  },
  TALENT_PROFILE_SUBMITTED: {
    title: 'Profile Submitted',
    body: 'Eskista is reviewing your profile. Typical review takes 2–3 business days.',
  },
  TALENT_PROFILE_APPROVED: {
    title: 'Profile Approved',
    body: 'Your profile is live. Clients can now find and hire you.',
  },
  TALENT_PROFILE_REJECTED: {
    title: 'Profile Needs Changes',
    body: 'Your profile could not be approved yet. {{reason}}',
  },
  TALENT_BOOKING_CONFIRMED: {
    title: 'Booking Confirmed',
    body: 'Payment for {{reference}} is confirmed. See the venue details in the app.',
  },

  // ── Customer: raised by Eskista's operations ──
  BOOKING_REJECTED: {
    title: 'Booking Declined',
    body: 'Your request {{reference}} could not be confirmed. {{reason}}',
  },
  PAYMENT_RESUBMIT: {
    title: 'New Payment Slip Needed',
    body: 'Please upload a new payment slip for {{reference}}. {{reason}}',
  },
  INSPECTION_COMPLETED: {
    title: 'Inspection Complete',
    body: 'Eskista has inspected your return for {{reference}}. {{summary}}',
  },
  DEPOSIT_REFUNDED: {
    title: 'Deposit Refunded',
    body: '{{amount}} of your deposit for {{reference}} has been sent back to you.',
  },
  ACCOUNT_SUSPENDED: {
    title: 'Account Suspended',
    body: 'Your Eskista account has been suspended. {{reason}}',
  },

  // ── Vendor and talent: raised by Eskista's operations ──
  SUPPLIER_BOOKING_APPROVED: {
    title: 'Booking Approved',
    body: 'Eskista approved {{reference}}. The customer is now signing and paying.',
  },
  SUPPLIER_BOOKING_CONFIRMED: {
    title: 'Booking Confirmed',
    body: 'Payment for {{reference}} is confirmed. {{next}}',
  },
  SUPPLIER_BOOKING_CANCELLED: {
    title: 'Booking Cancelled',
    body: 'Eskista cancelled {{reference}}. {{reason}}',
  },
  PAYOUT_SENT: {
    title: 'Payout Sent',
    body: 'Eskista sent {{amount}} for {{reference}}. Confirm once it arrives.',
  },
  VENDOR_VERIFIED: {
    title: 'Vendor Account Verified',
    body: 'Your vendor account is verified. Your approved equipment is now live.',
  },
  VENDOR_REJECTED: {
    title: 'Vendor Account Needs Changes',
    body: 'Your vendor account could not be verified yet. {{reason}}',
  },
  VENDOR_SUSPENDED: {
    title: 'Vendor Account Suspended',
    body: 'Your vendor account has been suspended and your equipment hidden. {{reason}}',
  },
  TALENT_PROFILE_SUSPENDED: {
    title: 'Profile Suspended',
    body: 'Your talent profile has been suspended and hidden from clients. {{reason}}',
  },
  LISTING_APPROVED: {
    title: 'Equipment Published',
    body: '{{item}} is approved and live on Eskista.',
  },
  LISTING_REJECTED: {
    title: 'Equipment Needs Changes',
    body: '{{item}} could not be published yet. {{reason}}',
  },
  LISTING_FEATURED: {
    title: 'Featured on Eskista',
    body: '{{item}} is now promoted as {{tier}} on the Eskista homepage and bot.',
  },

  // ── Admin: the dashboard bell ──
  ADMIN_BOOKING_REQUEST: {
    title: 'New Booking Request',
    body: '{{customer}} requested {{item}} ({{reference}}).',
  },
  ADMIN_VENDOR_RESPONDED: {
    title: 'Vendor Responded',
    body: '{{vendor}} {{answer}} {{reference}}.',
  },
  ADMIN_TALENT_HIRED: {
    title: 'Talent Hired',
    body: '{{customer}} hired {{talent}} for {{reference}}.',
  },
  ADMIN_AGREEMENT_UPLOADED: {
    title: 'Signed Agreement Uploaded',
    body: 'A signed agreement for {{reference}} is waiting for review.',
  },
  ADMIN_PAYMENT_SUBMITTED: {
    title: 'Payment Slip Uploaded',
    body: '{{payment}} for {{reference}} ({{amount}}) is waiting for verification.',
  },
  ADMIN_HANDOVER_CONFIRMED: {
    title: 'Vendor Handed Over',
    body: '{{vendor}} handed over the equipment for {{reference}}. Receive it at the hub.',
  },
  ADMIN_RETURN_SCHEDULED: {
    title: 'Return Scheduled',
    body: 'The return for {{reference}} is booked for {{when}}.',
  },
  ADMIN_SERVICE_COMPLETED: {
    title: 'Service Completed',
    body: '{{customer}} confirmed {{reference}} is complete. The payout is now due.',
  },
  ADMIN_INCIDENT_REPORTED: {
    title: 'Issue Reported',
    body: '{{incident}} on {{reference}}: {{type}}.',
  },
  ADMIN_PAYOUT_DISPUTED: {
    title: 'Payout Reported Missing',
    body: '{{payee}} says the payout for {{reference}} has not arrived.',
  },
  ADMIN_RETURN_DISPUTED: {
    title: 'Return Disputed',
    body: '{{vendor}} has not confirmed the equipment for {{reference}} is back.',
  },
  ADMIN_SUPPLIER_SUBMITTED: {
    title: 'New Registration',
    body: '{{name}} submitted a {{kind}} profile for verification.',
  },
  ADMIN_LISTING_SUBMITTED: {
    title: 'Equipment Submitted',
    body: '{{vendor}} submitted {{item}} for review.',
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

  /**
   * Raises a notification for every active admin — the dashboard bell. `tiers` narrows it
   * to the admins whose work it is (a payment slip to Finance and Super Admins); every
   * Super Admin always receives it.
   */
  async notifyAdmins(
    type: NotificationType,
    values: Record<string, string> = {},
    data?: Prisma.InputJsonValue,
    tiers?: AdminTier[],
  ): Promise<void> {
    const template = NOTIFICATION_TEMPLATES[type];
    try {
      const admins = await this.prisma.user.findMany({
        where: {
          isBlocked: false,
          roles: { some: { role: Role.ADMIN } },
          ...(tiers
            ? {
                OR: [
                  { adminProfile: { tier: { in: [...tiers, AdminTier.SUPER_ADMIN] } } },
                  // An admin created before tiers existed has no profile yet.
                  { adminProfile: null },
                ],
              }
            : {}),
        },
        select: { id: true },
      });
      if (admins.length === 0) return;
      const body = this.interpolate(template.body, values);
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type,
          title: template.title,
          body,
          data,
          channels: [NotificationChannel.IN_APP],
        })),
      });
    } catch (error) {
      this.logger.error(`Could not write ${type} admin notification: ${String(error)}`);
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
