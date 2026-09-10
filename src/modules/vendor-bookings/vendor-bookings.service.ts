import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  Prisma,
  Role,
  SettlementStatus,
  SupplierResponse,
} from '@prisma/client';
import { paginate, type Paginated } from '../../common/dto/pagination.dto';
import { DEFAULT_CURRENCY } from '../../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import type {
  AcceptBookingDto,
  BookingTab,
  DeclineBookingDto,
  VendorBookingDetailResponse,
  VendorBookingListQuery,
  VendorBookingSummaryResponse,
  VendorEarningsSummaryResponse,
  VendorSettlementListQuery,
  VendorSettlementResponse,
} from './dto/vendor-booking.dto';

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

const bookingInclude = {
  customer: { select: { name: true } },
  listing: { select: { name: true, images: { where: { isPrimary: true }, take: 1 } } },
  equipmentDetail: true,
  assignedUnits: { include: { unit: true } },
  statusEvents: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BookingInclude;

type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

@Injectable()
export class VendorBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

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

    return paginate(rows.map((b) => this.toSummary(b)), total, query);
  }

  async findOne(userId: string, reference: string): Promise<VendorBookingDetailResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    return this.toDetail(booking);
  }

  /**
   * The vendor's half of the review gate.
   *
   * Accepting confirms availability; it does **not** confirm the booking. Eskista still
   * has to approve, which is why this only moves `supplierResponse` and leaves `status`
   * alone. The two gates are independent by design — see docs/DOMAIN-ANALYSIS.md §3.
   */
  async accept(
    userId: string,
    reference: string,
    dto: AcceptBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    this.assertRespondable(booking);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: booking.id },
        data: {
          supplierResponse: SupplierResponse.ACCEPTED,
          supplierRespondedAt: new Date(),
          supplierDeclineReason: null,
          // Surface it to admin as "awaiting Eskista" once the vendor has cleared it.
          ...(booking.status === BookingStatus.REQUEST_SUBMITTED
            ? { status: BookingStatus.ESKISTA_REVIEW }
            : {}),
        },
        include: bookingInclude,
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

      return result;
    });

    return this.toDetail(updated);
  }

  async decline(
    userId: string,
    reference: string,
    dto: DeclineBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    const booking = await this.requireOwnedBooking(userId, reference);
    this.assertRespondable(booking);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: booking.id },
        data: {
          supplierResponse: SupplierResponse.DECLINED,
          supplierRespondedAt: new Date(),
          supplierDeclineReason: dto.reason,
          // A vendor decline is recorded separately from an Eskista rejection, so the
          // team can still offer the customer an alternative before closing the request.
          status: BookingStatus.ESKISTA_REVIEW,
        },
        include: bookingInclude,
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

      return result;
    });

    return this.toDetail(updated);
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
        where: {
          vendorId,
          status: { in: [SettlementStatus.PENDING, SettlementStatus.IN_BATCH] },
        },
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

  private async requireVendorId(userId: string): Promise<string> {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!vendor) throw new ForbiddenException('Complete vendor onboarding first');
    return vendor.id;
  }

  private async requireOwnedBooking(
    userId: string,
    reference: string,
  ): Promise<BookingWithRelations> {
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

  private assertRespondable(booking: BookingWithRelations): void {
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

  private toSummary(booking: BookingWithRelations): VendorBookingSummaryResponse {
    const image = booking.listing?.images[0];
    return {
      reference: booking.reference,
      status: booking.status,
      supplierResponse: booking.supplierResponse,
      productName: booking.listing?.name ?? '—',
      productImageUrl: image ? this.storage.urlFor(image.fileKey) : null,
      customerName: booking.customer.name,
      startDate: booking.startDate,
      endDate: booking.endDate,
      periods: booking.periods,
      quantity: booking.equipmentDetail?.quantity ?? 1,
      collectionMethod: booking.equipmentDetail?.collectionMethod ?? null,
      location: booking.equipmentDetail?.deliveryAddress ?? null,
      projectDescription: booking.projectDescription,
      earningsMinor: booking.supplierEarningsMinor,
      currency: booking.currency,
      createdAt: booking.createdAt,
    };
  }

  private toDetail(booking: BookingWithRelations): VendorBookingDetailResponse {
    return {
      ...this.toSummary(booking),
      grossMinor: booking.subtotalMinor,
      commissionRateBps: booking.commissionRateBps,
      commissionMinor: booking.commissionMinor,
      securityDepositMinor: booking.securityDepositMinor,
      deliveryFeeMinor: booking.deliveryFeeMinor,
      customerTotalMinor: booking.totalMinor,
      deliveryAddress: booking.equipmentDetail?.deliveryAddress ?? null,
      dueAt: booking.dueAt,
      supplierDeclineReason: booking.supplierDeclineReason,
      assignedUnits: booking.assignedUnits.map((au) => ({
        id: au.unit.id,
        label: au.unit.label,
        serialNumber: au.unit.serialNumber,
      })),
      timeline: booking.statusEvents.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorRole: e.actorRole,
        reason: e.reason,
        createdAt: e.createdAt,
      })),
    };
  }
}
