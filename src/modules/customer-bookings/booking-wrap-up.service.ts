import { Injectable, Logger } from '@nestjs/common';
import {
  AdminTier,
  BookingType,
  InvoiceStatus,
  PaymentStatus,
  SupplierResponse,
  UnitCustody,
} from '@prisma/client';
import { AgreementsService } from '../agreements/agreements.service';
import { HiringService } from '../hiring/hiring.service';
import { InvoicesService } from '../invoices/invoices.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export interface WrapUpResult {
  /** Money already verified, for finance to return. Nothing is refunded here. */
  refundDueMinor: number;
}

/**
 * Everything a booking that will not go ahead leaves behind, whoever ended it — the
 * customer cancelling, or Eskista cancelling or rejecting. One routine, so the two paths
 * cannot drift apart:
 *
 * - agreements voided, scheduled jobs cancelled, a talent request closed for its invitees;
 * - payment slips still waiting for review rejected, so they cannot be "confirmed" on a
 *   dead booking;
 * - unpaid invoices voided — a combined one too, so the customer's other bookings on it
 *   can be paid on their own again;
 * - gear already at the hub marked back with the vendor;
 * - the supplier told; admins told when the customer ended it and money is owed back.
 */
@Injectable()
export class BookingWrapUpService {
  private readonly logger = new Logger(BookingWrapUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agreements: AgreementsService,
    private readonly invoices: InvoicesService,
    private readonly hiring: HiringService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  async wrapUp(
    bookingId: string,
    reason: string,
    actorId: string,
    endedBy: 'ADMIN' | 'CUSTOMER',
  ): Promise<WrapUpResult> {
    const b = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        payments: { select: { id: true, status: true, amountMinor: true } },
        assignedUnits: { select: { unitId: true } },
        vendor: { select: { userId: true } },
        talentProfile: { select: { userId: true } },
        customer: { select: { name: true } },
      },
    });

    await this.agreements.voidForBooking(b.id);
    await this.jobs.cancelBookingJobs(b.id);
    if (b.type === BookingType.TALENT) await this.hiring.cancelRequest(b.id);

    // A slip waiting for review on a booking that is over is declined, not left to be
    // confirmed later against nothing.
    await this.prisma.payment.updateMany({
      where: {
        bookingId: b.id,
        status: { in: [PaymentStatus.SUBMITTED, PaymentStatus.RESUBMISSION_REQUESTED] },
      },
      data: { status: PaymentStatus.REJECTED, rejectionReason: `Booking ended: ${reason}` },
    });

    const refundDueMinor = b.payments
      .filter((p) => p.status === PaymentStatus.VERIFIED)
      .reduce((sum, p) => sum + p.amountMinor, 0);

    if (refundDueMinor === 0) await this.voidUnpaidInvoices(b.id, reason, actorId);

    // Gear that reached the hub before the booking ended goes back to the vendor, so it
    // is not stranded in a custody nobody can change. Gear with a client is the admin's to
    // chase, so it is left as it is.
    if (b.assignedUnits.length > 0) {
      await this.prisma.equipmentUnit.updateMany({
        where: { id: { in: b.assignedUnits.map((u) => u.unitId) }, custody: UnitCustody.HUB },
        data: { custody: UnitCustody.VENDOR },
      });
    }

    const supplierUserId = b.vendor?.userId ?? b.talentProfile?.userId;
    if (supplierUserId && b.supplierResponse !== SupplierResponse.DECLINED) {
      await this.notifications.send(
        supplierUserId,
        'SUPPLIER_BOOKING_CANCELLED',
        { reference: b.reference, reason },
        { bookingReference: b.reference },
      );
    }
    if (endedBy === 'CUSTOMER') {
      await this.notifications.notifyAdmins(
        'ADMIN_BOOKING_CANCELLED',
        {
          customer: b.customer.name,
          reference: b.reference,
          refund:
            refundDueMinor > 0 ? `${(refundDueMinor / 100).toFixed(2)} ETB to refund` : 'nothing paid',
        },
        { bookingReference: b.reference },
        refundDueMinor > 0 ? [AdminTier.FINANCE, AdminTier.ADMIN] : [AdminTier.ADMIN],
      );
    }
    return { refundDueMinor };
  }

  /** Voids the booking's unpaid invoice, single or combined. */
  private async voidUnpaidInvoices(bookingId: string, reason: string, actorId: string): Promise<void> {
    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        bookingId,
        invoice: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.DRAFT] } },
      },
      select: { invoice: { select: { number: true } } },
    });
    for (const l of lines) {
      // A combined invoice goes whole: the others on it get fresh single invoices when next
      // paid, instead of being stuck behind a line that can never be paid.
      await this.invoices
        .void(actorId, l.invoice.number, reason)
        .catch((error: unknown) =>
          this.logger.warn(`Invoice ${l.invoice.number} not voided: ${String(error)}`),
        );
    }
  }
}
