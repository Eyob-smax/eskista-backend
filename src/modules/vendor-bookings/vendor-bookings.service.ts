import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminTier,
  AgreementType,
  BookingStatus,
  CollectionMethod,
  CustomerKind,
  DeliveryStage,
  FulfilmentDirection,
  InspectionKind,
  PaymentStatus,
  Prisma,
  Role,
  SettlementStatus,
  SupplierResponse,
} from '@prisma/client';
import { paginate, type Paginated } from '../../common/dto/pagination.dto';
import { DEFAULT_CURRENCY } from '../../common/money';
import {
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../common/upload';
import { NotificationsService } from '../notifications/notifications.service';
import { maskAccount } from '../payout-accounts/payout-accounts';
import { AUTO_CLOSE_HOURS, SettlementsService } from '../settlements/settlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import type {
  AcceptBookingDto,
  BookingTab,
  CompletionResponse,
  ConfirmReceiptDto,
  DeclineBookingDto,
  HandoverMethodDto,
  PreparationResponse,
  UpdatePreparationDto,
  VendorBookingDetailResponse,
  VendorBookingListQuery,
  VendorBookingSummaryResponse,
  VendorEarningsQuery,
  VendorEarningsResponse,
  VendorEarningsSummaryResponse,
  VendorInspectionResponse,
  VendorSettlementListQuery,
  VendorSettlementResponse,
  VendorTrackingResponse,
} from './dto/vendor-booking.dto';
import {
  buildChecklist,
  buildVendorActions,
  buildVendorTimeline,
  parseChecklist,
  vendorBadge,
  type ChecklistItem,
} from './vendor-booking-view';

const TAB_STATUSES: Record<BookingTab, BookingStatus[] | undefined> = {
  pending: [BookingStatus.REQUEST_SUBMITTED, BookingStatus.ESKISTA_REVIEW],
  upcoming: [BookingStatus.AWAITING_PAYMENT, BookingStatus.BOOKING_CONFIRMED],
  active: [
    BookingStatus.DELIVERY_PICKUP,
    BookingStatus.IN_PROGRESS,
    BookingStatus.RENTAL_COMPLETED,
    BookingStatus.RETURN_SCHEDULED,
    BookingStatus.RETURN_RECEIVED,
    BookingStatus.INSPECTION,
  ],
  completed: [
    BookingStatus.SETTLEMENT,
    BookingStatus.CLOSED,
    BookingStatus.REJECTED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
  all: undefined,
};

/** Preparation is possible from the vendor's accept until the equipment is handed over. */
const PREPARABLE: BookingStatus[] = [
  BookingStatus.ESKISTA_REVIEW,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
];

/** Handing over needs a booking Eskista has confirmed — the customer has paid. */
const HANDOVER_OPEN: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
];

/** The equipment is back with Eskista, so the vendor can confirm they have it. */
const RETURNED: BookingStatus[] = [
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
  BookingStatus.SETTLEMENT,
];

const MAX_HANDOVER_PHOTOS = 6;

const PRIVACY_NOTE =
  'Client contact details are not shared with vendors. All communication goes through Eskista.';
const INSPECTION_DECLARATION =
  'The inspector has declared that this record is accurate and complete. All findings are ' +
  'final and submitted to Eskista for review.';

const bookingInclude = {
  customer: { select: { customer: { select: { organisationName: true, kind: true } } } },
  vendor: { select: { businessName: true, agreements: true } },
  listing: {
    select: {
      name: true,
      category: { select: { name: true } },
      images: { where: { isPrimary: true }, take: 1 },
      includedItems: { orderBy: { sortOrder: 'asc' } },
    },
  },
  equipmentDetail: true,
  assignedUnits: { include: { unit: true } },
  statusEvents: { orderBy: { createdAt: 'asc' } },
  handover: { include: { photos: { orderBy: { createdAt: 'asc' } } } },
  inspections: { where: { kind: InspectionKind.RETURN }, include: { photos: true }, take: 1 },
  fulfilments: true,
  settlement: { include: { batch: { select: { reference: true, payoutReference: true } } } },
  payments: { where: { status: PaymentStatus.VERIFIED }, orderBy: { verifiedAt: 'desc' }, take: 1 },
} satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/**
 * The vendor's side of an equipment rental, screen by screen: the request, accepting it,
 * preparing the equipment, handing it over, tracking it, confirming it came back,
 * confirming the payout and closing the booking.
 *
 * Eskista moves the booking between stages; the vendor records their own steps inside
 * them (`VendorHandover`). Every step re-checks the booking's real status, so a vendor
 * cannot hand over equipment for an unpaid booking or confirm a payout that was never sent.
 *
 * The vendor never sees the client's identity beyond their organisation name, and never
 * their contact details.
 */
