import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import {
  DOCUMENT_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../../common/upload';
import { allocatePayment } from '../../invoices/invoice-math';
import { InvoicesService } from '../../invoices/invoices.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NumberingService } from '../../numbering/numbering.service';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAuditService } from '../core/admin-audit.service';
import { confirmationBlockers } from '../core/booking-flow';
import { BookingFlowService } from '../core/booking-flow.service';
import { humanise, minorToDecimal, toCsv } from '../core/admin-format';
import {
  AdminPaymentsQuery,
  ConfirmPaymentDto,
  FILTER_STATUS,
  PaymentDetailResponse,
  PaymentRowResponse,
  PaymentsSummaryResponse,
  RecordPaymentDto,
  STATUS_LABEL,
} from './dto/admin-payments.dto';

const paymentInclude = {
  booking: {
    include: {
      customer: { include: { customer: true } },
      listing: { select: { name: true } },
      talentProfile: { select: { displayName: true } },
      agreements: { select: { status: true, counterpartyId: true } },
    },
  },
  invoice: { select: { id: true, number: true, combined: true } },
  collectionAccount: true,
  verifiedBy: { select: { name: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

/**
 * Payments Verification. Customers transfer to Eskista's accounts and upload the slip;
 * finance checks it against the statement and confirms, rejects, or asks for a new slip.
 *
 * A transfer paying a combined invoice is stored as one row per booking (see Invoices)
 * sharing one PAY reference; here it is one payment, decided as a whole.
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly flow: BookingFlowService,
    private readonly notifications: NotificationsService,
    private readonly numbering: NumberingService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminPaymentsQuery): Promise<Paginated<PaymentRowResponse>> {
    const where = this.where(query);
    const groups = await this.prisma.payment.groupBy({
      by: ['reference'],
      where,
      _min: { submittedAt: true },
      orderBy: { _min: { submittedAt: 'desc' } },
    });
    const page = groups.slice(query.skip, query.skip + query.limit);
    const refs = page.map((g) => g.reference).filter((r): r is string => r !== null);
    const rows = await this.prisma.payment.findMany({
      where: { reference: { in: refs } },
      include: paymentInclude,
    });
    const data = refs.map((ref) => this.toRow(rows.filter((r) => r.reference === ref)));
    return paginate(data, groups.length, query);
  }

  async summary(): Promise<PaymentsSummaryResponse> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [pending, requested, today, month] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.SUBMITTED },
        select: { reference: true, amountMinor: true },
      }),
      this.prisma.payment.groupBy({
        by: ['reference'],
        where: { status: PaymentStatus.RESUBMISSION_REQUESTED },
      }),
      this.prisma.payment.groupBy({
        by: ['reference'],
        where: { status: PaymentStatus.VERIFIED, verifiedAt: { gte: dayStart } },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.VERIFIED, verifiedAt: { gte: monthStart } },
        _sum: { amountMinor: true },
      }),
    ]);
    return {
      pendingCount: new Set(pending.map((p) => p.reference)).size,
      pendingAmountMinor: pending.reduce((sum, p) => sum + p.amountMinor, 0),
      requestedReceiptCount: requested.length,
      confirmedTodayCount: today.length,
      confirmedThisMonthMinor: month._sum.amountMinor ?? 0,
      currency: 'ETB',
    };
  }

  async detail(reference: string): Promise<PaymentDetailResponse> {
    const rows = await this.group(reference);
    const row = this.toRow(rows);
    const first = rows[0];
    const bookingIds = rows.map((r) => r.bookingId);
    const thisIds = new Set(rows.map((r) => r.id));

    const others = await this.prisma.payment.findMany({
      where: { bookingId: { in: bookingIds }, id: { notIn: [...thisIds] } },
      include: paymentInclude,
      orderBy: { submittedAt: 'desc' },
    });

    const bookings = await Promise.all(
      rows.map(async (r) => {
        const { paidMinor, dueMinor } = await this.flow.paidAndDue(r.bookingId);
        return {
          reference: r.booking.reference,
          itemName: r.booking.listing?.name ?? r.booking.talentProfile?.displayName ?? 'Booking',
          type: r.booking.type,
          status: r.booking.status,
          amountMinor: r.amountMinor,
          dueMinor,
          paidMinor,
          confirmationBlockers:
            r.booking.status === 'AWAITING_PAYMENT'
              ? confirmationBlockers({
                  paidMinor: paidMinor + (r.status === PaymentStatus.SUBMITTED ? r.amountMinor : 0),
                  dueMinor,
                  customerAgreements: r.booking.agreements.filter(
                    (a) => a.counterpartyId === r.booking.customerId,
                  ),
                })
              : [],
          previouslyPaid: paidMinor - (r.status === PaymentStatus.VERIFIED ? r.amountMinor : 0),
        };
      }),
    );

    const byRef = new Map<string, PaymentRow[]>();
    for (const o of others) {
      const key = o.reference ?? o.id;
      byRef.set(key, [...(byRef.get(key) ?? []), o]);
    }

    return {
      ...row,
      expectedAmountMinor: bookings.reduce(
        (sum, b) => sum + Math.max(0, b.dueMinor - b.previouslyPaid),
        0,
      ),
      receivedAmountMinor: rows.every((r) => r.receivedAmountMinor === null)
        ? null
        : rows.reduce((sum, r) => sum + (r.receivedAmountMinor ?? 0), 0),
      payerName: first.payerName,
      payerAccount: first.payerAccount,
      paidInto: first.collectionAccount
        ? {
            provider: first.collectionAccount.provider,
            accountName: first.collectionAccount.accountName,
            accountNumber: first.collectionAccount.accountNumber,
          }
        : null,
      reviewNote: first.reviewNote,
      rejectionReason: first.rejectionReason,
      verifiedAt: first.verifiedAt?.toISOString() ?? null,
      verifiedByName: first.verifiedBy?.name ?? null,
      receipt: {
        url: this.storage.urlFor(first.receiptFileKey),
        fileName: first.receiptFileName,
        mimeType: first.receiptMimeType,
        sizeBytes: first.receiptSizeBytes,
      },
      bookings: bookings.map(({ previouslyPaid: _unused, ...b }) => b),
      history: [...byRef.values()].map((g) => this.toRow(g)),
      canDecide: rows.every((r) => r.status === PaymentStatus.SUBMITTED),
    };
  }

  /**
   * Confirm Payment. Records what arrived and from whom, verifies each booking's part, and
   * confirms every booking that is now paid in full with its agreement approved.
   */
  async confirm(
    adminId: string,
    reference: string,
    dto: ConfirmPaymentDto,
  ): Promise<PaymentDetailResponse> {
    const rows = this.pending(await this.group(reference));
    const declared = rows.reduce((sum, r) => sum + r.amountMinor, 0);
    const received = dto.receivedAmountMinor ?? declared;
    const shares = allocatePayment(
      received,
      rows.map((r) => r.amountMinor),
    );
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const [index, r] of rows.entries()) {
        const { count } = await tx.payment.updateMany({
          where: { id: r.id, status: PaymentStatus.SUBMITTED },
          data: {
            status: PaymentStatus.VERIFIED,
            verifiedAt: now,
            verifiedById: adminId,
            // What counts as paid is what arrived; the customer's claim is kept beside it.
            amountMinor: shares[index],
            receivedAmountMinor: shares[index],
            declaredTotalMinor: r.declaredTotalMinor ?? declared,
            payerName: dto.payerName,
            payerAccount: dto.payerAccount,
            reviewNote: dto.note,
            rejectionReason: null,
          },
        });
        if (count === 0)
          throw new ConflictException('This payment was decided meanwhile; reload it');
        await tx.bookingStatusEvent.create({
          data: {
            bookingId: r.bookingId,
            fromStatus: r.booking.status,
            toStatus: r.booking.status,
            actorId: adminId,
            actorRole: 'ADMIN',
            reason: `Payment ${reference} verified`,
            metadata: { receivedMinor: shares[index] },
          },
        });
      }
    });

    await this.afterDecision(rows);
    for (const r of rows) await this.flow.tryConfirm(r.bookingId, adminId);

    const first = rows[0];
    await this.notifications.send(
      first.booking.customerId,
      'PAYMENT_VERIFIED',
      { reference: first.invoice?.combined ? first.invoice.number : first.booking.reference },
      { bookingReference: first.booking.reference, paymentReference: reference },
    );
    await this.audit.record(
      adminId,
      'payment.confirm',
      'Payment',
      reference,
      { declared },
      {
        received,
        payerName: dto.payerName,
      },
    );
    return this.detail(reference);
  }

  /** Reject Slip: the payment is not accepted. The customer pays again from scratch. */
  async reject(adminId: string, reference: string, reason: string): Promise<PaymentDetailResponse> {
    return this.decline(adminId, reference, reason, PaymentStatus.REJECTED);
  }

  /** Request New Slip: nothing wrong with the money, the slip is unreadable or incomplete. */
  async requestNewSlip(
    adminId: string,
    reference: string,
    reason: string,
  ): Promise<PaymentDetailResponse> {
    return this.decline(adminId, reference, reason, PaymentStatus.RESUBMISSION_REQUESTED);
  }

  /**
   * Records a payment Eskista received directly — cash at the office, or a transfer the
   * customer never uploaded — already verified, with Eskista's own receipt attached.
   */
  async recordManual(
    adminId: string,
    bookingReference: string,
    dto: RecordPaymentDto,
    file: UploadedFile | undefined,
  ): Promise<PaymentDetailResponse> {
    const booking = await this.prisma.booking.findUnique({
      where: { reference: bookingReference },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'AWAITING_PAYMENT') {
      throw new ConflictException('Only a booking awaiting payment can take a payment');
    }
    const valid = assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.receipt,
      field: 'receipt',
    });
    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `customers/${booking.customerId}/payments/${booking.reference}`,
    });
    const invoice = await this.invoices.ensureBookingInvoice(booking.id);
    const now = new Date();

    const reference = await this.prisma.$transaction(async (tx) => {
      const ref = await this.numbering.nextPaymentReference(tx);
      await tx.payment.create({
        data: {
          reference: ref,
          bookingId: booking.id,
          invoiceId: invoice?.id,
          method: dto.method,
          transactionReference: dto.transactionReference,
          amountMinor: dto.amountMinor,
          receivedAmountMinor: dto.amountMinor,
          currency: booking.currency,
          receiptFileKey: stored.key,
          receiptFileName: valid.originalname,
          receiptMimeType: valid.mimetype,
          receiptSizeBytes: valid.size,
          status: PaymentStatus.VERIFIED,
          verifiedAt: now,
          verifiedById: adminId,
          payerName: dto.payerName,
          reviewNote: dto.note ?? 'Recorded by Eskista',
        },
      });
      await tx.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: booking.status,
          actorId: adminId,
          actorRole: 'ADMIN',
          reason: `Payment ${ref} recorded by Eskista (${humanise(dto.method)})`,
        },
      });
      return ref;
    });

    if (invoice) await this.invoices.recomputePaid(invoice.id);
    await this.flow.tryConfirm(booking.id, adminId);
    await this.notifications.send(
      booking.customerId,
      'PAYMENT_VERIFIED',
      { reference: booking.reference },
      { bookingReference: booking.reference, paymentReference: reference },
    );
    await this.audit.record(adminId, 'payment.record', 'Payment', reference, undefined, dto);
    return this.detail(reference);
  }

  async exportCsv(query: AdminPaymentsQuery): Promise<string> {
    const rows = await this.prisma.payment.findMany({
      where: this.where(query),
      include: paymentInclude,
      orderBy: { submittedAt: 'desc' },
      take: 10_000,
    });
    const groups = new Map<string, PaymentRow[]>();
    for (const r of rows) {
      const key = r.reference ?? r.id;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return toCsv(
      [
        'Payment ID',
        'Bookings',
        'Invoice',
        'Customer',
        'Organisation',
        'Amount (ETB)',
        'Received (ETB)',
        'Method',
        'Transaction ID',
        'Payer',
        'Submitted',
        'Status',
        'Verified',
      ],
      [...groups.values()].map((g) => {
        const row = this.toRow(g);
        const received = g.every((r) => r.receivedAmountMinor === null)
          ? null
          : g.reduce((sum, r) => sum + (r.receivedAmountMinor ?? 0), 0);
        return [
          row.reference,
          row.bookingReferences.join(' '),
          row.invoiceNumber,
          row.customer.name,
          row.customer.organisation,
          minorToDecimal(row.amountMinor),
          received === null ? null : minorToDecimal(received),
          row.methodLabel,
          row.transactionReference,
          g[0].payerName,
          row.submittedAt,
          row.statusLabel,
          g[0].verifiedAt?.toISOString() ?? null,
        ];
      }),
    );
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async decline(
    adminId: string,
    reference: string,
    reason: string,
    status: 'REJECTED' | 'RESUBMISSION_REQUESTED',
  ): Promise<PaymentDetailResponse> {
    const rows = this.pending(await this.group(reference));
    const { count } = await this.prisma.payment.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: PaymentStatus.SUBMITTED },
      data: { status, rejectionReason: reason, reviewNote: reason, verifiedById: adminId },
    });
    if (count !== rows.length)
      throw new ConflictException('This payment was decided meanwhile; reload it');

    await this.prisma.bookingStatusEvent.createMany({
      data: rows.map((r) => ({
        bookingId: r.bookingId,
        fromStatus: r.booking.status,
        toStatus: r.booking.status,
        actorId: adminId,
        actorRole: 'ADMIN' as const,
        reason:
          status === PaymentStatus.REJECTED
            ? `Payment ${reference} rejected`
            : `New slip requested for payment ${reference}`,
      })),
    });
    await this.afterDecision(rows);

    const first = rows[0];
    const shown = first.invoice?.combined ? first.invoice.number : first.booking.reference;
    await this.notifications.send(
      first.booking.customerId,
      status === PaymentStatus.REJECTED ? 'PAYMENT_REJECTED' : 'PAYMENT_RESUBMIT',
      { reference: shown, reason },
      { bookingReference: first.booking.reference, paymentReference: reference },
    );
    await this.audit.record(
      adminId,
      status === PaymentStatus.REJECTED ? 'payment.reject' : 'payment.request_new_slip',
      'Payment',
      reference,
      undefined,
      undefined,
      reason,
    );
    return this.detail(reference);
  }

  private async afterDecision(rows: PaymentRow[]): Promise<void> {
    const invoiceIds = new Set(rows.map((r) => r.invoiceId).filter((id): id is string => !!id));
    for (const id of invoiceIds) await this.invoices.recomputePaid(id);
  }

  private pending(rows: PaymentRow[]): PaymentRow[] {
    if (!rows.every((r) => r.status === PaymentStatus.SUBMITTED)) {
      throw new ConflictException(
        `This payment is already ${STATUS_LABEL[rows[0].status].toLowerCase()}`,
      );
    }
    return rows;
  }

  private async group(reference: string): Promise<PaymentRow[]> {
    const rows = await this.prisma.payment.findMany({
      where: { reference },
      include: paymentInclude,
      orderBy: { booking: { reference: 'asc' } },
    });
    if (rows.length === 0) throw new NotFoundException('Payment not found');
    return rows;
  }

  private where(query: AdminPaymentsQuery): Prisma.PaymentWhereInput {
    const q = query.q;
    return {
      reference: { not: null },
      ...(query.status ? { status: FILTER_STATUS[query.status] } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.from || query.to
        ? {
            submittedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' } },
              { transactionReference: { contains: q, mode: 'insensitive' } },
              { booking: { reference: { contains: q, mode: 'insensitive' } } },
              { invoice: { number: { contains: q, mode: 'insensitive' } } },
              { booking: { customer: { name: { contains: q, mode: 'insensitive' } } } },
              {
                booking: {
                  customer: {
                    customer: { organisationName: { contains: q, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private toRow(rows: PaymentRow[]): PaymentRowResponse {
    const first = rows[0];
    const customer = first.booking.customer;
    const profile = customer.customer;
    return {
      reference: first.reference ?? first.id,
      bookingReferences: rows.map((r) => r.booking.reference),
      invoiceNumber: first.invoice?.number ?? null,
      customer: {
        id: customer.id,
        name: profile?.contactPerson ?? customer.name,
        organisation: profile?.organisationName ?? null,
        phone: profile?.phone ?? customer.phone,
        email: profile?.email ?? null,
      },
      amountMinor: first.declaredTotalMinor ?? rows.reduce((sum, r) => sum + r.amountMinor, 0),
      currency: first.currency,
      method: first.method,
      methodLabel: humanise(first.method),
      transactionReference: first.transactionReference,
      submittedAt: first.submittedAt.toISOString(),
      status: first.status,
      statusLabel: STATUS_LABEL[first.status],
      receiptUrl: this.storage.urlFor(first.receiptFileKey),
    };
  }

  /** For the Settlement tab's "payment evidence" on a booking. */
  async forBooking(bookingId: string): Promise<PaymentRowResponse[]> {
    const rows = await this.prisma.payment.findMany({
      where: { bookingId },
      include: paymentInclude,
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map((r) => this.toRow([r]));
  }
}
