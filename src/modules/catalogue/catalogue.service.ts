import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  CategoryKind,
  ListingStatus,
  Prisma,
  UnitStatus,
  VerificationStatus,
} from '@prisma/client';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { billablePeriods, computePriceBreakdown, formatMoney } from '../../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import {
  AvailabilityDayResponse,
  AvailabilityRangeQuery,
  BrowseEquipmentQuery,
  CategoryResponse,
  CatalogueReviewResponse,
  EquipmentCardResponse,
  EquipmentDetailResponse,
  HomeResponse,
  QuoteQuery,
  QuoteResponse,
} from './dto/catalogue.dto';
import { TalentCatalogueService } from './talent-catalogue.service';

/**
 * Bookings that actually hold stock.
 *
 * A DRAFT or a rejected request holds nothing, so including them would make the catalogue
 * look emptier than it is. A request still under review is *also* excluded: Eskista has not
 * committed the item, and hiding it would let one unsubmitted enquiry block everyone else.
 */
const HOLDING_STATUSES: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];

const MAX_AVAILABILITY_DAYS = 190;
const DAY_MS = 86_400_000;

/**
 * Only listings a customer is allowed to see.
 *
 * Published, from a verified vendor. Suspending a vendor therefore removes their whole
 * catalogue in one step, which is the point of suspending them.
 */
const VISIBLE: Prisma.ListingWhereInput = {
  status: ListingStatus.PUBLISHED,
  vendor: { status: VerificationStatus.VERIFIED },
};

const cardInclude = {
  vendor: { select: { id: true, businessName: true } },
  category: { select: { name: true } },
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
} satisfies Prisma.ListingInclude;

type ListingCard = Prisma.ListingGetPayload<{ include: typeof cardInclude }>;

