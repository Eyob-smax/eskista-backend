import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgreementStatus,
  BookingStatus,
  BookingType,
  DeliveryStage,
  FulfilmentDirection,
  InspectionKind,
  InvitationStatus,
  PaymentStatus,
  Prisma,
  ReviewKind,
  Role,
} from '@prisma/client';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { HiringService } from '../hiring/hiring.service';
import { BookingWrapUpService } from './booking-wrap-up.service';
import { talentAvatarUrl } from '../talent/talent-media';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import {
  DELIVERY_STEPS,
  buildActions,
  buildReturnTimeline,
  buildTimeline,
  statusBadge,
  statusesForTab,
  stepsFor,
  type TimelineStep,
} from './booking-view';
import {
  ActivityEntryResponse,
  BookingCardResponse,
  BookingDetailResponse,
  BookingDocumentResponse,
  BookingFulfilmentResponse,
  BookingTotalsResponse,
  CancelBookingDto,
  HiringSummaryResponse,
  ListBookingsQuery,
} from './dto/booking.dto';

/** Plain-language labels for what staff recorded at the in-person inspection. */
const INSPECTION_LABELS: Record<string, string> = {
  OK: 'Returned in good condition',
  DAMAGED: 'Damage found',
  MISSING_ITEMS: 'Items missing',
  LATE_RETURN: 'Returned late',
};

/** Statuses a customer may still walk away from. */
const CANCELLABLE: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.REQUEST_SUBMITTED,
  BookingStatus.ESKISTA_REVIEW,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.BOOKING_CONFIRMED,
];

/**
 * The customer-visible activity feed, as an allow-list (AD-4).
 *
 * `BookingStatusEvent` also records vendor decline reasons and internal admin notes. A
 * blocklist would leak every one of those the first time someone adds a status and forgets
 * to exclude it, so the default is to hide: a transition with no entry here is omitted.
 */
const ACTIVITY_LABELS: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.REQUEST_SUBMITTED]: 'Booking request submitted',
  [BookingStatus.ESKISTA_REVIEW]: 'Availability being confirmed with the supplier',
  [BookingStatus.AWAITING_PAYMENT]: 'Booking approved. Quotation sent to customer.',
  [BookingStatus.BOOKING_CONFIRMED]: 'Payment verified and booking confirmed',
  [BookingStatus.DELIVERY_PICKUP]: 'Equipment prepared for delivery',
  [BookingStatus.IN_PROGRESS]: 'Equipment delivered to customer',
  [BookingStatus.RENTAL_COMPLETED]: 'Rental period completed',
  [BookingStatus.RETURN_SCHEDULED]: 'Return scheduled',
  [BookingStatus.RETURN_RECEIVED]: 'Equipment received by Eskista',
  [BookingStatus.INSPECTION]: 'Inspection in progress',
  [BookingStatus.SETTLEMENT]: 'Inspection complete',
  [BookingStatus.CLOSED]: 'Booking completed',
  [BookingStatus.CANCELLED]: 'Booking cancelled',
  [BookingStatus.REJECTED]: 'Booking could not be fulfilled',
  [BookingStatus.EXPIRED]: 'Request expired',
};

const cardInclude = {
  listing: {
    select: {
      id: true,
      name: true,
      vendor: { select: { businessName: true } },
      images: { where: { isPrimary: true }, take: 1, select: { fileKey: true } },
    },
  },
  talentProfile: {
    select: {
      id: true,
      displayName: true,
      avatarKey: true,
      user: { select: { image: true } },
    },
  },
  equipmentDetail: true,
  talentDetail: { select: { headcount: true } },
  invitations: {
    select: {
      status: true,
      expiresAt: true,
      talentProfile: {
        select: {
          id: true,
          displayName: true,
          avatarKey: true,
          user: { select: { image: true } },
        },
      },
    },
    orderBy: { invitedAt: 'asc' },
  },
} satisfies Prisma.BookingInclude;

/** Talent-request wording where the equipment wording would be wrong. */
const TALENT_ACTIVITY: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.ESKISTA_REVIEW]: 'Request sent to the invited talents',
  [BookingStatus.AWAITING_PAYMENT]: 'Talent hired. Agreement and payment details sent.',
};