@Injectable()
export class VendorBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly settlements: SettlementsService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── List & detail ──────────────────────────────────────────────────────────

  async list(
    userId: string,
    query: VendorBookingListQuery,
  ): Promise<Paginated<VendorBookingSummaryResponse>> {
    const vendorId = await this.requireVendorId(userId);
    const statuses = TAB_STATUSES[query.tab];
    const where: Prisma.BookingWhereInput = {
      vendorId,
      ...(statuses ? { status: { in: statuses } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: { createdAt: query.sortOrder },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return paginate(
      rows.map((b) => this.toSummary(b)),
      total,
      query,
    );
  }

  async findOne(userId: string, reference: string): Promise<VendorBookingDetailResponse> {
    return this.toDetail(await this.requireOwnedBooking(userId, reference));
  }

  // ── The request ────────────────────────────────────────────────────────────

  /**
   * Accept Booking. Confirms availability; Eskista still approves the booking and
   * collects payment, so this moves only the vendor's own gate. The response carries the
   * "Rental Accepted" next step: prepare the equipment.
   */
  async accept(
    userId: string,
    reference: string,
    dto: AcceptBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    this.assertRespondable(booking);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: booking.id },
        data: {
          supplierResponse: SupplierResponse.ACCEPTED,
          supplierRespondedAt: new Date(),
          supplierDeclineReason: null,
          ...(booking.status === BookingStatus.REQUEST_SUBMITTED
            ? { status: BookingStatus.ESKISTA_REVIEW }
            : {}),
        },
      });
      await tx.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: result.status,
          actorId: userId,
          actorRole: Role.VENDOR,
          reason: dto.note ?? 'Vendor confirmed availability',
          metadata: { supplierResponse: SupplierResponse.ACCEPTED },
        },
      });
      // The checklist exists from the moment of acceptance, so "Prepare Equipment" can open.
      await tx.vendorHandover.upsert({
        where: { bookingId: booking.id },
        create: { bookingId: booking.id, checklist: this.freshChecklist(booking) as never },
        update: {},
      });
    });
    await this.tellEskista(booking.id, 'ADMIN_VENDOR_RESPONDED', { answer: 'accepted' });

    return this.findOne(userId, reference);
  }

  async decline(
    userId: string,
    reference: string,
    dto: DeclineBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    this.assertRespondable(booking);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: booking.id },
        data: {
          supplierResponse: SupplierResponse.DECLINED,
          supplierRespondedAt: new Date(),
          supplierDeclineReason: dto.reason,
          // A vendor decline is kept apart from an Eskista rejection, so the team can
          // still offer the customer an alternative before closing the request.
          status: BookingStatus.ESKISTA_REVIEW,
        },
      });
      await tx.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: result.status,
          actorId: userId,
          actorRole: Role.VENDOR,
          reason: dto.reason,
          metadata: { supplierResponse: SupplierResponse.DECLINED },
        },
      });
    });
    await this.tellEskista(booking.id, 'ADMIN_VENDOR_RESPONDED', { answer: 'declined' });

    return this.findOne(userId, reference);
  }

  // ── Prepare Equipment ──────────────────────────────────────────────────────

  async getPreparation(userId: string, reference: string): Promise<PreparationResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    return this.toPreparation(booking);
  }

  /** Ticks checklist items and sets the condition. Saves as the vendor goes. */
  async updatePreparation(
    userId: string,
    reference: string,
    dto: UpdatePreparationDto,
  ): Promise<PreparationResponse> {
    const booking = await this.requirePreparable(userId, reference);
    const current = this.checklistOf(booking);

    const known = new Set(current.map((c) => c.key));
    const unknown = (dto.checklist ?? []).filter((t) => !known.has(t.key)).map((t) => t.key);
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown checklist item(s): ${unknown.join(', ')}`);
    }
    const ticks = new Map((dto.checklist ?? []).map((t) => [t.key, t.done]));
    const checklist = current.map((c) => ({ ...c, done: ticks.get(c.key) ?? c.done }));

    await this.prisma.vendorHandover.upsert({
      where: { bookingId: booking.id },
      create: { bookingId: booking.id, checklist: checklist as never, condition: dto.condition },
      update: { checklist: checklist as never, condition: dto.condition },
    });
    return this.getPreparation(userId, reference);
  }

  /** "Upload photos before handover — document the equipment condition for your records". */
  async addPreparationPhoto(
    userId: string,
    reference: string,
    file: UploadedFile | undefined,
  ): Promise<PreparationResponse> {
    const booking = await this.requirePreparable(userId, reference);
    const valid = assertValidFile(file, {
      allowed: IMAGE_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.image,
      field: 'photo',
    });
    if ((booking.handover?.photos.length ?? 0) >= MAX_HANDOVER_PHOTOS) {
      throw new ConflictException(`Up to ${MAX_HANDOVER_PHOTOS} condition photos per booking`);
    }

    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      // Under the booking: the vendor, Eskista and the customer may read it — it is the
      // shared record of the state the equipment left in.
      folder: `bookings/${booking.reference}/handover`,
    });

    await this.prisma.vendorHandover.upsert({
      where: { bookingId: booking.id },
      create: { bookingId: booking.id, checklist: this.freshChecklist(booking) as never },
      update: {},
    });
    await this.prisma.vendorHandoverPhoto.create({
      data: { bookingId: booking.id, fileKey: stored.key, fileName: valid.originalname },
    });
    return this.getPreparation(userId, reference);
  }

  async removePreparationPhoto(
    userId: string,
    reference: string,
    photoId: string,
  ): Promise<PreparationResponse> {
    const booking = await this.requirePreparable(userId, reference);
    const photo = booking.handover?.photos.find((p) => p.id === photoId);
    if (!photo) throw new NotFoundException('Photo not found');
    await this.prisma.vendorHandoverPhoto.delete({ where: { id: photo.id } });
    await this.storage.remove(photo.fileKey).catch(() => undefined);
    return this.getPreparation(userId, reference);
  }

  /** Mark as Ready: every checklist item ticked and a condition chosen. */
  async markReady(userId: string, reference: string): Promise<VendorBookingDetailResponse> {
    const booking = await this.requirePreparable(userId, reference);
    const preparation = this.toPreparation(booking);
    if (!preparation.canMarkReady) {
      throw new BadRequestException({
        message: 'The equipment is not ready yet',
        outstandingRequirements: preparation.blockers,
      });
    }

    await this.prisma.vendorHandover.update({
      where: { bookingId: booking.id },
      data: { preparedAt: new Date() },
    });
    await this.recordStep(booking, userId, 'Vendor marked the equipment ready');
    return this.findOne(userId, reference);
  }

  // ── Handover ───────────────────────────────────────────────────────────────

  /** Choose Handover Options: the vendor brings it, or Eskista collects it. */
  async setHandoverMethod(
    userId: string,
    reference: string,
    dto: HandoverMethodDto,
  ): Promise<VendorBookingDetailResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    const h = booking.handover;
    if (!h?.preparedAt) {
      throw new ConflictException('Mark the equipment as ready before choosing the handover');
    }
    if (h.handedOverAt) throw new ConflictException('The equipment has already been handed over');

    const address =
      dto.method === CollectionMethod.DELIVERY
        ? (dto.address ?? booking.equipmentDetail?.deliveryAddress ?? null)
        : null;
    if (dto.method === CollectionMethod.DELIVERY && !address) {
      throw new BadRequestException('A delivery address is required');
    }

    await this.prisma.vendorHandover.update({
      where: { bookingId: booking.id },
      data: {
        method: dto.method,
        address,
        contactPhone: dto.method === CollectionMethod.PICKUP ? dto.contactPhone : null,
        methodChosenAt: new Date(),
      },
    });
    return this.findOne(userId, reference);
  }

  /**
   * Confirm Handover. "Handover record submitted. Eskista will confirm receipt and begin
   * the active rental." The booking's own status is still Eskista's to move.
   */
  async confirmHandover(userId: string, reference: string): Promise<CompletionResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    const h = booking.handover;
    if (!HANDOVER_OPEN.includes(booking.status)) {
      throw new ConflictException(
        'Hand over the equipment once Eskista has confirmed the booking and the client has paid',
      );
    }
    if (!h?.preparedAt) throw new ConflictException('Mark the equipment as ready first');
    if (!h.methodChosenAt) throw new ConflictException('Choose a handover option first');
    if (h.handedOverAt) throw new ConflictException('The handover is already confirmed');

    await this.prisma.vendorHandover.update({
      where: { bookingId: booking.id },
      data: { handedOverAt: new Date() },
    });
    await this.recordStep(booking, userId, 'Vendor confirmed the handover');
    await this.tellEskista(booking.id, 'ADMIN_HANDOVER_CONFIRMED');

    return {
      reference,
      title: 'Equipment Handed Over',
      message:
        'Handover record submitted. Eskista will confirm receipt and begin the active rental.',
      booking: await this.findOne(userId, reference),
    };
  }

  // ── Tracking & return ──────────────────────────────────────────────────────

  /** Track Your Equipment: the courier leg that is live, updated only by Eskista. */
  async tracking(userId: string, reference: string): Promise<VendorTrackingResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    const ret = booking.fulfilments.find((f) => f.direction === FulfilmentDirection.RETURN);
    const outbound = booking.fulfilments.find((f) => f.direction === FulfilmentDirection.OUTBOUND);
    const leg = ret ?? outbound;
    const direction = ret ? 'RETURN' : 'OUTBOUND';

    const order = [
      DeliveryStage.PREPARED,
      DeliveryStage.PICKED_UP,
      DeliveryStage.OUT_FOR_DELIVERY,
      DeliveryStage.DELIVERED,
    ];
    const labels =
      direction === 'RETURN'
        ? ['Return Scheduled', 'Collected from Client', 'On the Way Back', 'Returned']
        : ['Equipment Prepared', 'Picked Up', 'Out for Delivery', 'Delivered'];
    const current = order.indexOf(leg?.stage ?? DeliveryStage.PREPARED);
    const delivered = leg?.stage === DeliveryStage.DELIVERED;

    return {
      reference,
      direction,
      stageLabel: labels[current] ?? labels[0],
      headline:
        direction === 'RETURN'
          ? delivered
            ? 'Your equipment is back.'
            : 'Your equipment is on its way back.'
          : delivered
            ? 'Your equipment has been delivered.'
            : 'Your equipment is on the way.',
      etaAt: leg?.etaAt?.toISOString() ?? null,
      courierName: leg?.courierName ?? null,
      courierPhone: leg?.courierPhone ?? null,
      vehicle: [leg?.vehicleDescription, leg?.vehiclePlate].filter(Boolean).join(' · ') || null,
      productName: booking.listing?.name ?? '—',
      steps: labels.map((label, index) => ({
        key: order[index],
        label,
        state:
          index < current || (delivered && index === current)
            ? 'DONE'
            : index === current
              ? 'IN_PROGRESS'
              : 'PENDING',
      })),
      note: 'Only the admin will be updating this status.',
      canConfirmReceipt: RETURNED.includes(booking.status) && !booking.handover?.returnConfirmedAt,
    };
  }

  /**
   * Confirm Delivery / Confirm Return: the equipment is back with the vendor. Not-Confirmed
   * records a dispute for Eskista to follow up instead.
   */
  async confirmReturn(
    userId: string,
    reference: string,
    dto: ConfirmReceiptDto,
  ): Promise<CompletionResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    if (!RETURNED.includes(booking.status)) {
      throw new ConflictException('The equipment has not been returned to Eskista yet');
    }
    if (booking.handover?.returnConfirmedAt) {
      throw new ConflictException('You have already confirmed the return');
    }

    const now = new Date();
    await this.prisma.vendorHandover.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        checklist: this.freshChecklist(booking) as never,
        ...(dto.confirmed
          ? { returnConfirmedAt: now, returnDisputedAt: null }
          : { returnDisputedAt: now, returnDisputeNote: dto.note }),
      },
      update: dto.confirmed
        ? { returnConfirmedAt: now, returnDisputedAt: null, returnDisputeNote: null }
        : { returnDisputedAt: now, returnDisputeNote: dto.note },
    });
    await this.recordStep(
      booking,
      userId,
      dto.confirmed ? 'Vendor confirmed the equipment is back' : 'Vendor disputed the return',
      dto.note,
    );
    if (!dto.confirmed) await this.tellEskista(booking.id, 'ADMIN_RETURN_DISPUTED');

    return {
      reference,
      title: dto.confirmed ? 'Delivery Confirmed!' : 'Eskista Has Been Told',
      message: dto.confirmed
        ? 'You have confirmed the equipment is back. Eskista will now settle your payout.'
        : 'Eskista will contact you about the return.',
      booking: await this.findOne(userId, reference),
    };
  }

  async inspection(userId: string, reference: string): Promise<VendorInspectionResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    const result = this.toInspection(booking);
    if (!result) throw new NotFoundException('Eskista has not inspected this equipment yet');
    return result;
  }

  // ── Payout & close ─────────────────────────────────────────────────────────

  /**
   * Confirm Payment. "Payment Received! You can now complete this booking, or it will
   * automatically close in 24 hours."
   */
  async confirmPayout(
    userId: string,
    reference: string,
    dto: ConfirmReceiptDto,
  ): Promise<CompletionResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    // The design's order: Confirm Return, then Confirm Payment, then Complete.
    // Gear Eskista kept at its hub for the next rental never reached the vendor, so there is
    // nothing for them to confirm. Only when it was sent back must they confirm it first.
    if (booking.handover?.returnedToVendorAt && !booking.handover.returnConfirmedAt) {
      throw new ConflictException('Confirm the equipment is back with you first');
    }
    if (booking.settlement?.status !== SettlementStatus.PAID) {
      throw new ConflictException('Eskista has not sent your payout yet');
    }
    if (booking.handover?.payoutConfirmedAt) {
      throw new ConflictException('You have already confirmed this payout');
    }

    const now = new Date();
    await this.prisma.vendorHandover.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        checklist: this.freshChecklist(booking) as never,
        ...(dto.confirmed
          ? { payoutConfirmedAt: now }
          : { payoutDisputedAt: now, payoutDisputeNote: dto.note }),
      },
      update: dto.confirmed
        ? { payoutConfirmedAt: now, payoutDisputedAt: null, payoutDisputeNote: null }
        : { payoutDisputedAt: now, payoutDisputeNote: dto.note },
    });
    await this.recordStep(
      booking,
      userId,
      dto.confirmed ? 'Vendor confirmed the payout' : 'Vendor reported the payout missing',
      dto.note,
    );
    if (!dto.confirmed) await this.tellEskista(booking.id, 'ADMIN_PAYOUT_DISPUTED');

    if (dto.confirmed) await this.settlements.scheduleAutoClose(booking.id, now);

    return {
      reference,
      title: dto.confirmed ? 'Payment Received!' : 'Eskista Has Been Told',
      message: dto.confirmed
        ? `Payment confirmed. You can now complete this booking, or it will automatically ` +
          `close in ${AUTO_CLOSE_HOURS} hours.`
        : 'Eskista will look into your payout and contact you.',
      booking: await this.findOne(userId, reference),
    };
  }

  /** Complete the booking now instead of waiting for the automatic close. */
  async complete(userId: string, reference: string): Promise<VendorBookingDetailResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    if (!booking.handover?.payoutConfirmedAt) {
      throw new ConflictException('Confirm you received the payment first');
    }
    await this.settlements.close(booking.id, userId, Role.VENDOR);
    return this.findOne(userId, reference);
  }

  /** The Settlement Record PDF under Documents & Records. */
  async settlementPdf(
    userId: string,
    reference: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const booking = await this.requireOwnedBooking(userId, reference);
    return this.settlements.recordPdf(
      booking.id,
      booking.vendor?.businessName ?? '—',
      booking.listing?.name ?? '—',
    );
  }

  // ── Earnings ───────────────────────────────────────────────────────────────

  async earningsSummary(userId: string): Promise<VendorEarningsSummaryResponse> {
    const vendorId = await this.requireVendorId(userId);
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [paid, today, upcoming] = await this.prisma.$transaction([
      this.prisma.settlement.aggregate({
        where: { vendorId, status: SettlementStatus.PAID },
        _sum: { netMinor: true },
      }),
      this.prisma.settlement.aggregate({
        where: { vendorId, status: SettlementStatus.PAID, paidAt: { gte: todayStart } },
        _sum: { netMinor: true },
      }),
      this.prisma.settlement.aggregate({
        where: { vendorId, status: { in: [SettlementStatus.PENDING, SettlementStatus.IN_BATCH] } },
        _sum: { netMinor: true },
      }),
    ]);

    return {
      totalRevenueMinor: paid._sum.netMinor ?? 0,
      todayEarningsMinor: today._sum.netMinor ?? 0,
      upcomingMinor: upcoming._sum.netMinor ?? 0,
      currency: DEFAULT_CURRENCY,
    };
  }

  /**
   * The Earnings screen: totals plus a list per tab. Overview — everything. Upcoming —
   * earned but not yet paid out. Completed — paid.
   */
  async earnings(userId: string, query: VendorEarningsQuery): Promise<VendorEarningsResponse> {
    const vendorId = await this.requireVendorId(userId);
    const tab = query.tab ?? 'overview';
    const summary = await this.earningsSummary(userId);

    const statusFilter =
      tab === 'upcoming'
        ? { in: [SettlementStatus.PENDING, SettlementStatus.IN_BATCH, SettlementStatus.ON_HOLD] }
        : tab === 'completed'
          ? { equals: SettlementStatus.PAID }
          : undefined;

    const rows = await this.prisma.settlement.findMany({
      where: { vendorId, ...(statusFilter ? { status: statusFilter } : {}) },
      include: {
        booking: {
          select: {
            reference: true,
            listing: { select: { name: true, images: { where: { isPrimary: true }, take: 1 } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      ...summary,
      items: rows.map((r) => {
        const paid = r.status === SettlementStatus.PAID;
        const date = paid ? r.paidAt : r.expectedAt;
        const image = r.booking.listing?.images[0];
        return {
          reference: r.booking.reference,
          productName: r.booking.listing?.name ?? '—',
          productImageUrl: image ? this.storage.urlFor(image.fileKey) : null,
          date: date ? isoDay(date) : isoDay(r.createdAt),
          subtitle: date
            ? `${r.booking.reference} · ${paid ? '' : 'Expected '}${longDate(date)}`
            : r.booking.reference,
          earningsMinor: r.netMinor,
          status: paid ? 'PAID' : 'PENDING',
        };
      }),
    };
  }

  async listSettlements(
    userId: string,
    query: VendorSettlementListQuery,
  ): Promise<Paginated<VendorSettlementResponse>> {
    const vendorId = await this.requireVendorId(userId);
    const where: Prisma.SettlementWhereInput = {
      vendorId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.settlement.findMany({
        where,
        include: {
          batch: { select: { reference: true } },
          booking: {
            select: {
              reference: true,
              listing: { select: { name: true, images: { where: { isPrimary: true }, take: 1 } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.settlement.count({ where }),
    ]);

    const data = rows.map((row) => {
      const image = row.booking.listing?.images[0];
      return {
        id: row.id,
        bookingReference: row.booking.reference,
        productName: row.booking.listing?.name ?? '—',
        productImageUrl: image ? this.storage.urlFor(image.fileKey) : null,
        grossMinor: row.grossMinor,
        commissionMinor: row.commissionMinor,
        deductionMinor: row.deductionMinor,
        netMinor: row.netMinor,
        currency: row.currency,
        status: row.status,
        expectedAt: row.expectedAt,
        paidAt: row.paidAt,
        batchReference: row.batch?.reference ?? null,
      };
    });

    return paginate(data, total, query);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** A vendor step, on the booking's history, without moving its status. */
  /** Raises the admin bell for a vendor step that gives Eskista something to do. */
  private async tellEskista(
    bookingId: string,
    type:
      | 'ADMIN_VENDOR_RESPONDED'
      | 'ADMIN_HANDOVER_CONFIRMED'
      | 'ADMIN_RETURN_DISPUTED'
      | 'ADMIN_PAYOUT_DISPUTED',
    values: Record<string, string> = {},
  ): Promise<void> {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { reference: true, vendor: { select: { businessName: true } } },
    });
    if (!b) return;
    const vendor = b.vendor?.businessName ?? 'The vendor';
    await this.notifications.notifyAdmins(
      type,
      { vendor, payee: vendor, reference: b.reference, ...values },
      { bookingReference: b.reference },
      type === 'ADMIN_PAYOUT_DISPUTED' ? [AdminTier.FINANCE] : [AdminTier.ADMIN],
    );
  }

  private async recordStep(booking: BookingRow, userId: string, reason: string, note?: string) {
    await this.prisma.bookingStatusEvent.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        actorId: userId,
        actorRole: Role.VENDOR,
        reason,
        metadata: note ? { note } : undefined,
      },
    });
  }

  private freshChecklist(booking: BookingRow): ChecklistItem[] {
    return buildChecklist(
      booking.listing?.name ?? 'Equipment',
      (booking.listing?.includedItems ?? []).map((i) => ({ name: i.name, quantity: i.quantity })),
    );
  }

  private checklistOf(booking: BookingRow): ChecklistItem[] {
    const stored = parseChecklist(booking.handover?.checklist);
    return stored.length > 0 ? stored : this.freshChecklist(booking);
  }

  private toPreparation(booking: BookingRow): PreparationResponse {
    const checklist = this.checklistOf(booking);
    const h = booking.handover;
    const doneCount = checklist.filter((c) => c.done).length;
    const blockers: string[] = [];
    if (doneCount < checklist.length) {
      blockers.push(`Tick every checklist item (${doneCount}/${checklist.length})`);
    }
    if (!h?.condition) blockers.push('Choose the equipment condition');

    const open =
      PREPARABLE.includes(booking.status) &&
      booking.supplierResponse === SupplierResponse.ACCEPTED &&
      !h?.preparedAt;

    return {
      checklist,
      doneCount,
      totalCount: checklist.length,
      condition: h?.condition ?? null,
      photos: (h?.photos ?? []).map((p) => ({
        id: p.id,
        url: this.storage.urlFor(p.fileKey),
        fileName: p.fileName,
      })),
      preparedAt: h?.preparedAt?.toISOString() ?? null,
      canMarkReady: open && blockers.length === 0,
      blockers: open ? blockers : h?.preparedAt ? [] : ['This booking is not open for preparation'],
    };
  }

  private toInspection(booking: BookingRow): VendorInspectionResponse | null {
    const i = booking.inspections[0];
    if (!i) return null;
    const passFail = (ok: boolean) => ({
      value: ok ? 'Passed' : 'Failed',
      tone: ok ? 'GOOD' : 'BAD',
    });
    const missing = i.missingItems?.trim();
    const damage = i.outcome === 'DAMAGED' ? (i.damageNotes ?? 'Damage found') : null;
    const overallOk = i.outcome === 'OK' && i.physicalPassed && i.functionalPassed;

    return {
      photoUrls: i.photos.map((p) => this.storage.urlFor(p.fileKey)),
      rows: [
        { label: 'Physical condition', ...passFail(i.physicalPassed) },
        { label: 'Functional test', ...passFail(i.functionalPassed) },
        {
          label: 'Missing accessories',
          value: missing || 'None',
          tone: missing ? 'BAD' : 'GOOD',
        },
        { label: 'Damage', value: damage ?? 'None', tone: damage ? 'BAD' : 'GOOD' },
        { label: 'Inspection result', ...passFail(overallOk) },
      ],
      overallCondition: i.condition ? humanise(i.condition) : null,
      declaration: INSPECTION_DECLARATION,
      deductionMinor: i.feeMinor,
      inspectedAt: i.inspectedAt.toISOString(),
    };
  }

  private toSummary(b: BookingRow): VendorBookingSummaryResponse {
    const image = b.listing?.images[0];
    const org = b.customer.customer;
    return {
      reference: b.reference,
      status: b.status,
      badge: vendorBadge(b.status, b.supplierResponse),
      supplierResponse: b.supplierResponse,
      productName: b.listing?.name ?? '—',
      productCategory: b.listing?.category.name ?? null,
      productImageUrl: image ? this.storage.urlFor(image.fileKey) : null,
      customerOrganisation:
        org?.organisationName ?? (org?.kind === CustomerKind.COMPANY ? 'Company client' : null),
      startDate: isoDay(b.startDate),
      endDate: isoDay(b.endDate),
      periods: b.periods,
      quantity: b.equipmentDetail?.quantity ?? 1,
      collectionMethod: b.equipmentDetail?.collectionMethod ?? null,
      location: b.equipmentDetail?.deliveryAddress ?? null,
      projectDescription: b.projectDescription,
      earningsMinor: b.supplierEarningsMinor,
      currency: b.currency,
      createdAt: b.createdAt.toISOString(),
    };
  }

  private async toDetail(b: BookingRow): Promise<VendorBookingDetailResponse> {
    const h = b.handover;
    const settlementPaid = b.settlement?.status === SettlementStatus.PAID;
    const view = {
      status: b.status,
      supplierResponse: b.supplierResponse,
      handover: h,
      settlementPaid,
    };
    const ret = b.fulfilments.find((f) => f.direction === FulfilmentDirection.RETURN);
    const supportPhone = await this.settings.supportPhone();

    return {
      ...this.toSummary(b),
      vendorName: b.vendor?.businessName ?? '—',
      customerOrganisationType: b.customer.customer
        ? b.customer.customer.kind === CustomerKind.COMPANY
          ? 'Company'
          : 'Individual'
        : null,
      deliveryAddress: b.equipmentDetail?.deliveryAddress ?? null,
      dueAt: b.dueAt?.toISOString() ?? null,
      supplierDeclineReason: b.supplierDeclineReason,
      money: {
        grossRentalMinor: b.supplierEarningsMinor + b.commissionMinor,
        commissionMinor: b.commissionMinor,
        commissionRateBps: b.commissionRateBps,
        earningsMinor: b.supplierEarningsMinor,
        quantity: b.equipmentDetail?.quantity ?? 1,
        customerTotalMinor: b.totalMinor,
        note: 'Payment is managed by Eskista.',
        currency: b.currency,
      },
      timeline: buildVendorTimeline(view),
      actions: buildVendorActions({ ...view, hasInspection: b.inspections.length > 0 }),
      nextStep: this.nextStep(b),
      preparation: this.toPreparation(b),
      handover: {
        method: h?.method ?? null,
        address: h?.address ?? null,
        contactPhone: h?.contactPhone ?? null,
        handedOverAt: h?.handedOverAt?.toISOString() ?? null,
        returnConfirmedAt: h?.returnConfirmedAt?.toISOString() ?? null,
        returnDisputedAt: h?.returnDisputedAt?.toISOString() ?? null,
        payoutConfirmedAt: h?.payoutConfirmedAt?.toISOString() ?? null,
        payoutDisputedAt: h?.payoutDisputedAt?.toISOString() ?? null,
      },
      equipmentIdentification: b.assignedUnits.map((u) => ({
        label: u.unit.label,
        serialNumber: u.unit.serialNumber,
      })),
      inspection: this.toInspection(b),
      equipmentReturn: {
        scheduledAt: ret?.scheduledAt?.toISOString() ?? null,
        method: ret?.method ?? null,
        receivedAt: ret?.completedAt?.toISOString() ?? null,
        confirmedByYouAt: h?.returnConfirmedAt?.toISOString() ?? null,
      },
      payment: this.toPayment(b),
      documents: this.toDocuments(b),
      privacyNote: PRIVACY_NOTE,
      supportPhone,
      activity: b.statusEvents.map((e) => ({
        toStatus: e.toStatus,
        actorRole: e.actorRole,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** "Your next step: Prepare the equipment before Aug 28." */
  private nextStep(b: BookingRow): VendorBookingDetailResponse['nextStep'] {
    const h = b.handover;
    if (b.supplierResponse !== SupplierResponse.ACCEPTED) return null;
    if (!PREPARABLE.includes(b.status)) return null;
    // Ready the day before the rental starts, so there is time to hand it over.
    const due = new Date(b.startDate.getTime() - 86_400_000);
    if (!h?.preparedAt) {
      return {
        title: 'Prepare the equipment',
        dueDate: isoDay(due),
        message: `Your next step: Prepare the equipment before ${shortDate(due)}.`,
      };
    }
    if (!h.handedOverAt) {
      return {
        title: 'Hand over the equipment',
        dueDate: isoDay(b.startDate),
        message: `Your next step: Hand over the equipment by ${shortDate(b.startDate)}.`,
      };
    }
    return null;
  }

  private toPayment(b: BookingRow): VendorBookingDetailResponse['payment'] {
    const s = b.settlement;
    const method = b.payments[0]?.method ?? null;
    const methodLabel = method ? humanise(method) : null;
    const depositHeld =
      b.securityDepositMinor === 0
        ? 'No deposit'
        : b.inspections[0]
          ? b.inspections[0].depositReturnedMinor >= b.securityDepositMinor
            ? 'Released on return'
            : 'Partly withheld'
          : 'Held until return';
    return {
      paymentMethod: methodLabel,
      depositHeld,
      settlementStatus: s?.status ?? null,
      settlementStatusLabel: s ? humanise(s.status) : null,
      settlementDate: s?.paidAt ? isoDay(s.paidAt) : s?.expectedAt ? isoDay(s.expectedAt) : null,
      approvalStatus: s ? (s.status === SettlementStatus.ON_HOLD ? 'On hold' : 'Approved') : null,
      payoutReference: s?.payoutReference ?? s?.batch?.payoutReference ?? null,
      paidTo:
        s?.payoutProvider && s.payoutAccountNumber
          ? `${s.payoutProvider} ${maskAccount(s.payoutAccountNumber)}`
          : null,
      // The payout's own channel — never the customer's payment method.
      note:
        s?.status === SettlementStatus.PAID && s.paidAt
          ? `Settlement paid on ${longDate(s.paidAt)}${s.payoutProvider ? ` via ${s.payoutProvider}` : ''}`
          : null,
    };
  }

  /**
   * Documents & Records. The vendor's agreement is their Eskista vendor agreement — they
   * are never party to the customer's rental agreement. Payment evidence is the payout
   * record, not the customer's receipt, which would carry the customer's bank details.
   */
  private toDocuments(b: BookingRow): VendorBookingDetailResponse['documents'] {
    const docs: VendorBookingDetailResponse['documents'] = [];
    const agreement = b.vendor?.agreements.find(
      (a) => a.kind === AgreementType.VENDOR_ONBOARDING && a.documentKey,
    );
    if (agreement?.documentKey) {
      docs.push({
        kind: 'RENTAL_AGREEMENT',
        label: 'Rental Agreement',
        url: this.storage.urlFor(agreement.scannedCopyKey ?? agreement.documentKey),
        format: 'PDF',
      });
    }
    if (b.settlement) {
      // Rendered on request by this API, with the vendor's session — not a stored file.
      const url = `/api/v1/vendor/bookings/${b.reference}/settlement-record.pdf`;
      docs.push({ kind: 'SETTLEMENT_RECORD', label: 'Settlement Record', url, format: 'PDF' });
      if (b.settlement.status === SettlementStatus.PAID) {
        docs.push({ kind: 'PAYMENT_EVIDENCE', label: 'Payment Evidence', url, format: 'PDF' });
      }
    }
    return docs;
  }

  private async requireVendorId(userId: string): Promise<string> {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!vendor) throw new ForbiddenException('Complete vendor onboarding first');
    return vendor.id;
  }

  private async requireOwnedBooking(userId: string, reference: string): Promise<BookingRow> {
    const vendorId = await this.requireVendorId(userId);
    const booking = await this.prisma.booking.findUnique({
      where: { reference },
      include: bookingInclude,
    });
    if (!booking || booking.vendorId !== vendorId) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private async requirePreparable(userId: string, reference: string): Promise<BookingRow> {
    const booking = await this.requireOwnedBooking(userId, reference);
    if (booking.supplierResponse !== SupplierResponse.ACCEPTED) {
      throw new ConflictException('Accept the booking before preparing the equipment');
    }
    if (!PREPARABLE.includes(booking.status)) {
      throw new ConflictException(`This booking is ${booking.status} and cannot be prepared`);
    }
    if (booking.handover?.preparedAt) {
      throw new ConflictException('The equipment is already marked ready');
    }
    return booking;
  }

  private assertRespondable(booking: BookingRow): void {
    const open: BookingStatus[] = [BookingStatus.REQUEST_SUBMITTED, BookingStatus.ESKISTA_REVIEW];
    if (!open.includes(booking.status)) {
      throw new ConflictException(
        `This booking is ${booking.status} and no longer awaiting your response`,
      );
    }
    if (booking.supplierResponse !== SupplierResponse.PENDING) {
      throw new ConflictException(
        `You have already ${booking.supplierResponse.toLowerCase()} this booking`,
      );
    }
  }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function humanise(value: string): string {
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
