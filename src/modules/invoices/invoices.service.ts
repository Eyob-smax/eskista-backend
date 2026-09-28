import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  Role,
  type Invoice,
} from '@prisma/client';
import {
  DOCUMENT_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../common/upload';
import { paymentBlocker, readBank, readTelebirr } from '../customer-bookings/payment-rules';
import { renderInvoicePdf } from '../documents/invoice-renderer';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import type {
  AdminInvoiceQuery,
  InvoiceDetailResponse,
  InvoicePaymentInstructionsResponse,
  InvoiceSummaryResponse,
  PayInvoiceDto,
  PayableBookingResponse,
} from './dto/invoice.dto';
import {
  InvoiceMathError,
  allocatePayment,
  buildInvoice,
  type BookingFigures,
} from './invoice-math';

/** Only a priced booking can be invoiced; before that its figures are placeholders. */
const INVOICEABLE: BookingStatus[] = [
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
  BookingStatus.SETTLEMENT,
  BookingStatus.CLOSED,
];

const bookingForInvoice = {
  listing: { select: { name: true } },
  talentProfile: { select: { displayName: true } },
  payments: { select: { status: true } },
  agreements: { select: { status: true, counterpartyId: true } },
} satisfies Prisma.BookingInclude;

type BookingForInvoice = Prisma.BookingGetPayload<{ include: typeof bookingForInvoice }>;

const invoiceInclude = {
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: { booking: { include: bookingForInvoice } },
  },
  payments: {
    orderBy: { submittedAt: 'desc' },
    include: { booking: { select: { reference: true } } },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

interface Actor {
  id: string;
  role: Role;
}

/**
 * Invoices, including the combined invoice: several of one customer's bookings — from
 * different vendors or talents — billed and paid as one.
 *
 * Every priced booking has an invoice. It is issued the first time it is needed (the
 * payment screen, the PDF), as a one-line invoice. A customer with several bookings awaiting
 * payment can **Pay together**: the single invoices are voided and one combined invoice
 * replaces them. An admin can do the same for a customer. Splitting a combined invoice back
 * is allowed until money has been sent against it.
 *
 * Paying a combined invoice records one payment per booking, all sharing the receipt and
 * the transaction reference, with the transfer split by what each booking owes. Every
 * booking's own checks and history keep working unchanged, and each supplier is still paid
 * out for their own booking only — they never see the others.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── Issuing ────────────────────────────────────────────────────────────────

  /**
   * The booking's current invoice, issuing a one-line invoice if it has none. Null when the
   * booking is not priced yet.
   */
  async ensureBookingInvoice(bookingId: string): Promise<Invoice | null> {
    const active = await this.activeInvoiceFor(bookingId);
    if (active) return active;

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingForInvoice,
    });
    if (!booking || !INVOICEABLE.includes(booking.status)) return null;

    try {
      return await this.issue(booking.customerId, [booking], false, null);
    } catch (error) {
      // Two first requests for the same booking can race; the loser takes the winner's.
      const again = await this.activeInvoiceFor(bookingId);
      if (again) return again;
      throw error;
    }
  }

  /**
   * **Pay together.** Combines two or more of a customer's bookings into one invoice.
   * `customerId` is the caller for a customer; for an admin it is taken from the bookings,
   * which must all belong to the same customer.
   */
  async combine(
    references: string[],
    actor: Actor,
    customerId?: string,
  ): Promise<InvoiceDetailResponse> {
    const unique = [...new Set(references)];
    if (unique.length < 2) {
      throw new BadRequestException('Pick at least two bookings to pay together');
    }

    const bookings = await this.prisma.booking.findMany({
      where: { reference: { in: unique }, ...(customerId ? { customerId } : {}) },
      include: bookingForInvoice,
    });
    const found = new Set(bookings.map((b) => b.reference));
    const missing = unique.filter((r) => !found.has(r));
    if (missing.length > 0) {
      throw new NotFoundException({ message: 'Booking not found', bookingReferences: missing });
    }

    const owner = bookings[0].customerId;
    if (bookings.some((b) => b.customerId !== owner)) {
      throw new BadRequestException('A combined invoice is for one customer’s bookings only');
    }

    const problems: string[] = [];
    for (const b of bookings) {
      if (b.status !== BookingStatus.AWAITING_PAYMENT) {
        problems.push(`${b.reference}: is not awaiting payment`);
      } else if (b.payments.some((p) => p.status !== PaymentStatus.REJECTED)) {
        problems.push(`${b.reference}: already has a payment`);
      }
    }
    if (problems.length > 0) {
      throw new ConflictException({
        message: 'These bookings cannot be paid together',
        problems,
      });
    }

    // Each booking may already sit on an invoice. A single unpaid one is replaced; a
    // combined one must be split first, so a customer never loses track of an invoice.
    const current = await this.prisma.invoiceLine.findMany({
      where: {
        bookingId: { in: bookings.map((b) => b.id) },
        invoice: { status: { not: InvoiceStatus.VOID } },
      },
      include: { invoice: { include: { payments: { select: { id: true } } } } },
    });
    const blocking = current.filter((l) => l.invoice.combined || l.invoice.payments.length > 0);
    if (blocking.length > 0) {
      throw new ConflictException({
        message: 'Some of these bookings are already on another invoice',
        invoiceNumbers: [...new Set(blocking.map((l) => l.invoice.number))],
      });
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await this.issue(owner, bookings, true, actor, tx);
      if (current.length > 0) {
        await tx.invoice.updateMany({
          where: { id: { in: [...new Set(current.map((l) => l.invoiceId))] } },
          data: {
            status: InvoiceStatus.VOID,
            voidedAt: new Date(),
            voidReason: `Combined into ${created.number}`,
          },
        });
      }
      return created;
    });

    return this.detail(invoice.id);
  }

  /**
   * Splits a combined invoice back into its bookings, which get their own invoices again the
   * next time they are paid. Only before any payment has been sent against it.
   */
  async ungroup(customerId: string, number: string): Promise<{ bookingReferences: string[] }> {
    const invoice = await this.requireInvoice(number, customerId);
    this.assertUngroupable(invoice);
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.VOID, voidedAt: new Date(), voidReason: 'Split by customer' },
    });
    return { bookingReferences: invoice.lines.map((l) => l.booking.reference) };
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  async listForCustomer(customerId: string): Promise<InvoiceSummaryResponse[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { customerId, status: { not: InvoiceStatus.VOID } },
      include: invoiceInclude,
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  /** The bookings the "Pay together" picker offers. */
  async payableBookings(customerId: string): Promise<PayableBookingResponse[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { customerId, status: BookingStatus.AWAITING_PAYMENT },
      include: {
        ...bookingForInvoice,
        invoiceLines: {
          where: { invoice: { status: { not: InvoiceStatus.VOID } } },
          include: { invoice: { select: { number: true, combined: true } } },
        },
      },
      orderBy: { startDate: 'asc' },
    });
    return bookings
      .filter(
        (b) =>
          !b.payments.some((p) => p.status !== PaymentStatus.REJECTED) &&
          !b.invoiceLines.some((l) => l.invoice.combined),
      )
      .map((b) => ({
        reference: b.reference,
        description: describe(b),
        amountDueMinor: b.totalMinor + b.securityDepositMinor,
        currency: b.currency,
        invoiceNumber: b.invoiceLines[0]?.invoice.number ?? null,
      }));
  }

  async getForCustomer(customerId: string, number: string): Promise<InvoiceDetailResponse> {
    const invoice = await this.requireInvoice(number, customerId);
    return this.toDetail(invoice, customerId);
  }

  async detail(invoiceId: string): Promise<InvoiceDetailResponse> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: invoiceInclude,
    });
    return this.toDetail(invoice, invoice.customerId);
  }

  // ── Paying ─────────────────────────────────────────────────────────────────

  async paymentInstructions(
    customerId: string,
    number: string,
  ): Promise<InvoicePaymentInstructionsResponse> {
    const invoice = await this.requireInvoice(number, customerId);
    const accounts = await this.settings.paymentAccounts();
    const blockers = this.blockersFor(invoice, customerId);
    const due = invoice.totalMinor + invoice.securityDepositMinor;
    return {
      invoiceNumber: invoice.number,
      currency: invoice.currency,
      amountDueMinor: due,
      amountPaidMinor: invoice.amountPaidMinor,
      telebirr: readTelebirr(accounts),
      bank: readBank(accounts),
      paymentReference: invoice.number,
      canSubmit: blockers.length === 0,
      blockers,
    };
  }

  /**
   * Records one transfer against the invoice: one payment per booking, sharing the receipt
   * and transaction reference, the amount split by what each booking owes.
   */
  async pay(
    customerId: string,
    number: string,
    dto: PayInvoiceDto,
    file: UploadedFile | undefined,
  ): Promise<InvoiceDetailResponse> {
    const invoice = await this.requireInvoice(number, customerId);
    const blockers = this.blockersFor(invoice, customerId);
    if (blockers.length > 0) {
      throw new ConflictException({ message: 'This invoice cannot be paid yet', blockers });
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
      // Under the customer, not a booking: suppliers can read their booking's files, and a
      // receipt carries the customer's bank details and every other booking on it.
      folder: `customers/${customerId}/invoices/${invoice.number}`,
    });

    const dues = invoice.lines.map((l) => l.totalMinor + l.securityDepositMinor);
    const shares = allocatePayment(dto.amountMinor, dues);

    await this.prisma.$transaction(async (tx) => {
      for (const [index, line] of invoice.lines.entries()) {
        await tx.payment.create({
          data: {
            bookingId: line.bookingId,
            invoiceId: invoice.id,
            method: dto.method,
            transactionReference: dto.transactionReference,
            amountMinor: shares[index],
            declaredTotalMinor: invoice.lines.length > 1 ? dto.amountMinor : null,
            currency: invoice.currency,
            receiptFileKey: stored.key,
            receiptFileName: valid.originalname,
            receiptMimeType: valid.mimetype,
            receiptSizeBytes: valid.size,
            status: PaymentStatus.SUBMITTED,
          },
        });
        await tx.bookingStatusEvent.create({
          data: {
            bookingId: line.bookingId,
            fromStatus: line.booking.status,
            toStatus: line.booking.status,
            actorId: customerId,
            actorRole: Role.CUSTOMER,
            reason: `Payment evidence submitted for invoice ${invoice.number}`,
          },
        });
      }
    });

    return this.detail(invoice.id);
  }

  /**
   * Recalculates what has been paid from verified payments. For the admin payment review:
   * when it verifies a payment, this moves the invoice to PARTIALLY_PAID or PAID.
   */
  async recomputePaid(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { payments: true },
    });
    const paid = invoice.payments
      .filter((p) => p.status === PaymentStatus.VERIFIED)
      .reduce((a, p) => a + p.amountMinor, 0);
    const due = invoice.totalMinor + invoice.securityDepositMinor;
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaidMinor: paid,
        status:
          invoice.status === InvoiceStatus.VOID
            ? InvoiceStatus.VOID
            : paid >= due
              ? InvoiceStatus.PAID
              : paid > 0
                ? InvoiceStatus.PARTIALLY_PAID
                : InvoiceStatus.ISSUED,
      },
    });
  }

  // ── PDF ────────────────────────────────────────────────────────────────────

  async pdf(number: string, customerId?: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.requireInvoice(number, customerId, true);
    const [company, accounts] = await Promise.all([
      this.settings.company(),
      this.settings.paymentAccounts(),
    ]);
    const telebirr = readTelebirr(accounts);
    const bank = readBank(accounts);

    const buffer = await renderInvoicePdf({
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      company,
      billedTo: {
        name: invoice.billedToName,
        phone: invoice.billedToPhone,
        address: invoice.billedToAddress,
        tin: invoice.billedToTin,
      },
      lines: invoice.lines.map((l) => ({
        reference: l.booking.reference,
        description: l.description,
        rentalMinor: l.subtotalMinor,
        deliveryMinor: l.deliveryFeeMinor,
        serviceFeeMinor: l.serviceFeeMinor,
        discountMinor: l.discountMinor,
        totalMinor: l.totalMinor,
      })),
      currency: invoice.currency,
      totalMinor: invoice.totalMinor,
      taxMinor: invoice.taxMinor,
      taxRateBps: invoice.taxRateBps,
      vatExempt: invoice.vatExempt,
      vatExemptionReason: invoice.vatExemptionReason,
      securityDepositMinor: invoice.securityDepositMinor,
      amountDueMinor: invoice.totalMinor + invoice.securityDepositMinor,
      amountPaidMinor: invoice.amountPaidMinor,
      paymentInstructions: [
        ...(telebirr ? [`Telebirr: ${telebirr.number} (${telebirr.accountName})`] : []),
        ...(bank ? [`${bank.bank}: ${bank.accountNumber} (${bank.accountName})`] : []),
      ],
    });
    return { buffer, filename: `${invoice.number}.pdf` };
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async adminList(query: AdminInvoiceQuery): Promise<InvoiceSummaryResponse[]> {
    const rows = await this.prisma.invoice.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
      },
      include: invoiceInclude,
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toSummary(r));
  }

  async adminGet(number: string): Promise<InvoiceDetailResponse> {
    const invoice = await this.requireInvoice(number, undefined, true);
    return this.toDetail(invoice, invoice.customerId);
  }

  /**
   * Charges or waives VAT on one invoice — the client's per-invoice exemption. Only before
   * money has been sent against it, since it changes the amount due.
   */
  async setVat(
    adminId: string,
    number: string,
    vatExempt: boolean,
    reason?: string,
  ): Promise<InvoiceDetailResponse> {
    const invoice = await this.requireInvoice(number);
    if (invoice.payments.length > 0) {
      throw new ConflictException(
        'A payment has been sent against this invoice; void and reissue it',
      );
    }
    const figures = buildInvoice(
      invoice.lines.map((l) => figuresOf(l.booking)),
      vatExempt,
    );
    await this.prisma.$transaction([
      ...figures.lines.map((line, index) =>
        this.prisma.invoiceLine.update({
          where: { id: invoice.lines[index].id },
          data: { taxMinor: line.taxMinor, totalMinor: line.totalMinor },
        }),
      ),
      this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          vatExempt,
          vatExemptionReason: vatExempt ? (reason ?? 'VAT exempt') : null,
          taxMinor: figures.taxMinor,
          taxRateBps: figures.taxRateBps,
          totalMinor: figures.totalMinor,
        },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminId,
          action: 'invoice.vat',
          entityType: 'Invoice',
          entityId: invoice.id,
          before: { vatExempt: invoice.vatExempt, totalMinor: invoice.totalMinor },
          after: { vatExempt, totalMinor: figures.totalMinor },
          reason,
        },
      }),
    ]);
    return this.detail(invoice.id);
  }

  async void(adminId: string, number: string, reason: string): Promise<InvoiceDetailResponse> {
    const invoice = await this.requireInvoice(number);
    if (invoice.payments.some((p) => p.status === PaymentStatus.VERIFIED)) {
      throw new ConflictException('A verified payment is recorded against this invoice');
    }
    await this.prisma.$transaction([
      this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.VOID, voidedAt: new Date(), voidReason: reason },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminId,
          action: 'invoice.void',
          entityType: 'Invoice',
          entityId: invoice.id,
          reason,
        },
      }),
    ]);
    return this.detail(invoice.id);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async issue(
    customerId: string,
    bookings: BookingForInvoice[],
    combined: boolean,
    actor: Actor | null,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Invoice> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: customerId },
      include: { customer: true },
    });
    const vatExempt = user.vatExempt;

    let figures;
    try {
      figures = buildInvoice(bookings.map(figuresOf), vatExempt);
    } catch (error) {
      if (error instanceof InvoiceMathError) throw new BadRequestException(error.message);
      throw error;
    }

    const number = await this.numbering.nextInvoiceNumber(new Date(), tx);
    const earliest = bookings.reduce(
      (min, b) => (b.startDate < min ? b.startDate : min),
      bookings[0].startDate,
    );
    const profile = user.customer;

    return tx.invoice.create({
      data: {
        number,
        customerId,
        combined,
        status: InvoiceStatus.ISSUED,
        currency: figures.currency,
        subtotalMinor: figures.subtotalMinor,
        deliveryFeeMinor: figures.deliveryFeeMinor,
        serviceFeeMinor: figures.serviceFeeMinor,
        discountMinor: figures.discountMinor,
        securityDepositMinor: figures.securityDepositMinor,
        taxRateBps: figures.taxRateBps,
        taxMinor: figures.taxMinor,
        vatExempt,
        vatExemptionReason: vatExempt ? 'Customer registered as VAT exempt' : null,
        totalMinor: figures.totalMinor,
        billedToName: profile?.organisationName ?? profile?.contactPerson ?? user.name,
        billedToPhone: profile?.phone ?? user.phone,
        billedToAddress: profile?.address ?? profile?.city ?? null,
        billedToTin: user.tinNumber,
        issuedAt: new Date(),
        // Due before the first rental starts: nothing is delivered unpaid.
        dueAt: earliest,
        issuedById: actor?.role === Role.ADMIN ? actor.id : null,
        notes: actor ? `Combined by ${actor.role.toLowerCase()}` : null,
        lines: {
          create: figures.lines.map((l) => ({
            bookingId: l.bookingId,
            description: l.description,
            subtotalMinor: l.subtotalMinor,
            deliveryFeeMinor: l.deliveryFeeMinor,
            serviceFeeMinor: l.serviceFeeMinor,
            discountMinor: l.discountMinor,
            taxMinor: l.taxMinor,
            securityDepositMinor: l.securityDepositMinor,
            totalMinor: l.totalMinor,
            sortOrder: l.sortOrder,
          })),
        },
      },
    });
  }

  private async activeInvoiceFor(bookingId: string): Promise<Invoice | null> {
    const line = await this.prisma.invoiceLine.findFirst({
      where: { bookingId, invoice: { status: { not: InvoiceStatus.VOID } } },
      include: { invoice: true },
      orderBy: { invoice: { createdAt: 'desc' } },
    });
    return line?.invoice ?? null;
  }

  private async requireInvoice(
    number: string,
    customerId?: string,
    includeVoid = false,
  ): Promise<InvoiceRow> {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        number,
        ...(customerId ? { customerId } : {}),
        ...(includeVoid ? {} : { status: { not: InvoiceStatus.VOID } }),
      },
      include: invoiceInclude,
    });
    // 404 for another customer's invoice, not 403.
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private blockersFor(invoice: InvoiceRow, customerId: string): string[] {
    if (invoice.status === InvoiceStatus.VOID) return ['This invoice has been voided'];
    if (invoice.status === InvoiceStatus.PAID) return ['This invoice is paid'];
    const out: string[] = [];
    for (const line of invoice.lines) {
      const b = line.booking;
      const reason = paymentBlocker(
        b.status,
        b.payments.some((p) => p.status === PaymentStatus.SUBMITTED),
        b.agreements.filter((a) => a.counterpartyId === customerId),
      );
      if (reason) out.push(`${b.reference}: ${reason}`);
    }
    return out;
  }

  private assertUngroupable(invoice: InvoiceRow): void {
    if (!invoice.combined) throw new BadRequestException('Only a combined invoice can be split');
    if (invoice.payments.length > 0) {
      throw new ConflictException('A payment has been sent against this invoice; contact Eskista');
    }
  }

  private toSummary(invoice: InvoiceRow): InvoiceSummaryResponse {
    return {
      number: invoice.number,
      status: invoice.status,
      combined: invoice.combined,
      bookingCount: invoice.lines.length,
      bookingReferences: invoice.lines.map((l) => l.booking.reference),
      currency: invoice.currency,
      totalMinor: invoice.totalMinor,
      amountDueMinor: invoice.totalMinor + invoice.securityDepositMinor,
      amountPaidMinor: invoice.amountPaidMinor,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      dueAt: invoice.dueAt?.toISOString().slice(0, 10) ?? null,
    };
  }

  private toDetail(invoice: InvoiceRow, customerId: string): InvoiceDetailResponse {
    const blockers = this.blockersFor(invoice, customerId);
    const due = invoice.totalMinor + invoice.securityDepositMinor;
    return {
      ...this.toSummary(invoice),
      billedTo: {
        name: invoice.billedToName,
        phone: invoice.billedToPhone,
        address: invoice.billedToAddress,
        tin: invoice.billedToTin,
      },
      lines: invoice.lines.map((l) => {
        const b = l.booking;
        return {
          bookingReference: b.reference,
          bookingStatus: b.status,
          description: l.description,
          subtotalMinor: l.subtotalMinor,
          deliveryFeeMinor: l.deliveryFeeMinor,
          serviceFeeMinor: l.serviceFeeMinor,
          discountMinor: l.discountMinor,
          taxMinor: l.taxMinor,
          securityDepositMinor: l.securityDepositMinor,
          totalMinor: l.totalMinor,
          amountDueMinor: l.totalMinor + l.securityDepositMinor,
          paymentBlocker: paymentBlocker(
            b.status,
            b.payments.some((p) => p.status === PaymentStatus.SUBMITTED),
            b.agreements.filter((a) => a.counterpartyId === customerId),
          ),
        };
      }),
      subtotalMinor: invoice.subtotalMinor,
      deliveryFeeMinor: invoice.deliveryFeeMinor,
      serviceFeeMinor: invoice.serviceFeeMinor,
      discountMinor: invoice.discountMinor,
      securityDepositMinor: invoice.securityDepositMinor,
      taxMinor: invoice.taxMinor,
      taxRateBps: invoice.taxRateBps,
      vatExempt: invoice.vatExempt,
      vatExemptionReason: invoice.vatExemptionReason,
      taxNote: invoice.vatExempt
        ? 'VAT exempt'
        : invoice.taxRateBps > 0
          ? `Inc. ${(invoice.taxRateBps / 100).toFixed(0)}% VAT`
          : null,
      balanceMinor: Math.max(due - invoice.amountPaidMinor, 0),
      payments: invoice.payments.map((p) => ({
        id: p.id,
        bookingReference: p.booking.reference,
        method: p.method,
        transactionReference: p.transactionReference,
        amountMinor: p.amountMinor,
        status: p.status,
        receiptUrl: this.storage.urlFor(p.receiptFileKey),
        submittedAt: p.submittedAt.toISOString(),
      })),
      canPay: blockers.length === 0,
      blockers,
      canUngroup:
        invoice.combined && invoice.status !== InvoiceStatus.VOID && invoice.payments.length === 0,
      pdfUrl: `/api/v1/customer/invoices/${invoice.number}/pdf`,
      voidReason: invoice.voidReason,
    };
  }
}

function describe(b: BookingForInvoice): string {
  const item = b.listing?.name ?? b.talentProfile?.displayName ?? 'Booking';
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dates =
    b.startDate.getTime() === b.endDate.getTime()
      ? fmt(b.startDate)
      : `${fmt(b.startDate)} – ${fmt(b.endDate)}`;
  return `${item} · ${dates}`;
}

function figuresOf(b: BookingForInvoice): BookingFigures {
  return {
    bookingId: b.id,
    description: describe(b),
    currency: b.currency,
    subtotalMinor: b.subtotalMinor,
    deliveryFeeMinor: b.deliveryFeeMinor,
    serviceFeeMinor: b.serviceFeeMinor,
    discountMinor: b.discountMinor,
    taxMinor: b.taxMinor,
    taxRateBps: b.taxRateBps,
    securityDepositMinor: b.securityDepositMinor,
    totalMinor: b.totalMinor,
  };
}