@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly talent: TalentCatalogueService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── Categories ─────────────────────────────────────────────────────────────

  async listCategories(kind: CategoryKind = CategoryKind.EQUIPMENT): Promise<CategoryResponse[]> {
    const categories = await this.prisma.category.findMany({
      where: { kind, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const counts =
      kind === CategoryKind.EQUIPMENT
        ? await this.prisma.listing.groupBy({
            by: ['categoryId'],
            where: VISIBLE,
            _count: { categoryId: true },
          })
        : [];
    const byCategory = new Map(counts.map((c) => [c.categoryId, c._count.categoryId]));

    return categories.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      imageUrl: c.imageKey ? this.storage.urlFor(c.imageKey) : null,
      itemCount: byCategory.get(c.id) ?? 0,
    }));
  }

  // ── Home ───────────────────────────────────────────────────────────────────

  /**
   * Everything the Home screen needs, in one round trip.
   *
   * Five separate calls on app open is five chances to show a half-rendered screen over a
   * slow connection, so the rails are assembled server-side and issued concurrently.
   */
  async getHome(): Promise<HomeResponse> {
    const [categories, featured, popular, featuredTalent] = await Promise.all([
      this.listCategories(CategoryKind.EQUIPMENT),
      this.findCards({ ...VISIBLE, isFeatured: true }, [{ publishedAt: 'desc' }], 10),
      this.findCards(VISIBLE, [{ bookingCount: 'desc' }, { ratingAvg: 'desc' }], 10),
      this.talent.featured(6),
    ]);

    return { categories, featured, popular, featuredTalent };
  }

  // ── Browse ─────────────────────────────────────────────────────────────────

  async browseEquipment(query: BrowseEquipmentQuery): Promise<CursorPage<EquipmentCardResponse>> {
    if (
      query.minPriceMinor !== undefined &&
      query.maxPriceMinor !== undefined &&
      query.maxPriceMinor < query.minPriceMinor
    ) {
      throw new BadRequestException('maxPriceMinor must not be below minPriceMinor');
    }

    const where: Prisma.ListingWhereInput = { ...VISIBLE };

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { brand: { contains: query.q, mode: 'insensitive' } },
        { model: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.categorySlug) where.category = { slug: query.categorySlug };
    if (query.location) where.location = { contains: query.location, mode: 'insensitive' };
    if (query.featured !== undefined) where.isFeatured = query.featured;

    if (query.minPriceMinor !== undefined || query.maxPriceMinor !== undefined) {
      where.rentalPriceMinor = {
        ...(query.minPriceMinor !== undefined ? { gte: query.minPriceMinor } : {}),
        ...(query.maxPriceMinor !== undefined ? { lte: query.maxPriceMinor } : {}),
      };
    }

    // Date filtering excludes rather than includes: a listing is hidden if anything holds
    // it, or the vendor blocked it, anywhere inside the requested range.
    if (query.availableFrom || query.availableTo) {
      if (!query.availableFrom || !query.availableTo) {
        throw new BadRequestException('availableFrom and availableTo must be supplied together');
      }
      const from = this.parseDate(query.availableFrom, 'availableFrom');
      const to = this.parseDate(query.availableTo, 'availableTo');
      if (to < from) throw new BadRequestException('availableTo must not be before availableFrom');

      const overlaps = { startDate: { lte: to }, endDate: { gte: from } };
      where.bookings = { none: { status: { in: HOLDING_STATUSES }, ...overlaps } };
      where.blockedDates = { none: overlaps };
    }

    const orderBy = this.orderFor(query.sort);

    // Over-fetch by one to learn whether another page exists without a second count query.
    const rows = await this.prisma.listing.findMany({
      where,
      include: cardInclude,
      orderBy,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasNext = rows.length > query.limit;
    const page = hasNext ? rows.slice(0, query.limit) : rows;
    const holding = await this.holdingToday(page.map((r) => r.id));

    return {
      data: page.map((row) => this.toCard(row, holding.has(row.id))),
      meta: {
        limit: query.limit,
        nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
        hasNext,
      },
    };
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getEquipment(listingId: string): Promise<EquipmentDetailResponse> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, ...VISIBLE },
      include: {
        vendor: true,
        category: { select: { name: true } },
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        specs: { orderBy: { sortOrder: 'asc' } },
        includedItems: { orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] },
        accessories: {
          orderBy: { sortOrder: 'asc' },
          include: { accessory: { include: cardInclude } },
        },
        reviews: {
          where: { isPublished: true },
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: {
            author: { select: { name: true } },
            booking: { select: { projectType: true } },
          },
        },
      },
    });

    // 404 for an unpublished listing rather than 403: a draft's existence is not public.
    if (!listing) throw new NotFoundException('Equipment not found');

    const holding = await this.holdingToday([listing.id]);

    // Only accessories that are themselves publishable may be shown.
    const accessories = listing.accessories
      .map((a) => a.accessory)
      .filter((a) => a.status === ListingStatus.PUBLISHED)
      .map((a) => this.toCard(a, false));

    return {
      ...this.toCard(listing, holding.has(listing.id)),
      imageUrls: listing.images.map((i) => this.storage.urlFor(i.fileKey)),
      description: listing.description,
      mainSpecification: listing.mainSpecification,
      specs: listing.specs.map((s) => ({ group: s.group, label: s.label, value: s.value })),
      includedItems: listing.includedItems.map((i) => ({
        kind: i.kind,
        name: i.name,
        quantity: i.quantity,
      })),
      compatibility: listing.compatibility,
      powerBattery: listing.powerBattery,
      condition: listing.condition,
      minRentalPeriods: listing.minRentalPeriods,
      maxRentalPeriods: listing.maxRentalPeriods,
      securityDepositMinor: listing.securityDepositMinor,
      rentalRequirements: listing.rentalRequirements,
      vendor: {
        id: listing.vendor.id,
        businessName: listing.vendor.businessName,
        logoUrl: listing.vendor.logoKey ? this.storage.urlFor(listing.vendor.logoKey) : null,
        location: listing.vendor.location,
        isVerified: true,
        ratingAvg: Number(listing.vendor.ratingAvg),
        ratingCount: listing.vendor.ratingCount,
      },
      accessories,
      reviews: listing.reviews.map((r) =>
        this.toReview(r.id, r.author.name, r.rating, r.comment, r.booking.projectType, r.createdAt),
      ),
    };
  }

  // ── Availability ───────────────────────────────────────────────────────────

  /**
   * Day-by-day availability for the detail-screen calendar.
   *
   * Two states only. The vendor console distinguishes RENTED from RESERVED from BLOCKED,
   * but telling a stranger *why* a day is taken leaks one customer's booking to another.
   */
  async getAvailability(
    listingId: string,
    query: AvailabilityRangeQuery,
  ): Promise<AvailabilityDayResponse[]> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, ...VISIBLE },
      include: { units: { select: { status: true } } },
    });
    if (!listing) throw new NotFoundException('Equipment not found');

    const from = this.parseDate(query.from, 'from');
    const to = this.parseDate(query.to, 'to');
    if (to < from) throw new BadRequestException('`to` must not be before `from`');

    const spanDays = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_AVAILABILITY_DAYS) {
      throw new BadRequestException(
        `Availability may be requested for at most ${MAX_AVAILABILITY_DAYS} days at a time`,
      );
    }

    const [blocks, bookings] = await Promise.all([
      this.prisma.blockedDateRange.findMany({
        where: { listingId, startDate: { lte: to }, endDate: { gte: from } },
        select: { startDate: true, endDate: true, unitId: true },
      }),
      this.prisma.booking.findMany({
        where: {
          listingId,
          status: { in: HOLDING_STATUSES },
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: {
          startDate: true,
          endDate: true,
          equipmentDetail: { select: { quantity: true } },
        },
      }),
    ]);

    const unitsTotal = listing.units.filter((u) => u.status !== UnitStatus.RETIRED).length;
    const days: AvailabilityDayResponse[] = [];

    for (let i = 0; i < spanDays; i += 1) {
      const day = new Date(from.getTime() + i * DAY_MS);

      const blockedUnits = blocks
        .filter((b) => day >= b.startDate && day <= b.endDate)
        .reduce((sum, b) => sum + (b.unitId ? 1 : unitsTotal), 0);

      const takenUnits = bookings
        .filter((b) => day >= b.startDate && day <= b.endDate)
        .reduce((sum, b) => sum + (b.equipmentDetail?.quantity ?? 1), 0);

      const available = Math.max(unitsTotal - takenUnits - blockedUnits, 0);

      days.push({
        date: day.toISOString().slice(0, 10),
        state: available > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
        unitsAvailable: available,
      });
    }

    return days;
  }

  // ── Quote ──────────────────────────────────────────────────────────────────

  /**
   * Prices a hypothetical rental, for the "Availability & Pricing" panel.
   *
   * Uses exactly the same `computePriceBreakdown` the real booking uses, so the figure the
   * customer is shown before booking is the figure they are charged. A separate "estimate"
   * formula here would eventually disagree with the invoice, and the customer would be
   * right to be annoyed.
   *
   * Never writes anything and never holds stock.
   */
  async quote(listingId: string, query: QuoteQuery): Promise<QuoteResponse> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, ...VISIBLE },
      include: { vendor: { select: { commissionRateBps: true } } },
    });
    if (!listing) throw new NotFoundException('Equipment not found');

    const from = this.parseDate(query.from, 'from');
    const to = this.parseDate(query.to, 'to');
    if (to < from) throw new BadRequestException('`to` must not be before `from`');

    const periods = billablePeriods(from, to);
    const blockers: string[] = [];

    if (periods < listing.minRentalPeriods) {
      blockers.push(
        `This item has a minimum rental of ${listing.minRentalPeriods} ${this.periodWord(listing.rentalPeriodUnit, listing.minRentalPeriods)}`,
      );
    }
    if (listing.maxRentalPeriods && periods > listing.maxRentalPeriods) {
      blockers.push(
        `This item can be rented for at most ${listing.maxRentalPeriods} ${this.periodWord(listing.rentalPeriodUnit, listing.maxRentalPeriods)}`,
      );
    }

    const days = await this.getAvailability(listingId, { from: query.from, to: query.to });
    const shortfall = days.filter((d) => d.unitsAvailable < query.quantity);
    if (shortfall.length > 0) {
      blockers.push(
        shortfall.length === 1
          ? `${shortfall[0]?.date} is not available`
          : `${shortfall.length} days in this range are not available`,
      );
    }

    const [vatBps, defaultDeliveryFee, commissionBps] = await Promise.all([
      this.settings.vatBps(),
      this.settings.deliveryFeeMinor(),
      this.settings.commissionBps(),
    ]);

    const deliveryFeeMinor = query.collectionMethod === 'PICKUP' ? 0 : defaultDeliveryFee;

    const breakdown = computePriceBreakdown(
      {
        unitPriceMinor: listing.rentalPriceMinor,
        periods,
        quantity: query.quantity,
        deliveryFeeMinor,
        securityDepositMinor: (listing.securityDepositMinor ?? 0) * query.quantity,
        taxRateBps: vatBps,
        commissionRateBps: listing.vendor.commissionRateBps ?? commissionBps,
      },
      listing.currency,
    );

    const lines: QuoteResponse['lines'] = [
      {
        kind: 'RENTAL',
        label: `${periods} ${this.periodWord(listing.rentalPeriodUnit, periods)}${query.quantity > 1 ? ` × ${query.quantity} units` : ''} × ${formatMoney(listing.rentalPriceMinor, listing.currency)}`,
        amountMinor: breakdown.subtotalMinor,
      },
    ];
    if (breakdown.deliveryFeeMinor > 0) {
      lines.push({ kind: 'DELIVERY', label: 'Delivery', amountMinor: breakdown.deliveryFeeMinor });
    }
    if (breakdown.taxMinor > 0) {
      lines.push({
        kind: 'VAT',
        label: `VAT (${(vatBps / 100).toFixed(0)}%)`,
        amountMinor: breakdown.taxMinor,
      });
    }
    if (breakdown.serviceFeeMinor > 0) {
      lines.push({
        kind: 'SERVICE_FEE',
        label: 'Service fee',
        amountMinor: breakdown.serviceFeeMinor,
      });
    }

    return {
      from: query.from,
      to: query.to,
      periods,
      quantity: query.quantity,
      currency: breakdown.currency,
      lines,
      subtotalMinor: breakdown.subtotalMinor,
      deliveryFeeMinor: breakdown.deliveryFeeMinor,
      taxMinor: breakdown.taxMinor,
      taxRateBps: vatBps,
      serviceFeeMinor: breakdown.serviceFeeMinor,
      securityDepositMinor: breakdown.securityDepositMinor,
      totalMinor: breakdown.totalMinor,
      amountDueMinor: breakdown.amountDueMinor,
      isBookable: blockers.length === 0,
      blockers,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private orderFor(sort: BrowseEquipmentQuery['sort']): Prisma.ListingOrderByWithRelationInput[] {
    switch (sort) {
      case 'priceAsc':
        return [{ rentalPriceMinor: 'asc' }, { id: 'asc' }];
      case 'priceDesc':
        return [{ rentalPriceMinor: 'desc' }, { id: 'asc' }];
      case 'rating':
        return [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }];
      case 'popular':
        return [{ bookingCount: 'desc' }, { ratingAvg: 'desc' }, { id: 'asc' }];
      case 'newest':
        return [{ publishedAt: 'desc' }, { id: 'asc' }];
      case 'relevance':
      default:
        // Curated first, then well-reviewed, then proven. `id` last so the cursor is
        // stable — without a unique tiebreak, paging can repeat or skip rows.
        return [
          { isFeatured: 'desc' },
          { ratingAvg: 'desc' },
          { bookingCount: 'desc' },
          { id: 'asc' },
        ];
    }
  }

  private async findCards(
    where: Prisma.ListingWhereInput,
    orderBy: Prisma.ListingOrderByWithRelationInput[],
    take: number,
  ): Promise<EquipmentCardResponse[]> {
    const rows = await this.prisma.listing.findMany({ where, include: cardInclude, orderBy, take });
    const holding = await this.holdingToday(rows.map((r) => r.id));
    return rows.map((row) => this.toCard(row, holding.has(row.id)));
  }

  /** Which of these listings are on rent *today*, for the Available/Booked card badge. */
  private async holdingToday(listingIds: string[]): Promise<Set<string>> {
    if (listingIds.length === 0) return new Set();

    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const rows = await this.prisma.booking.findMany({
      where: {
        listingId: { in: listingIds },
        status: { in: HOLDING_STATUSES },
        startDate: { lte: today },
        endDate: { gte: today },
      },
      select: { listingId: true },
    });

    return new Set(rows.map((r) => r.listingId).filter((id): id is string => id !== null));
  }

  private toCard(row: ListingCard, isHeldToday: boolean): EquipmentCardResponse {
    const image = row.images[0];
    return {
      id: row.id,
      name: row.name,
      brand: row.brand,
      vendorName: row.vendor.businessName,
      categoryName: row.category.name,
      imageUrl: image ? this.storage.urlFor(image.fileKey) : null,
      pricePerPeriodMinor: row.rentalPriceMinor,
      periodUnit: row.rentalPeriodUnit,
      currency: row.currency,
      ratingAvg: Number(row.ratingAvg),
      ratingCount: row.ratingCount,
      availabilityToday: isHeldToday ? 'BOOKED' : 'AVAILABLE',
      location: row.location,
      isFeatured: row.isFeatured,
    };
  }

  /** Shortens "Selam Tesfaye" to "Selam T.", as the review cards show. */
  private toReview(
    id: string,
    authorName: string,
    rating: number,
    comment: string | null,
    projectType: string | null,
    createdAt: Date,
  ): CatalogueReviewResponse {
    const [first, ...rest] = authorName.trim().split(/\s+/);
    const surnameInitial = rest.length > 0 ? ` ${rest[rest.length - 1]?.charAt(0)}.` : '';

    return {
      id,
      authorName: `${first ?? 'Customer'}${surnameInitial}`,
      rating,
      comment,
      projectType: projectType ? this.humanise(projectType) : null,
      createdAt: createdAt.toISOString(),
    };
  }

  /** `COMMERCIAL_PRODUCTION` → `Commercial production`. */
  private humanise(value: string): string {
    const lower = value.toLowerCase().replace(/_/g, ' ');
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  private periodWord(unit: string, count: number): string {
    const word = { HOUR: 'hour', DAY: 'day', WEEK: 'week', MONTH: 'month' }[unit] ?? 'period';
    return count === 1 ? word : `${word}s`;
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date`);
    }
    return date;
  }
}
