import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { BookingStatus, PayeeKind, Role, SettlementStatus, type Settlement } from '@prisma/client';
import { formatMoney } from '../../common/money';
import { renderSettlementPdf } from '../documents/settlement-renderer';
import { JOB_NAMES, jobIdFor } from '../jobs/jobs.constants';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** "It will automatically close in 24 hours" — after the payee confirms the payout. */
export const AUTO_CLOSE_HOURS = 24;

/**
 * What each supplier — vendor or talent — is owed for a booking, and closing the booking
 * once they have it.
 *
 * A settlement pays the supplier's own listed price in full: Eskista's commission and VAT
 * sit on the customer's side of the price. It is created when the work is done (a talent
 * engagement completed, an equipment rental settled), expected after the admin-set payout
 * delay, and paid by Eskista. The payee then confirms it arrived, and the booking closes —
 * at once if they choose, or automatically a day later.
 */
@Injectable()
export class SettlementsService implements OnModuleInit {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerHandler(JOB_NAMES.bookingAutoClose, ({ bookingId }) =>
      this.autoClose(bookingId),
    );
  }

  /**
   * The booking's settlement, creating it as PENDING if it has none. Idempotent — safe to
   * call from every path that finishes a booking.
   */
  async ensureForBooking(bookingId: string): Promise<Settlement> {
    const existing = await this.prisma.settlement.findUnique({ where: { bookingId } });
    if (existing) return existing;

    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const isTalent = booking.talentProfileId !== null;
    if (!isTalent && !booking.vendorId) {
      throw new ConflictException('This booking has no supplier to settle with');
    }
    const delayDays = await this.settings.payoutDelayDays();

    try {
      return await this.prisma.settlement.create({
        data: {
          bookingId,
          payeeKind: isTalent ? PayeeKind.TALENT : PayeeKind.VENDOR,
          talentProfileId: booking.talentProfileId,
          vendorId: isTalent ? null : booking.vendorId,
          grossMinor: booking.supplierEarningsMinor + booking.commissionMinor,
          commissionMinor: booking.commissionMinor,
          netMinor: booking.supplierEarningsMinor,
          currency: booking.currency,
          status: SettlementStatus.PENDING,
          expectedAt: new Date(Date.now() + delayDays * 86_400_000),
        },
      });
    } catch (error) {
      // Two finishing paths racing on the unique booking id: the loser reads the winner's.
      const again = await this.prisma.settlement.findUnique({ where: { bookingId } });
      if (again) return again;
      throw error;
    }
  }

  /** Schedules the automatic close a day after the payee confirmed their payout. */
  async scheduleAutoClose(bookingId: string, from = new Date()): Promise<void> {
    await this.jobs.scheduleAt(
      JOB_NAMES.bookingAutoClose,
      { bookingId },
      new Date(from.getTime() + AUTO_CLOSE_HOURS * 3_600_000),
      jobIdFor(JOB_NAMES.bookingAutoClose, bookingId),
    );
  }

  /**
   * Closes a settled booking. Idempotent: guarded on the status it expects, and a booking
   * already closed is not an error. Asks the customer for a review.
   */
  async close(bookingId: string, actorId: string | null, role: Role | null): Promise<void> {
    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.SETTLEMENT },
      data: { status: BookingStatus.CLOSED },
    });
    if (count === 0) {
      const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (b?.status === BookingStatus.CLOSED) return;
      throw new ConflictException('Only a settled booking can be completed');
    }
    await this.prisma.bookingStatusEvent.create({
      data: {
        bookingId,
        fromStatus: BookingStatus.SETTLEMENT,
        toStatus: BookingStatus.CLOSED,
        actorId,
        actorRole: role,
        reason: role
          ? `${role === Role.TALENT ? 'Talent' : 'Vendor'} completed the booking`
          : 'Closed automatically after payout',
      },
    });
    await this.jobs.cancel(jobIdFor(JOB_NAMES.bookingAutoClose, bookingId));
    await this.jobs.scheduleFeedbackRequest(bookingId, new Date());
  }

  /** The Settlement Record PDF, for vendor and talent alike. */
  async recordPdf(
    bookingId: string,
    payeeName: string,
    itemName: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { settlement: { include: { batch: { select: { payoutReference: true } } } } },
    });
    const s = booking.settlement;
    if (!s) throw new NotFoundException('No settlement has been recorded for this booking yet');
    const money = (minor: number) => formatMoney(minor, s.currency);
    const day = (d: Date) => d.toISOString().slice(0, 10);

    const buffer = await renderSettlementPdf({
      reference: booking.reference,
      vendorName: payeeName,
      productName: itemName,
      rentalDates: `${day(booking.startDate)} → ${day(booking.endDate)}`,
      status: s.status,
      paidAt: s.paidAt ? day(s.paidAt) : null,
      payoutReference: s.payoutReference ?? s.batch?.payoutReference ?? null,
      rows: [
        { label: 'Your listed price', value: money(booking.supplierEarningsMinor) },
        { label: 'Deductions', value: `-${money(s.deductionMinor)}` },
        { label: 'Paid to you', value: money(s.netMinor), emphasis: true },
      ],
      generatedAt: new Date(),
    });
    return { buffer, filename: `${booking.reference}-settlement.pdf` };
  }

  private async autoClose(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { handover: true, settlement: true },
    });
    if (!booking || booking.status !== BookingStatus.SETTLEMENT) return;
    const confirmed = booking.handover?.payoutConfirmedAt ?? booking.settlement?.payeeConfirmedAt;
    if (!confirmed) return;
    await this.close(bookingId, null, null);
    this.logger.log(`Auto-closed ${booking.reference} ${AUTO_CLOSE_HOURS}h after payout`);
  }
}
