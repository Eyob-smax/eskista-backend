import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgreementStatus,
  BookingStatus,
  BookingType,
  DeliveryStage,
  FulfilmentDirection,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import {
  DELIVERY_STEPS,
  RETURN_STEPS,
  buildActions,
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
  ListBookingsQuery,
} from './dto/booking.dto';

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
    select: { id: true, displayName: true, user: { select: { image: true } } },
  },
  equipmentDetail: true,
} satisfies Prisma.BookingInclude;

type BookingCard = Prisma.BookingGetPayload<{ include: typeof cardInclude }>;

@Injectable()
export class CustomerBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── List ───────────────────────────────────────────────────────────────────

  async list(userId: string, query: ListBookingsQuery): Promise<CursorPage<BookingCardResponse>> {
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
    const flags = await this.actionFlagsFor(page.map((r) => r.id));

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
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      include: {
        ...cardInclude,
        talentDetail: true,
        assignedUnits: { include: { unit: { select: { serialNumber: true, label: true } } } },
        statusEvents: { orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { submittedAt: 'desc' } },
        fulfilments: { orderBy: { createdAt: 'asc' } },
        inspection: true,
        agreements: true,
        settlement: true,
        reviews: { where: { authorId: userId } },
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
      return: ret ? this.toFulfilment(ret, 'RETURN') : null,
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
      inspection: booking.inspection
        ? {
            physicalCondition: booking.inspection.condition,
            functionalTest: booking.inspection.outcome === 'OK' ? 'Passed' : 'See notes',
            missingAccessories:
              booking.inspection.outcome === 'MISSING_ITEMS'
                ? (booking.inspection.damageNotes ?? 'Reported')
                : 'None',
            damage:
              booking.inspection.outcome === 'DAMAGED'
                ? (booking.inspection.damageNotes ?? 'Reported')
                : 'None',
            outcome: booking.inspection.outcome,
            completedAt: booking.inspection.inspectedAt.toISOString(),
            isComplete: true,
          }
        : {
            // The design renders every row as a dash until the equipment is back, rather
            // than hiding the panel — so the customer knows an inspection is coming.
            physicalCondition: null,
            functionalTest: null,
            missingAccessories: null,
            damage: null,
            outcome: null,
            completedAt: null,
            isComplete: false,
          },
      documents: this.toDocuments(booking),
      activity: this.toActivity(booking.statusEvents),
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
      select: { id: true, status: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (!CANCELLABLE.includes(booking.status)) {
      throw new ConflictException(
        'This booking can no longer be cancelled in the app. Contact Eskista support.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId,
        },
      }),
      this.prisma.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: BookingStatus.CANCELLED,
          actorId: userId,
          actorRole: Role.CUSTOMER,
          reason: dto.reason,
        },
      }),
    ]);

    // Nothing scheduled against a cancelled booking should still fire — a reminder to
    // return equipment that was never collected is the clearest possible sign the app is
    // not paying attention.
    await this.jobs.cancelBookingJobs(booking.id);

    return this.getDetail(userId, reference);
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

    return {
      reference: row.reference,
      type: row.type,
      status: row.status,
      badge: statusBadge(row.status),
      subject: {
        type: row.type,
        id: (isTalent ? row.talentProfile?.id : row.listing?.id) ?? '',
        name: (isTalent ? row.talentProfile?.displayName : row.listing?.name) ?? 'Unknown',
        supplierName: isTalent ? null : (row.listing?.vendor.businessName ?? null),
        imageUrl: isTalent
          ? (row.talentProfile?.user.image ?? null)
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
      }),
      createdAt: row.createdAt.toISOString(),
    };
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
  ): BookingFulfilmentResponse {
    const steps = direction === 'OUTBOUND' ? DELIVERY_STEPS : RETURN_STEPS;
    const stageOrder: DeliveryStage[] = [
      DeliveryStage.PREPARED,
      DeliveryStage.PICKED_UP,
      DeliveryStage.OUT_FOR_DELIVERY,
      DeliveryStage.DELIVERED,
    ];
    const current = stageOrder.indexOf(f.stage);

    const timeline: TimelineStep[] = steps.map((step, index) => ({
      key: step.key,
      label: step.label,
      state: index < current ? 'DONE' : index === current ? 'IN_PROGRESS' : 'PENDING',
      occurredAt: null,
    }));

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
  private toDocuments(booking: {
    agreements: { documentKey: string | null; status: AgreementStatus }[];
    payments: { receiptFileKey: string }[];
    settlement: { id: string } | null;
  }): BookingDocumentResponse[] {
    const documents: BookingDocumentResponse[] = [];

    const agreement = booking.agreements.find((a) => a.documentKey);
    if (agreement?.documentKey) {
      documents.push({
        kind: 'RENTAL_AGREEMENT',
        label: 'Rental Agreement',
        url: this.storage.urlFor(agreement.documentKey),
        format: agreement.documentKey.endsWith('.pdf') ? 'PDF' : 'MD',
      });
    }

    const receipt = booking.payments[0];
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
    events: { toStatus: BookingStatus; actorRole: Role | null; createdAt: Date }[],
  ): ActivityEntryResponse[] {
    return events
      .map((event) => {
        const message = ACTIVITY_LABELS[event.toStatus];
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
  private async actionFlagsFor(bookingIds: string[]): Promise<
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
        where: { bookingId: { in: bookingIds } },
        select: { bookingId: true, status: true },
      }),
      this.prisma.payment.findMany({
        where: { bookingId: { in: bookingIds }, status: PaymentStatus.SUBMITTED },
        select: { bookingId: true },
      }),
      this.prisma.review.findMany({
        where: { bookingId: { in: bookingIds } },
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
