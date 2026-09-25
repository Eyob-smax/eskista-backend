import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from './jobs.service';
import {
  ESKISTA_QUEUE,
  JOB_NAMES,
  type FeedbackRequestPayload,
  type ReturnReminderPayload,
} from './jobs.constants';

/** A reminder only makes sense while the equipment is still out. */
const STILL_OUT: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
];

/**
 * Processes the scheduled notifications.
 *
 * Every handler **re-reads the booking and re-checks it still needs doing**. A job
 * scheduled a fortnight ago describes the world as it was then: the booking may have been
 * cancelled, returned early, or already reviewed. Acting on the stale payload is how
 * customers get reminded to return equipment they handed back last week.
 */
@Processor(ESKISTA_QUEUE)
export class JobsProcessor extends WorkerHost {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.returnReminder:
        return this.returnReminder(job.data as ReturnReminderPayload);
      case JOB_NAMES.feedbackRequest:
        return this.feedbackRequest(job.data as FeedbackRequestPayload);
      case JOB_NAMES.reminderSweep:
        return this.reminderSweep();
      default: {
        const handler = this.jobs.handlerFor(job.name);
        if (handler) return handler(job.data as never);
        // An unknown name means a deploy removed a handler while jobs were still queued.
        // Log and succeed: retrying cannot help, and failing forever fills the dead set.
        this.logger.warn(`No handler for job "${job.name}" (${job.id}); discarding`);
        return;
      }
    }
  }

  private async returnReminder({ bookingId }: ReturnReminderPayload): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        reference: true,
        customerId: true,
        status: true,
        listing: { select: { name: true } },
      },
    });

    if (!booking) return;
    if (!STILL_OUT.includes(booking.status)) {
      this.logger.debug(`Skipping return reminder for ${booking.reference}: ${booking.status}`);
      return;
    }

    await this.notifications.send(
      booking.customerId,
      'RETURN_REMINDER',
      {},
      { bookingReference: booking.reference },
    );
  }

  private async feedbackRequest({ bookingId }: FeedbackRequestPayload): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        reference: true,
        customerId: true,
        status: true,
        listing: { select: { name: true } },
        talentProfile: { select: { displayName: true } },
        reviews: { select: { id: true } },
      },
    });

    if (!booking) return;
    if (booking.status !== BookingStatus.CLOSED) return;
    // Asking for feedback they have already given is the fastest way to get it ignored.
    if (booking.reviews.length > 0) return;

    await this.notifications.send(
      booking.customerId,
      'FEEDBACK_REQUESTED',
      { item: booking.listing?.name ?? booking.talentProfile?.displayName ?? 'recent' },
      { bookingReference: booking.reference },
    );
  }

  /**
   * Nightly safety net.
   *
   * Finds bookings due back tomorrow whose reminder never fired — a job lost to a Redis
   * flush, or one scheduled before this feature existed — and sends it. Idempotent by
   * checking for a reminder already sent today, so the sweep and the delayed job cannot
   * both notify the same customer.
   */
  private async reminderSweep(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const due = await this.prisma.booking.findMany({
      where: {
        status: { in: STILL_OUT },
        dueAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, reference: true, customerId: true },
    });

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let sent = 0;

    for (const booking of due) {
      const already = await this.prisma.notification.count({
        where: {
          userId: booking.customerId,
          type: 'RETURN_REMINDER',
          createdAt: { gte: since },
          data: { path: ['bookingReference'], equals: booking.reference },
        },
      });
      if (already > 0) continue;

      await this.notifications.send(
        booking.customerId,
        'RETURN_REMINDER',
        {},
        { bookingReference: booking.reference },
      );
      sent += 1;
    }

    if (sent > 0) {
      this.logger.warn(
        `Reminder sweep sent ${sent} reminder(s) the scheduled jobs missed — worth checking why`,
      );
    }
  }
}