type BookingCard = Prisma.BookingGetPayload<{ include: typeof cardInclude }>;

@Injectable()
export class CustomerBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly hiring: HiringService,
    private readonly wrapUp: BookingWrapUpService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── List ───────────────────────────────────────────────────────────────────

  async list(userId: string, query: ListBookingsQuery): Promise<CursorPage<BookingCardResponse>> {
    await this.settleOpenRequests(userId);

    const where: Prisma.BookingWhereInput = {
      customerId: userId,
      status: { in: statusesForTab(query.tab) },
      ...(query.type ? { type: query.type } : {}),
    };

    const rows = await this.prisma.booking.findMany({
      where,
      include: cardInclude,
      // Soonest first for what is coming up; most recent first for what is finished.
      orderBy:
        query.tab === 'completed'
          ? [{ updatedAt: 'desc' }, { id: 'asc' }]
          : [{ startDate: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasNext = rows.length > query.limit;
    const page = hasNext ? rows.slice(0, query.limit) : rows;
    const flags = await this.actionFlagsFor(
      userId,
      page.map((r) => r.id),
    );

    return {
      data: page.map((row) => this.toCard(row, flags.get(row.id))),
      meta: {
        limit: query.limit,
        nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
        hasNext,
      },
    };
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(userId: string, reference: string): Promise<BookingDetailResponse> {
    await this.settleOpenRequests(userId, reference);

    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      include: {
        ...cardInclude,
        talentDetail: true as const,
        assignedUnits: { include: { unit: { select: { serialNumber: true, label: true } } } },
        statusEvents: { orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { submittedAt: 'desc' } },
        fulfilments: { orderBy: { createdAt: 'asc' } },
        // The return inspection is the one the customer is shown; the outgoing check is
        // Eskista's own record.
        inspections: { where: { kind: InspectionKind.RETURN }, take: 1 },
        agreements: true,
        settlement: true,
        reviews: {
          where: { authorId: userId, kind: { not: ReviewKind.PLATFORM_SERVICE } },
        },
        _count: { select: { attachments: true } },
        invoiceLines: {
          where: { invoice: { status: { not: 'VOID' } } },
          select: { invoice: { select: { number: true, combined: true } } },
          take: 1,
        },
      },
    });

    // 404 rather than 403 — another customer's reference is not confirmable.
    if (!booking) throw new NotFoundException('Booking not found');

    const supportPhone = await this.settings.supportPhone();

    const occurredAt = this.stepTimestamps(booking.type, booking.statusEvents);
    // Awaiting the customer's scan, or rejected and needing a new one — either way the
    // next move is theirs.
    const pendingAgreement = booking.agreements.find(
      (a) =>
        a.counterpartyId === userId &&
        (a.status === AgreementStatus.AWAITING_UPLOAD || a.status === AgreementStatus.REJECTED),
    );
    const latestPayment = booking.payments[0];

    const delivery = booking.fulfilments.find((f) => f.direction === FulfilmentDirection.OUTBOUND);
    const ret = booking.fulfilments.find((f) => f.direction === FulfilmentDirection.RETURN);
    const returnInspection = booking.inspections[0];

    const card = this.toCard(booking, {
      agreementSigned: booking.agreements.some(
        (a) => a.counterpartyId === userId && a.status === AgreementStatus.APPROVED,
      ),
      agreementPending: pendingAgreement !== undefined,
      paymentPending: latestPayment?.status === PaymentStatus.SUBMITTED,
      hasReview: booking.reviews.length > 0,
    });

    return {
      ...card,
      talent: booking.talentDetail
        ? {
            engagementModel: booking.talentDetail.engagementModel,
            startTime: booking.talentDetail.startTime,
            endTime: booking.talentDetail.endTime,
            hoursPerDay: this.hoursBetween(
              booking.talentDetail.startTime,
              booking.talentDetail.endTime,
            ),
            city: booking.talentDetail.city,
            venue: booking.talentDetail.venue,
            locationNotes: booking.talentDetail.locationNotes,
            budgetBand: booking.talentDetail.budgetBand,
            budgetMinor: booking.talentDetail.budgetMinor,
            headcount: booking.talentDetail.headcount,
            attachmentCount: booking._count.attachments,
          }
        : null,
      projectType: booking.projectType,
      projectDescription: booking.projectDescription,
      quantity: booking.equipmentDetail?.quantity ?? 1,
      assignedSerials: booking.assignedUnits
        .map((u) => u.unit.serialNumber ?? u.unit.label)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
      contactPhone: booking.contactPhone,
      additionalPhone: booking.additionalPhone,
      dueAt: booking.dueAt?.toISOString() ?? null,
      totals: this.toTotals(booking),
      timeline: buildTimeline(booking.type, booking.status, occurredAt),
      delivery: delivery ? this.toFulfilment(delivery, 'OUTBOUND') : null,
      return: ret ? this.toFulfilment(ret, 'RETURN', booking.status) : null,
      payments: booking.payments.map((p) => ({
        id: p.id,
        status: p.status,
        transactionReference: p.transactionReference,
        amountMinor: p.amountMinor,
        method: p.method,
        receiptUrl: this.storage.urlFor(p.receiptFileKey),
        rejectionReason: p.rejectionReason,
        submittedAt: p.submittedAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
      })),
      inspection: returnInspection
        ? {
            isComplete: true,
            outcome: returnInspection.outcome,
            outcomeLabel: INSPECTION_LABELS[returnInspection.outcome ?? 'OK'],
            notes: returnInspection.damageNotes,
            deductionMinor: returnInspection.feeMinor,
            depositReturnedMinor:
              booking.depositRefundMinor ?? returnInspection.depositReturnedMinor,
            completedAt: returnInspection.inspectedAt.toISOString(),
            depositRefundedAt: booking.depositRefundedAt?.toISOString() ?? null,
            depositRefundReference: booking.depositRefundReference,
          }
        : {
            // Present but empty, so the customer knows an inspection is still coming.
            isComplete: false,
            outcome: null,
            outcomeLabel: null,
            notes: null,
            deductionMinor: null,
            depositReturnedMinor: null,
            completedAt: null,
            depositRefundedAt: null,
            depositRefundReference: null,
          },
      documents: this.toDocuments(
        booking.agreements.filter((a) => a.counterpartyId === userId),
        booking.payments,
        booking.invoiceLines[0]?.invoice ?? null,
      ),
      activity: this.toActivity(booking.type, booking.statusEvents),
      pendingAgreementReference: pendingAgreement?.id ?? null,
      supportPhone,
    };
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  /**
   * Customer-initiated cancellation.
   *
   * Allowed right up to confirmation. After that the equipment may already be in transit,
   * so the customer is directed to Eskista rather than being able to unilaterally cancel a
   * booking a courier is already carrying.
   */
  async cancel(
    userId: string,
    reference: string,
    dto: CancelBookingDto,
  ): Promise<BookingDetailResponse> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      select: { id: true, status: true, type: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (!CANCELLABLE.includes(booking.status)) {
      throw new ConflictException(
        'This booking can no longer be cancelled in the app. Contact Eskista support.',
      );
    }

    // Guarded on the status just read: if Eskista moved the booking on (say, to delivery)
    // in the meantime, this must not drag it back to cancelled.
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), cancelledById: userId },
      });
      if (count === 0) {
        throw new ConflictException(
          'This booking has just moved on and can no longer be cancelled in the app. Contact Eskista support.',
        );
      }
      await tx.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: BookingStatus.CANCELLED,
          actorId: userId,
          actorRole: Role.CUSTOMER,
          reason: dto.reason,
        },
      });
    });

    // Agreements, unpaid invoices, waiting slips, jobs, the talent request, the supplier and
    // Eskista's team — exactly what an admin cancel does.
    await this.wrapUp.wrapUp(booking.id, dto.reason ?? 'Cancelled by the customer', userId, 'CUSTOMER');

    return this.getDetail(userId, reference);
  }

  /** Whole hours between two HH:mm times, or null when either is missing or reversed. */
  private hoursBetween(start: string | null, end: string | null): number | null {
    if (!start || !end) return null;
    const [sh = 0, sm = 0] = start.split(':').map(Number);
    const [eh = 0, em = 0] = end.split(':').map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    return minutes > 0 ? Math.ceil(minutes / 60) : null;
  }

  // ── mapping ────────────────────────────────────────────────────────────────

  private toCard(
    row: BookingCard,
    flags:
      | {
          agreementSigned: boolean;
          agreementPending: boolean;
          paymentPending: boolean;
          hasReview: boolean;
        }
      | undefined,
  ): BookingCardResponse {
    const isTalent = row.type === BookingType.TALENT;
    const image = row.listing?.images[0];
    // Before a hire the request has invitees but no talent; show the first invited.
    const subjectTalent = row.talentProfile ?? row.invitations[0]?.talentProfile ?? null;
    const hiring = isTalent && !row.parentBookingId ? this.hiringSummary(row) : null;

    return {
      reference: row.reference,
      type: row.type,
      status: row.status,
      badge: statusBadge(row.status),
      subject: {
        type: row.type,
        id: (isTalent ? subjectTalent?.id : row.listing?.id) ?? '',
        name: (isTalent ? subjectTalent?.displayName : row.listing?.name) ?? 'Unknown',
        supplierName: isTalent ? null : (row.listing?.vendor.businessName ?? null),
        imageUrl: isTalent
          ? subjectTalent
            ? talentAvatarUrl(subjectTalent, this.storage)
            : null
          : image
            ? this.storage.urlFor(image.fileKey)
            : null,
        unitPriceMinor: row.unitPriceMinor,
      },
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate.toISOString().slice(0, 10),
      periods: row.periods,
      currency: row.currency,
      totalMinor: row.totalMinor,
      amountDueMinor: row.totalMinor + row.securityDepositMinor,
      actions: buildActions({
        type: row.type,
        status: row.status,
        agreementSigned: flags?.agreementSigned ?? false,
        agreementPending: flags?.agreementPending ?? false,
        paymentPending: flags?.paymentPending ?? false,
        hasReview: flags?.hasReview ?? false,
        acceptedInvitations: hiring?.accepted ?? 0,
      }),
      hiring,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private hiringSummary(row: BookingCard): HiringSummaryResponse | null {
    if (row.invitations.length === 0) return null;
    const now = Date.now();
    const count = (s: InvitationStatus) =>
      row.invitations.filter((i) =>
        s === InvitationStatus.INVITED
          ? i.status === s && i.expiresAt.getTime() > now
          : i.status === s,
      ).length;
    return {
      invited: row.invitations.length,
      accepted: count(InvitationStatus.ACCEPTED),
      awaitingReply: count(InvitationStatus.INVITED),
      hired: count(InvitationStatus.HIRED),
      headcount: row.talentDetail?.headcount ?? 1,
      selectionDeadlineAt: row.selectionDeadlineAt?.toISOString() ?? null,
      invitedNames: row.invitations.map((i) => i.talentProfile.displayName),
    };
  }

  /**
   * Brings the customer's open talent requests up to date before they are read, so a
   * request whose clock ran out reads as expired even if its job never fired.
   */
  private async settleOpenRequests(userId: string, reference?: string): Promise<void> {
    const open = await this.prisma.booking.findMany({
      where: {
        customerId: userId,
        type: BookingType.TALENT,
        status: BookingStatus.ESKISTA_REVIEW,
        ...(reference ? { reference } : {}),
      },
      select: { id: true },
      take: 20,
    });
    for (const request of open) await this.hiring.reconcile(request.id);
  }

  private toTotals(row: {
    currency: string;
    periods: number;
    subtotalMinor: number;
    deliveryFeeMinor: number;
    discountMinor: number;
    taxMinor: number;
    taxRateBps: number;
    serviceFeeMinor: number;
    securityDepositMinor: number;
    totalMinor: number;
  }): BookingTotalsResponse {
    const lines: BookingTotalsResponse['lines'] = [
      { label: `Rental (${row.periods}d)`, amountMinor: row.subtotalMinor },
    ];
    if (row.deliveryFeeMinor > 0) {
      lines.push({ label: 'Delivery', amountMinor: row.deliveryFeeMinor });
    }
    if (row.discountMinor > 0) {
      lines.push({ label: 'Discount', amountMinor: -row.discountMinor });
    }
    if (row.serviceFeeMinor > 0) {
      lines.push({ label: 'Service fee', amountMinor: row.serviceFeeMinor });
    }

    // No VAT line: every amount above already contains it, so listing it here would
    // imply it gets added again. It is reported separately as `taxMinor` / `taxNote`.

    return {
      currency: row.currency,
      lines,
      taxNote: row.taxRateBps > 0 ? `Inc. ${(row.taxRateBps / 100).toFixed(0)}% VAT` : null,
      netTotalMinor: row.totalMinor - row.taxMinor,
      subtotalMinor: row.subtotalMinor,
      deliveryFeeMinor: row.deliveryFeeMinor,
      discountMinor: row.discountMinor,
      taxMinor: row.taxMinor,
      taxRateBps: row.taxRateBps,
      serviceFeeMinor: row.serviceFeeMinor,
      securityDepositMinor: row.securityDepositMinor,
      totalMinor: row.totalMinor,
      amountDueMinor: row.totalMinor + row.securityDepositMinor,
    };
  }

  private toFulfilment(
    f: {
      method: string;
      address: string | null;
      scheduledAt: Date | null;
      courierName: string | null;
      courierPhone: string | null;
      vehicleDescription: string | null;
      vehiclePlate: string | null;
      etaAt: Date | null;
      stage: DeliveryStage;
      completedAt: Date | null;
    },
    direction: 'OUTBOUND' | 'RETURN',
    bookingStatus?: BookingStatus,
  ): BookingFulfilmentResponse {
    // Outbound follows the courier's four stages. The return follows the booking itself,
    // because its later steps — received, inspected, closed — happen after the courier is
    // done. Mapping five steps onto four courier stages put every state one step out.
    let timeline: TimelineStep[];
    if (direction === 'RETURN' && bookingStatus) {
      timeline = buildReturnTimeline(bookingStatus);
    } else {
      const stageOrder: DeliveryStage[] = [
        DeliveryStage.PREPARED,
        DeliveryStage.PICKED_UP,
        DeliveryStage.OUT_FOR_DELIVERY,
        DeliveryStage.DELIVERED,
      ];
      const current = stageOrder.indexOf(f.stage);
      timeline = DELIVERY_STEPS.map((step, index) => ({
        key: step.key,
        label: step.label,
        state: index < current ? 'DONE' : index === current ? 'IN_PROGRESS' : 'PENDING',
        occurredAt: null,
      }));
    }

    return {
      method: f.method as BookingFulfilmentResponse['method'],
      address: f.address,
      scheduledAt: f.scheduledAt?.toISOString() ?? null,
      courierName: f.courierName,
      courierPhone: f.courierPhone,
      vehicleDescription: f.vehicleDescription,
      vehiclePlate: f.vehiclePlate,
      etaAt: f.etaAt?.toISOString() ?? null,
      stage: f.stage,
      timeline,
      completedAt: f.completedAt?.toISOString() ?? null,
    };
  }

  /**
   * The "Documents & Records" list.
   *
   * Only documents that actually exist are listed. A row that 404s on tap is worse than no
   * row at all — the customer assumes the app is broken rather than that the document is
   * not ready.
   */
  private toDocuments(
    agreements: { documentKey: string | null; status: AgreementStatus }[],
    payments: { receiptFileKey: string }[],
    invoice: { number: string; combined: boolean } | null,
  ): BookingDocumentResponse[] {
    const documents: BookingDocumentResponse[] = [];

    if (invoice) {
      documents.push({
        kind: 'INVOICE',
        label: invoice.combined
          ? `Invoice ${invoice.number} (combined)`
          : `Invoice ${invoice.number}`,
        url: `/api/v1/customer/invoices/${invoice.number}/pdf`,
        format: 'PDF',
      });
    }

    const agreement = agreements.find((a) => a.documentKey);
    if (agreement?.documentKey) {
      documents.push({
        kind: 'RENTAL_AGREEMENT',
        label: 'Rental Agreement',
        url: this.storage.urlFor(agreement.documentKey),
        format: agreement.documentKey.endsWith('.pdf') ? 'PDF' : 'MD',
      });
    }

    const receipt = payments[0];
    if (receipt) {
      documents.push({
        kind: 'PAYMENT_EVIDENCE',
        label: 'Payment Evidence',
        url: this.storage.urlFor(receipt.receiptFileKey),
        format: receipt.receiptFileKey.endsWith('.pdf') ? 'PDF' : 'IMAGE',
      });
    }

    return documents;
  }

  /**
   * Projects the status history into the customer feed.
   *
   * `reason` is deliberately never included: it carries vendor decline reasons and admin
   * notes that are internal to Eskista.
   */
  private toActivity(
    type: BookingType,
    events: { toStatus: BookingStatus; actorRole: Role | null; createdAt: Date }[],
  ): ActivityEntryResponse[] {
    return events
      .map((event) => {
        const message =
          (type === BookingType.TALENT ? TALENT_ACTIVITY[event.toStatus] : undefined) ??
          ACTIVITY_LABELS[event.toStatus];
        if (!message) return null;
        return {
          message,
          actor: this.actorLabel(event),
          occurredAt: event.createdAt.toISOString(),
        };
      })
      .filter((e): e is ActivityEntryResponse => e !== null);
  }

  private actorLabel(event: { toStatus: BookingStatus; actorRole: Role | null }): string {
    if (event.actorRole === Role.CUSTOMER) return 'Customer';
    // Everything a courier does is recorded against the delivery statuses.
    if (event.toStatus === BookingStatus.IN_PROGRESS) return 'Eskista Courier';
    if (event.toStatus === BookingStatus.DELIVERY_PICKUP) return 'Eskista Courier';
    // Vendor actions are attributed to Eskista: the client's rule is that Eskista is the
    // customer's only counterparty, and naming the vendor here would contradict it.
    return 'Eskista';
  }

  /** When the booking entered each timeline step, from the recorded history. */
  private stepTimestamps(
    type: BookingType,
    events: { toStatus: BookingStatus; createdAt: Date }[],
  ): Map<string, Date> {
    const byStatus = new Map<BookingStatus, Date>();
    // Events arrive newest first; the earliest entry into a status is the one to keep.
    for (const event of events) byStatus.set(event.toStatus, event.createdAt);

    const result = new Map<string, Date>();
    for (const step of stepsFor(type)) {
      for (const status of step.active) {
        const at = byStatus.get(status);
        if (at && !result.has(step.key)) result.set(step.key, at);
      }
    }
    return result;
  }

  /** Agreement, payment and review flags for a page of bookings, in three queries. */
  private async actionFlagsFor(
    userId: string,
    bookingIds: string[],
  ): Promise<
    Map<
      string,
      {
        agreementSigned: boolean;
        agreementPending: boolean;
        paymentPending: boolean;
        hasReview: boolean;
      }
    >
  > {
    const result = new Map<
      string,
      {
        agreementSigned: boolean;
        agreementPending: boolean;
        paymentPending: boolean;
        hasReview: boolean;
      }
    >();
    if (bookingIds.length === 0) return result;

    for (const id of bookingIds) {
      result.set(id, {
        agreementSigned: false,
        agreementPending: false,
        paymentPending: false,
        hasReview: false,
      });
    }

    const [agreements, payments, reviews] = await Promise.all([
      this.prisma.agreement.findMany({
        // The customer's own agreements only: a talent booking also carries the talent's,
        // and that one awaiting upload is not the customer's move.
        where: { bookingId: { in: bookingIds }, counterpartyId: userId },
        select: { bookingId: true, status: true },
      }),
      this.prisma.payment.findMany({
        where: { bookingId: { in: bookingIds }, status: PaymentStatus.SUBMITTED },
        select: { bookingId: true },
      }),
      this.prisma.review.findMany({
        where: { bookingId: { in: bookingIds }, kind: { not: ReviewKind.PLATFORM_SERVICE } },
        select: { bookingId: true },
      }),
    ]);

    for (const a of agreements) {
      if (!a.bookingId) continue;
      const flags = result.get(a.bookingId);
      if (!flags) continue;
      if (a.status === AgreementStatus.APPROVED) flags.agreementSigned = true;
      if (a.status === AgreementStatus.AWAITING_UPLOAD || a.status === AgreementStatus.REJECTED) {
        // A rejected scan is still the customer's move: they have to re-upload.
        flags.agreementPending = true;
      }
    }
    for (const p of payments) {
      const flags = result.get(p.bookingId);
      if (flags) flags.paymentPending = true;
    }
    for (const r of reviews) {
      const flags = result.get(r.bookingId);
      if (flags) flags.hasReview = true;
    }

    return result;
  }
}
