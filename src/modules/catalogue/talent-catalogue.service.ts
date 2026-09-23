import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma, VerificationStatus } from '@prisma/client';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import {
  AvailabilityDayResponse,
  AvailabilityRangeQuery,
  BrowseTalentQuery,
  CatalogueReviewResponse,
  TalentCardResponse,
  TalentDetailResponse,
} from './dto/catalogue.dto';

/** Engagements that occupy a talent's calendar. A pending enquiry does not. */
const HOLDING_STATUSES: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
];

const MAX_AVAILABILITY_DAYS = 190;
const DAY_MS = 86_400_000;

/**
 * Only talent a customer may see: verified, and still accepting work.
 *
 * `isAvailableForHire` is the talent's own switch — someone mid-feature-shoot can hide
 * themselves without their profile being suspended.
 */
const VISIBLE: Prisma.TalentProfileWhereInput = {
  status: VerificationStatus.VERIFIED,
  isAvailableForHire: true,
};

const cardInclude = {
  user: { select: { image: true } },
} satisfies Prisma.TalentProfileInclude;

type TalentCard = Prisma.TalentProfileGetPayload<{ include: typeof cardInclude }>;

@Injectable()
export class TalentCatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** The "Popular" rail on the Talent tab, and the Home promo strip. */
  async featured(take: number): Promise<TalentCardResponse[]> {
    const rows = await this.prisma.talentProfile.findMany({
      where: VISIBLE,
      include: cardInclude,
      orderBy: [{ ratingAvg: 'desc' }, { completedBookings: 'desc' }, { id: 'asc' }],
      take,
    });
    return rows.map((row) => this.toCard(row));
  }

  async browse(query: BrowseTalentQuery): Promise<CursorPage<TalentCardResponse>> {
    if (
      query.minPriceMinor !== undefined &&
      query.maxPriceMinor !== undefined &&
      query.maxPriceMinor < query.minPriceMinor
    ) {
      throw new BadRequestException('maxPriceMinor must not be below minPriceMinor');
    }

    const where: Prisma.TalentProfileWhereInput = { ...VISIBLE };

    if (query.q) {
      where.OR = [
        { displayName: { contains: query.q, mode: 'insensitive' } },
        { headline: { contains: query.q, mode: 'insensitive' } },
        { bio: { contains: query.q, mode: 'insensitive' } },
        { specializations: { hasSome: [query.q] } },
      ];
    }
    if (query.specializations?.length) {
      where.specializations = { hasSome: query.specializations };
    }
    if (query.experienceLevel) where.experienceLevel = query.experienceLevel;
    if (query.location) where.location = { contains: query.location, mode: 'insensitive' };

    // A talent's category is expressed through the services they offer, so filtering by
    // category means "offers at least one service in it".
    if (query.categoryId || query.categorySlug) {
      where.services = {
        some: {
          isActive: true,
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.categorySlug ? { category: { slug: query.categorySlug } } : {}),
        },
      };
    }

    if (query.minPriceMinor !== undefined || query.maxPriceMinor !== undefined) {
      where.baseRateMinor = {
        ...(query.minPriceMinor !== undefined ? { gte: query.minPriceMinor } : {}),
        ...(query.maxPriceMinor !== undefined ? { lte: query.maxPriceMinor } : {}),
      };
    }

    const rows = await this.prisma.talentProfile.findMany({
      where,
      include: cardInclude,
      orderBy: this.orderFor(query.sort),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasNext = rows.length > query.limit;
    const page = hasNext ? rows.slice(0, query.limit) : rows;

    return {
      data: page.map((row) => this.toCard(row)),
      meta: {
        limit: query.limit,
        nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
        hasNext,
      },
    };
  }

  async getTalent(talentProfileId: string): Promise<TalentDetailResponse> {
    const talent = await this.prisma.talentProfile.findFirst({
      where: { id: talentProfileId, ...VISIBLE },
      include: {
        user: { select: { image: true } },
        services: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        portfolio: { orderBy: { sortOrder: 'asc' } },
        reviews: {
          where: { isPublished: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            author: { select: { name: true } },
            booking: { select: { projectType: true } },
          },
        },
      },
    });

    // 404 rather than 403 — an unverified or hidden profile is not public knowledge.
    if (!talent) throw new NotFoundException('Talent not found');

    return {
      ...this.toCard(talent),
      bio: talent.bio,
      yearsExperience: talent.yearsExperience,
      languages: talent.languages,
      services: talent.services.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        pricingModel: s.pricingModel,
        priceMinor: s.priceMinor,
        currency: s.currency,
      })),
      portfolio: talent.portfolio.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        imageUrl: p.fileKey ? this.storage.urlFor(p.fileKey) : null,
        externalUrl: p.externalUrl,
      })),
      reviews: talent.reviews.map((r) =>
        this.toReview(r.id, r.author.name, r.rating, r.comment, r.booking.projectType, r.createdAt),
      ),
    };
  }

  /**
   * Day-by-day availability for the talent profile calendar.
   *
   * A person is one unit — unlike equipment, there is no quantity to run down — so a day
   * is simply free or not.
   */
  async getAvailability(
    talentProfileId: string,
    query: AvailabilityRangeQuery,
  ): Promise<AvailabilityDayResponse[]> {
    const exists = await this.prisma.talentProfile.findFirst({
      where: { id: talentProfileId, ...VISIBLE },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Talent not found');

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
      this.prisma.talentBlockedDateRange.findMany({
        where: { talentProfileId, startDate: { lte: to }, endDate: { gte: from } },
        select: { startDate: true, endDate: true },
      }),
      this.prisma.booking.findMany({
        where: {
          talentProfileId,
          status: { in: HOLDING_STATUSES },
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { startDate: true, endDate: true },
      }),
    ]);

    const days: AvailabilityDayResponse[] = [];
    for (let i = 0; i < spanDays; i += 1) {
      const day = new Date(from.getTime() + i * DAY_MS);
      const taken =
        blocks.some((b) => day >= b.startDate && day <= b.endDate) ||
        bookings.some((b) => day >= b.startDate && day <= b.endDate);

      days.push({
        date: day.toISOString().slice(0, 10),
        state: taken ? 'UNAVAILABLE' : 'AVAILABLE',
        unitsAvailable: taken ? 0 : 1,
      });
    }

    return days;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private orderFor(
    sort: BrowseTalentQuery['sort'],
  ): Prisma.TalentProfileOrderByWithRelationInput[] {
    switch (sort) {
      case 'priceAsc':
        return [{ baseRateMinor: 'asc' }, { id: 'asc' }];
      case 'priceDesc':
        return [{ baseRateMinor: 'desc' }, { id: 'asc' }];
      case 'rating':
        return [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }];
      case 'popular':
        return [{ completedBookings: 'desc' }, { ratingAvg: 'desc' }, { id: 'asc' }];
      case 'relevance':
      default:
        return [{ ratingAvg: 'desc' }, { completedBookings: 'desc' }, { id: 'asc' }];
    }
  }

  private toCard(row: TalentCard): TalentCardResponse {
    return {
      id: row.id,
      displayName: row.displayName,
      headline: row.headline,
      avatarUrl: row.user.image,
      location: row.location,
      ratingAvg: Number(row.ratingAvg),
      ratingCount: row.ratingCount,
      completedBookings: row.completedBookings,
      baseRateMinor: row.baseRateMinor,
      pricingModel: row.pricingModel,
      currency: row.currency,
      isAvailableForHire: row.isAvailableForHire,
      experienceLevel: row.experienceLevel,
      specializations: row.specializations,
    };
  }

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
    const humanised = projectType
      ? projectType
          .toLowerCase()
          .replace(/_/g, ' ')
          .replace(/^./, (c) => c.toUpperCase())
      : null;

    return {
      id,
      authorName: `${first ?? 'Customer'}${surnameInitial}`,
      rating,
      comment,
      projectType: humanised,
      createdAt: createdAt.toISOString(),
    };
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date`);
    }
    return date;
  }
}
