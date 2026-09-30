import { ConflictException, Injectable } from '@nestjs/common';
import {
  AgreementStatus,
  BookingStatus,
  BookingType,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { confirmationBlockers } from './booking-flow';

type Tx = Prisma.TransactionClient;

/**
 * Eskista's moves on a booking. Every admin transition goes through `move`, which is
 * guarded on the status it expects — two admins pressing the same button cannot move a
 * booking twice — and writes the status history the customer, vendor and talent timelines
 * are built from.
 */
@Injectable()
export class BookingFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async move(
    bookingId: string,
    from: BookingStatus[],
    to: BookingStatus,
    actorId: string,
    reason?: string,
    data: Prisma.BookingUncheckedUpdateManyInput = {},
    tx?: Tx,
  ): Promise<BookingStatus> {
    const run = async (db: Tx) => {
      const current = await db.booking.findUnique({
        where: { id: bookingId },
        select: { status: true },
      });
      if (!current) throw new ConflictException('Booking not found');
      if (!from.includes(current.status)) {
        throw new ConflictException(
          `The booking is ${current.status.toLowerCase().replace(/_/g, ' ')}; it cannot move to ` +
            `${to.toLowerCase().replace(/_/g, ' ')} from there`,
        );
      }
      const { count } = await db.booking.updateMany({
        where: { id: bookingId, status: current.status },
        data: { ...data, status: to },
      });
      if (count === 0) throw new ConflictException('The booking changed meanwhile; reload it');
      await db.bookingStatusEvent.create({
        data: {
          bookingId,
          fromStatus: current.status,
          toStatus: to,
          actorId,
          actorRole: Role.ADMIN,
          reason,
        },
      });
      return current.status;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** Records a step inside the current status: "Received at hub", "Outgoing inspection". */
  async note(
    bookingId: string,
    actorId: string,
    reason: string,
    metadata?: Prisma.InputJsonValue,
    tx?: Tx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const b = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true },
    });
    await db.bookingStatusEvent.create({
      data: {
        bookingId,
        fromStatus: b.status,
        toStatus: b.status,
        actorId,
        actorRole: Role.ADMIN,
        reason,
        metadata,
      },
    });
  }

  /** What has been verified against a booking, and what it owes. */
  async paidAndDue(bookingId: string): Promise<{ paidMinor: number; dueMinor: number }> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        payments: { where: { status: PaymentStatus.VERIFIED }, select: { amountMinor: true } },
        invoiceLines: {
          where: { invoice: { status: { not: InvoiceStatus.VOID } } },
          select: { totalMinor: true, securityDepositMinor: true },
          take: 1,
        },
      },
    });
    const line = booking.invoiceLines[0];
    return {
      paidMinor: booking.payments.reduce((sum, p) => sum + p.amountMinor, 0),
      dueMinor: line
        ? line.totalMinor + line.securityDepositMinor
        : booking.totalMinor + booking.securityDepositMinor,
    };
  }

  /**
   * Moves an approved booking to Booking Confirmed once it is fully paid and the customer's
   * signed agreement is approved — whichever of the two comes last. Called after each.
   * Returns what it is still waiting for; empty once confirmed.
   */
  async tryConfirm(bookingId: string, actorId: string): Promise<string[]> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        agreements: { select: { status: true, counterpartyId: true } },
        vendor: { select: { userId: true } },
        talentProfile: { select: { userId: true } },
      },
    });
    if (booking.status !== BookingStatus.AWAITING_PAYMENT) return [];

    const { paidMinor, dueMinor } = await this.paidAndDue(bookingId);
    const blockers = confirmationBlockers({
      paidMinor,
      dueMinor,
      customerAgreements: booking.agreements.filter((a) => a.counterpartyId === booking.customerId),
    });
    if (blockers.length > 0) return blockers;

    await this.move(
      bookingId,
      [BookingStatus.AWAITING_PAYMENT],
      BookingStatus.BOOKING_CONFIRMED,
      actorId,
      'Paid in full and agreement approved',
    );

    const values = { reference: booking.reference };
    const data = { bookingReference: booking.reference };
    if (booking.type === BookingType.TALENT && booking.talentProfile) {
      await this.notifications.send(
        booking.talentProfile.userId,
        'TALENT_BOOKING_CONFIRMED',
        values,
        data,
      );
    } else if (booking.vendor) {
      await this.notifications.send(
        booking.vendor.userId,
        'SUPPLIER_BOOKING_CONFIRMED',
        { ...values, next: 'Prepare the equipment and hand it over to Eskista.' },
        data,
      );
    }
    return [];
  }

  /** Whether every agreement on a talent booking — customer's and talent's — is approved. */
  contractsApproved(agreements: { status: AgreementStatus }[]): boolean {
    const live = agreements.filter((a) => a.status !== AgreementStatus.VOID);
    return live.length > 0 && live.every((a) => a.status === AgreementStatus.APPROVED);
  }
}
