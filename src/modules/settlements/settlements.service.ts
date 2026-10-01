import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  BookingStatus,
  InspectionKind,
  PayeeKind,
  Role,
  SettlementStatus,
  type Settlement,
} from '@prisma/client';
import { formatMoney } from '../../common/money';
import { renderSettlementPdf } from '../documents/settlement-renderer';
import { JOB_NAMES, jobIdFor } from '../jobs/jobs.constants';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { settlementTotals } from './settlement-math';

/** Eskista's payout details for Mark as Paid. */
export interface MarkPaidInput {
  /** The bank or Telebirr transaction id of the payout. */
  payoutReference: string;
  /** A specific payout account of the payee; their primary one when omitted. */
  payoutAccountId?: string;
  paidAt?: Date;
  note?: string;
}

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
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
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

    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { inspections: { where: { kind: InspectionKind.RETURN } } },
    });
    const isTalent = booking.talentProfileId !== null;
    if (!isTalent && !booking.vendorId) {
      throw new ConflictException('This booking has no supplier to settle with');
    }
    const delayDays = await this.settings.payoutDelayDays();

    // What the return inspection withheld from the customer's deposit pays for the damage
    // to the vendor's gear, so it is passed on to them.
    const damageFee = booking.inspections[0]?.feeMinor ?? 0;
    const adjustments =
      damageFee > 0
        ? [{ amountMinor: damageFee, reason: 'Damage compensation withheld from the deposit' }]
        : [];
    const totals = settlementTotals(booking.supplierEarningsMinor, adjustments);

    try {
      return await this.prisma.$transaction(async (tx) =>
        tx.settlement.create({
          data: {
            reference: await this.numbering.nextSettlementReference(tx),
            bookingId,
            payeeKind: isTalent ? PayeeKind.TALENT : PayeeKind.VENDOR,
            talentProfileId: booking.talentProfileId,
            vendorId: isTalent ? null : booking.vendorId,
            grossMinor: booking.supplierEarningsMinor + booking.commissionMinor,
            commissionMinor: booking.commissionMinor,
            adjustmentMinor: totals.adjustmentMinor,
            deductionMinor: totals.deductionMinor,
            netMinor: totals.netMinor,
            currency: booking.currency,
            status: SettlementStatus.PENDING,
            expectedAt: new Date(Date.now() + delayDays * 86_400_000),
            adjustments: { create: adjustments },
          },
        }),
      );
    } catch (error) {
      // Two finishing paths racing on the unique booking id: the loser reads the winner's.
      const again = await this.prisma.settlement.findUnique({ where: { bookingId } });
      if (again) return again;
      throw error;
    }
  }

  /**
   * Adds a "± Adjustment" and recomputes the payout. Only before it is paid: a paid
   * settlement is a record of money that moved.
   */
  async addAdjustment(
    settlementId: string,
    adminId: string,
    amountMinor: number,
    reason: string,
  ): Promise<Settlement> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      include: { booking: { select: { supplierEarningsMinor: true } } },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status === SettlementStatus.PAID) {
      throw new ConflictException('A paid settlement cannot be adjusted');
    }
    if (amountMinor === 0) throw new ConflictException('An adjustment cannot be zero');

    return this.prisma.$transaction(async (tx) => {
      await tx.settlementAdjustment.create({
        data: { settlementId, amountMinor, reason, createdById: adminId },
      });
      const all = await tx.settlementAdjustment.findMany({ where: { settlementId } });
      const totals = settlementTotals(settlement.booking.supplierEarningsMinor, all);
      return tx.settlement.update({ where: { id: settlementId }, data: totals });
    });
  }

  /** Removes an adjustment added by mistake, before the settlement is paid. */
  async removeAdjustment(settlementId: string, adjustmentId: string): Promise<Settlement> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      include: { booking: { select: { supplierEarningsMinor: true } } },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status === SettlementStatus.PAID) {
      throw new ConflictException('A paid settlement cannot be adjusted');
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.settlementAdjustment.deleteMany({
        where: { id: adjustmentId, settlementId },
      });
      if (count === 0) throw new NotFoundException('Adjustment not found');
      const all = await tx.settlementAdjustment.findMany({ where: { settlementId } });
      const totals = settlementTotals(settlement.booking.supplierEarningsMinor, all);
      return tx.settlement.update({ where: { id: settlementId }, data: totals });
    });
  }

  /**
   * Mark as Paid: Eskista sent the money. Copies the destination account onto the
   * settlement, so the record keeps showing where the money went after the payee changes
   * their details. The payee then confirms it arrived.
   */
  async markPaid(settlementId: string, adminId: string, input: MarkPaidInput): Promise<Settlement> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      include: { booking: { select: { handover: { select: { payoutDisputedAt: true } } } } },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');

    // A payout the payee reported as missing can be sent again; one nobody disputed cannot
    // be paid twice. Vendors record the dispute on their handover, talents on the settlement.
    const disputed =
      settlement.payeeDisputedAt !== null || settlement.booking.handover?.payoutDisputedAt != null;
    const resend = settlement.status === SettlementStatus.PAID && disputed;
    if (settlement.status === SettlementStatus.PAID && !resend) {
      throw new ConflictException('This settlement is already paid');
    }

    const owner =
      settlement.payeeKind === PayeeKind.TALENT
        ? { talentProfileId: settlement.talentProfileId }
        : { vendorId: settlement.vendorId };
    const account = await this.prisma.payoutAccount.findFirst({
      where: input.payoutAccountId ? { id: input.payoutAccountId, ...owner } : owner,
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    if (input.payoutAccountId && !account) {
      throw new NotFoundException('That payout account does not belong to this payee');
    }

    // Guarded on the status just read: of two admins paying at once, only one writes.
    const { count } = await this.prisma.settlement.updateMany({
      where: { id: settlementId, status: settlement.status },
      data: {
        status: SettlementStatus.PAID,
        paidAt: input.paidAt ?? new Date(),
        paidById: adminId,
        payoutReference: input.payoutReference,
        notes: input.note ?? settlement.notes,
        payoutChannel: account?.channel ?? null,
        payoutProvider: account?.provider ?? null,
        payoutAccountName: account?.accountName ?? null,
        payoutAccountNumber: account?.accountNumber ?? null,
        // A re-sent payout starts a fresh confirmation.
        payeeConfirmedAt: null,
        payeeDisputedAt: null,
        payeeDisputeNote: null,
      },
    });
    if (count === 0) throw new ConflictException('This settlement was just paid; reload it');
    if (resend) {
      await this.prisma.vendorHandover.updateMany({
        where: { bookingId: settlement.bookingId },
        data: { payoutDisputedAt: null, payoutDisputeNote: null, payoutConfirmedAt: null },
      });
    }
    return this.prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
  }

  /** Holds a payout, e.g. while a dispute is open, or releases it back to pending. */
  async setHold(settlementId: string, hold: boolean, note?: string): Promise<Settlement> {
    const settlement = await this.prisma.settlement.findUnique({ where: { id: settlementId } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status === SettlementStatus.PAID) {
      throw new ConflictException('This settlement is already paid');
    }
    return this.prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: hold ? SettlementStatus.ON_HOLD : SettlementStatus.PENDING,
        notes: note ?? settlement.notes,
      },
    });
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
        reason: !role
          ? 'Closed automatically after payout'
          : role === Role.ADMIN
            ? 'Eskista closed the booking'
            : `${role === Role.TALENT ? 'Talent' : 'Vendor'} completed the booking`,
      },
    });
    await this.jobs.cancel(jobIdFor(JOB_NAMES.bookingAutoClose, bookingId));
    await this.jobs.scheduleFeedbackRequest(bookingId, new Date());
    const closed = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { customerId: true, reference: true },
    });
    await this.notifications.send(
      closed.customerId,
      'BOOKING_COMPLETED',
      { reference: closed.reference },
      { bookingReference: closed.reference },
    );
  }

  /** The Settlement Record PDF, for vendor and talent alike. */
  async recordPdf(
    bookingId: string,
    payeeName: string,
    itemName: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        settlement: {
          include: {
            batch: { select: { payoutReference: true } },
            adjustments: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
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
        ...s.adjustments.map((a) => ({
          label: a.reason,
          value: a.amountMinor < 0 ? `-${money(-a.amountMinor)}` : `+${money(a.amountMinor)}`,
        })),
        ...(s.adjustments.length === 0 ? [{ label: 'Adjustments', value: money(0) }] : []),
        {
          label: s.paidAt ? 'Paid to you' : 'To be paid to you',
          value: money(s.netMinor),
          emphasis: true,
        },
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
