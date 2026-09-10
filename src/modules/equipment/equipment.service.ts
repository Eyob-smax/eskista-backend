import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  ConditionGrade,
  IncludedItemKind,
  ListingStatus,
  Prisma,
  RentalPeriodUnit,
  UnitStatus,
  VerificationStatus,
} from '@prisma/client';
import { paginate, type Paginated } from '../../common/dto/pagination.dto';
import { DEFAULT_CURRENCY } from '../../common/money';
import {
  assertValidFile,
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  type UploadedFile,
} from '../../common/upload';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import type {
  AvailabilityDayResponse,
  AvailabilityQuery,
  BlockDatesDto,
  CreateEquipmentDto,
  CreateUnitDto,
  EquipmentDetailResponse,
  EquipmentImageResponse,
  EquipmentListQuery,
  EquipmentSummaryResponse,
  EquipmentUnitResponse,
  ReplaceAccessoriesDto,
  ReplaceIncludedItemsDto,
  ReplaceSpecsDto,
  UpdateEquipmentDto,
  UpdateImageDto,
  UpdateUnitDto,
} from './dto/equipment.dto';

/** Bookings that physically hold a unit right now. */
const RENTED_STATUSES: BookingStatus[] = [
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];

/** Bookings that have locked dates but have not started. */
const RESERVED_STATUSES: BookingStatus[] = [BookingStatus.BOOKING_CONFIRMED];

const LIVE_STATUSES = [...RENTED_STATUSES, ...RESERVED_STATUSES];

const SORTABLE = new Set([
  'createdAt',
  'name',
  'rentalPriceMinor',
  'ratingAvg',
  'bookingCount',
  'status',
]);

const detailInclude = {
  category: true,
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  specs: { orderBy: { sortOrder: 'asc' } },
  includedItems: { orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] },
  units: { orderBy: { createdAt: 'asc' } },
  accessories: {
    orderBy: { sortOrder: 'asc' },
    include: { accessory: { include: { category: true, images: true } } },
  },
} satisfies Prisma.ListingInclude;

type ListingDetail = Prisma.ListingGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateEquipmentDto): Promise<EquipmentDetailResponse> {
    const vendorId = await this.requireVendorId(userId);
    await this.assertCategoryExists(dto.categoryId);

    if (dto.maxRentalPeriods && dto.minRentalPeriods && dto.maxRentalPeriods < dto.minRentalPeriods) {
      throw new BadRequestException('maxRentalPeriods must be greater than or equal to minRentalPeriods');
    }

    const listing = await this.prisma.listing.create({
      data: {
        vendorId,
        categoryId: dto.categoryId,
        name: dto.name,
        brand: dto.brand,
        model: dto.model,
        mainSpecification: dto.mainSpecification,
        compatibility: dto.compatibility ?? [],
        powerBattery: dto.powerBattery,
        condition: dto.condition ?? ConditionGrade.EXCELLENT,
        conditionNotes: dto.conditionNotes,
        description: dto.description,
        location: dto.location,
        rentalPriceMinor: dto.rentalPriceMinor,
        rentalPeriodUnit: dto.rentalPeriodUnit ?? RentalPeriodUnit.DAY,
        minRentalPeriods: dto.minRentalPeriods ?? 1,
        maxRentalPeriods: dto.maxRentalPeriods,
        securityDepositMinor: dto.securityDepositMinor,
        replacementValueMinor: dto.replacementValueMinor,
        rentalRequirements: dto.rentalRequirements,
        status: ListingStatus.DRAFT,
        currency: DEFAULT_CURRENCY,
        specs: dto.specs?.length
          ? { create: dto.specs.map((s, i) => ({ ...s, sortOrder: i })) }
          : undefined,
        includedItems: dto.includedItems?.length
          ? {
              create: dto.includedItems.map((item, i) => ({
                kind: item.kind,
                name: item.name,
                quantity: item.quantity ?? 1,
                sortOrder: i,
              })),
            }
          : undefined,
      },
      include: detailInclude,
    });

    return this.toDetail(listing, new Map());
  }

  async list(userId: string, query: EquipmentListQuery): Promise<Paginated<EquipmentSummaryResponse>> {
    const vendorId = await this.requireVendorId(userId);

    const where: Prisma.ListingWhereInput = {
      vendorId,
      status: query.status ?? { not: ListingStatus.ARCHIVED },
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { brand: { contains: query.q, mode: 'insensitive' } },
              { model: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const sortBy = query.sortBy && SORTABLE.has(query.sortBy) ? query.sortBy : 'createdAt';

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: { category: true, images: { where: { isPrimary: true }, take: 1 }, units: true },
        orderBy: { [sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.listing.count({ where }),
    ]);

    const liveByListing = await this.liveBookingsFor(rows.map((r) => r.id));

    const data = rows.map((row) =>
      this.toSummary(
        {
          ...row,
          images: row.images,
        },
        liveByListing.get(row.id),
      ),
    );

    return paginate(data, total, query);
  }

  async findOne(userId: string, listingId: string): Promise<EquipmentDetailResponse> {
    const listing = await this.requireOwnedListing(userId, listingId);
    const live = await this.liveBookingsFor([listing.id]);
    return this.toDetail(listing, live);
  }

  async update(
    userId: string,
    listingId: string,
    dto: UpdateEquipmentDto,
  ): Promise<EquipmentDetailResponse> {
    const listing = await this.requireOwnedListing(userId, listingId);
    this.assertEditable(listing.status);

    if (dto.categoryId) await this.assertCategoryExists(dto.categoryId);

    const { specs, includedItems, ...scalars } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (specs) {
        await tx.listingSpec.deleteMany({ where: { listingId } });
        if (specs.length > 0) {
          await tx.listingSpec.createMany({
            data: specs.map((s, i) => ({ listingId, ...s, sortOrder: i })),
          });
        }
      }
      if (includedItems) {
        await tx.listingIncludedItem.deleteMany({ where: { listingId } });
        if (includedItems.length > 0) {
          await tx.listingIncludedItem.createMany({
            data: includedItems.map((item, i) => ({
              listingId,
              kind: item.kind,
              name: item.name,
              quantity: item.quantity ?? 1,
              sortOrder: i,
            })),
          });
        }
      }

      return tx.listing.update({
        where: { id: listingId },
        data: {
          ...scalars,
          ...(scalars.compatibility ? { compatibility: scalars.compatibility } : {}),
          // Editing a published listing returns it to review, so nothing changes
          // under customers without Eskista seeing it.
          ...(listing.status === ListingStatus.PUBLISHED
            ? { status: ListingStatus.PENDING_REVIEW }
            : {}),
        },
        include: detailInclude,
      });
    });

    const live = await this.liveBookingsFor([listingId]);
    return this.toDetail(updated, live);
  }

  /** Archives rather than deletes: booking history must survive. */
  async archive(userId: string, listingId: string): Promise<void> {
    const listing = await this.requireOwnedListing(userId, listingId);

    const live = await this.prisma.booking.count({
      where: { listingId, status: { in: LIVE_STATUSES } },
    });
    if (live > 0) {
      throw new ConflictException(
        `This listing has ${live} live booking(s) and cannot be archived yet`,
      );
    }

    await this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: ListingStatus.ARCHIVED },
    });
  }

  async submitForReview(userId: string, listingId: string): Promise<EquipmentDetailResponse> {
    const listing = await this.requireOwnedListing(userId, listingId);

    if (listing.status === ListingStatus.PENDING_REVIEW) {
      throw new ConflictException('This listing is already awaiting review');
    }
    if (listing.status === ListingStatus.SUSPENDED) {
      throw new BadRequestException('Suspended listings cannot be resubmitted; contact support');
    }

    const vendor = await this.prisma.vendorProfile.findUnique({ where: { id: listing.vendorId } });
    if (vendor?.status !== VerificationStatus.VERIFIED) {
      throw new BadRequestException(
        'Your vendor profile must be verified before equipment can be published',
      );
    }

    const outstanding = this.outstandingRequirements(listing);
    if (outstanding.length > 0) {
      throw new BadRequestException({
        message: 'Listing is not ready for review',
        outstandingRequirements: outstanding,
      });
    }

    const updated = await this.prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: ListingStatus.PENDING_REVIEW,
        submittedAt: new Date(),
        rejectionReason: null,
      },
      include: detailInclude,
    });

    const live = await this.liveBookingsFor([listingId]);
    return this.toDetail(updated, live);
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  async addImage(
    userId: string,
    listingId: string,
    file: UploadedFile,
  ): Promise<EquipmentImageResponse> {
    const listing = await this.requireOwnedListing(userId, listingId);
    assertValidFile(file, {
      allowed: IMAGE_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.image,
      field: 'image',
    });

    if (listing.images.length >= 12) {
      throw new BadRequestException('A listing may have at most 12 photos');
    }

    const stored = await this.storage.put({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `listings/${listing.id}/images`,
    });

    const isFirst = listing.images.length === 0;
    const image = await this.prisma.listingImage.create({
      data: {
        listingId: listing.id,
        fileKey: stored.key,
        // The first upload becomes the main image automatically.
        isPrimary: isFirst,
        sortOrder: listing.images.length,
      },
    });

    return this.toImage(image);
  }

  async updateImage(
    userId: string,
    listingId: string,
    imageId: string,
    dto: UpdateImageDto,
  ): Promise<EquipmentImageResponse> {
    const listing = await this.requireOwnedListing(userId, listingId);
    const image = listing.images.find((i) => i.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        // Exactly one main image: demote the rest in the same transaction.
        await tx.listingImage.updateMany({
          where: { listingId: listing.id, id: { not: imageId } },
          data: { isPrimary: false },
        });
      }
      return tx.listingImage.update({
        where: { id: imageId },
        data: { isPrimary: dto.isPrimary, sortOrder: dto.sortOrder, altText: dto.altText },
      });
    });

    return this.toImage(updated);
  }

  async deleteImage(userId: string, listingId: string, imageId: string): Promise<void> {
    const listing = await this.requireOwnedListing(userId, listingId);
    const image = listing.images.find((i) => i.id === imageId);
    if (!image) throw new NotFoundException('Image not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.listingImage.delete({ where: { id: imageId } });

      // Never leave a listing without a main image.
      if (image.isPrimary) {
        const next = await tx.listingImage.findFirst({
          where: { listingId: listing.id },
          orderBy: { sortOrder: 'asc' },
        });
        if (next) {
          await tx.listingImage.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }
    });

    await this.storage.remove(image.fileKey);
  }

  // ── Specs, included items, accessories ─────────────────────────────────────

  async replaceSpecs(userId: string, listingId: string, dto: ReplaceSpecsDto): Promise<void> {
    await this.requireOwnedListing(userId, listingId);
    await this.prisma.$transaction([
      this.prisma.listingSpec.deleteMany({ where: { listingId } }),
      this.prisma.listingSpec.createMany({
        data: dto.specs.map((s, i) => ({ listingId, ...s, sortOrder: i })),
      }),
    ]);
  }

  async replaceIncludedItems(
    userId: string,
    listingId: string,
    dto: ReplaceIncludedItemsDto,
  ): Promise<void> {
    await this.requireOwnedListing(userId, listingId);
    await this.prisma.$transaction([
      this.prisma.listingIncludedItem.deleteMany({ where: { listingId } }),
      this.prisma.listingIncludedItem.createMany({
        data: dto.items.map((item, i) => ({
          listingId,
          kind: item.kind,
          name: item.name,
          quantity: item.quantity ?? 1,
          sortOrder: i,
        })),
      }),
    ]);
  }

  async replaceAccessories(
    userId: string,
    listingId: string,
    dto: ReplaceAccessoriesDto,
  ): Promise<void> {
    const vendorId = await this.requireVendorId(userId);
    await this.requireOwnedListing(userId, listingId);

    if (dto.listingIds.includes(listingId)) {
      throw new BadRequestException('A listing cannot be its own accessory');
    }

    const owned = await this.prisma.listing.count({
      where: { id: { in: dto.listingIds }, vendorId },
    });
    if (owned !== dto.listingIds.length) {
      throw new BadRequestException('Related accessories must be your own listings');
    }

    await this.prisma.$transaction([
      this.prisma.listingAccessory.deleteMany({ where: { listingId } }),
      this.prisma.listingAccessory.createMany({
        data: dto.listingIds.map((accessoryId, i) => ({ listingId, accessoryId, sortOrder: i })),
      }),
    ]);
  }

  // ── Units ──────────────────────────────────────────────────────────────────

  async listUnits(userId: string, listingId: string): Promise<EquipmentUnitResponse[]> {
    const listing = await this.requireOwnedListing(userId, listingId);
    const counts = await this.prisma.bookingUnit.groupBy({
      by: ['unitId'],
      where: {
        unitId: { in: listing.units.map((u) => u.id) },
        booking: { status: { in: LIVE_STATUSES } },
      },
      _count: { unitId: true },
    });
    const byUnit = new Map(counts.map((c) => [c.unitId, c._count.unitId]));
    return listing.units.map((u) => this.toUnit(u, byUnit.get(u.id) ?? 0));
  }

  async createUnit(
    userId: string,
    listingId: string,
    dto: CreateUnitDto,
  ): Promise<EquipmentUnitResponse> {
    const listing = await this.requireOwnedListing(userId, listingId);

    if (dto.serialNumber) {
      const clash = await this.prisma.equipmentUnit.findFirst({
        where: { listingId: listing.id, serialNumber: dto.serialNumber },
      });
      if (clash) throw new ConflictException('That serial number already exists on this listing');
    }

    const unit = await this.prisma.equipmentUnit.create({
      data: {
        listingId: listing.id,
        label: dto.label ?? `Unit ${listing.units.length + 1}`,
        serialNumber: dto.serialNumber,
        condition: dto.condition ?? listing.condition,
        conditionNotes: dto.conditionNotes,
      },
    });

    return this.toUnit(unit, 0);
  }

  async updateUnit(
    userId: string,
    listingId: string,
    unitId: string,
    dto: UpdateUnitDto,
  ): Promise<EquipmentUnitResponse> {
    const listing = await this.requireOwnedListing(userId, listingId);
    const unit = listing.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unit not found');

    if (dto.status && dto.status !== UnitStatus.AVAILABLE) {
      const live = await this.prisma.bookingUnit.count({
        where: { unitId, booking: { status: { in: LIVE_STATUSES } } },
      });
      if (live > 0) {
        throw new ConflictException(
          'This unit is assigned to a live booking and cannot be taken out of service',
        );
      }
    }

    const updated = await this.prisma.equipmentUnit.update({
      where: { id: unitId },
      data: {
        ...dto,
        ...(dto.status === UnitStatus.RETIRED ? { retiredAt: new Date() } : {}),
      },
    });

    return this.toUnit(updated, 0);
  }

  async deleteUnit(userId: string, listingId: string, unitId: string): Promise<void> {
    const listing = await this.requireOwnedListing(userId, listingId);
    const unit = listing.units.find((u) => u.id === unitId);
    if (!unit) throw new NotFoundException('Unit not found');

    const everBooked = await this.prisma.bookingUnit.count({ where: { unitId } });
    if (everBooked > 0) {
      throw new ConflictException(
        'This unit has booking history. Retire it instead of deleting it.',
      );
    }

    await this.prisma.equipmentUnit.delete({ where: { id: unitId } });
  }

  // ── Availability ───────────────────────────────────────────────────────────

  /**
   * The vendor "Set Availability" calendar.
   *
   * Only BLOCKED is stored. RESERVED and RENTED are computed from bookings on every
   * request, which is why a stored `isAvailable` flag would inevitably drift.
   * Precedence is physical-reality-first: RENTED > RESERVED > BLOCKED > AVAILABLE.
   */
  async getAvailability(
    userId: string,
    listingId: string,
    query: AvailabilityQuery,
  ): Promise<AvailabilityDayResponse[]> {
    const listing = await this.requireOwnedListing(userId, listingId);

    const from = this.parseDate(query.from, 'from');
    const to = this.parseDate(query.to, 'to');
    if (to < from) throw new BadRequestException('`to` must not be before `from`');

    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (spanDays > 190) {
      throw new BadRequestException('Availability may be requested for at most 190 days at a time');
    }

    const [blocks, bookings] = await this.prisma.$transaction([
      this.prisma.blockedDateRange.findMany({
        where: { listingId, startDate: { lte: to }, endDate: { gte: from } },
      }),
      this.prisma.booking.findMany({
        where: {
          listingId,
          status: { in: LIVE_STATUSES },
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: {
          status: true,
          startDate: true,
          endDate: true,
          equipmentDetail: { select: { quantity: true } },
        },
      }),
    ]);

    const unitsTotal = listing.units.filter((u) => u.status !== UnitStatus.RETIRED).length;
    const days: AvailabilityDayResponse[] = [];

    for (let i = 0; i < spanDays; i += 1) {
      const day = new Date(from.getTime() + i * 86_400_000);
      const iso = day.toISOString().slice(0, 10);

      const block = blocks.find((b) => day >= b.startDate && day <= b.endDate);
      const covering = bookings.filter((b) => day >= b.startDate && day <= b.endDate);

      const rented = covering.some((b) => RENTED_STATUSES.includes(b.status));
      const reserved = covering.some((b) => RESERVED_STATUSES.includes(b.status));

      const unitsTaken = covering.reduce(
        (sum, b) => sum + (b.equipmentDetail?.quantity ?? 1),
        0,
      );
      const blockedUnits = block ? (block.unitId ? 1 : unitsTotal) : 0;

      let state: AvailabilityDayResponse['state'] = 'AVAILABLE';
      if (rented) state = 'RENTED';
      else if (reserved) state = 'RESERVED';
      else if (block) state = 'BLOCKED';

      days.push({
        date: iso,
        state,
        unitsTotal,
        unitsAvailable: Math.max(unitsTotal - unitsTaken - blockedUnits, 0),
        blockId: block?.id ?? null,
      });
    }

    return days;
  }

  async blockDates(userId: string, listingId: string, dto: BlockDatesDto): Promise<void> {
    const listing = await this.requireOwnedListing(userId, listingId);

    const startDate = this.parseDate(dto.startDate, 'startDate');
    const endDate = this.parseDate(dto.endDate, 'endDate');
    if (endDate < startDate) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    if (dto.unitId && !listing.units.some((u) => u.id === dto.unitId)) {
      throw new NotFoundException('Unit not found on this listing');
    }

    // Blocking dates that are already committed would misrepresent availability to
    // Eskista, so refuse rather than silently overlapping.
    const conflicting = await this.prisma.booking.count({
      where: {
        listingId,
        status: { in: LIVE_STATUSES },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (conflicting > 0) {
      throw new ConflictException(
        'These dates include a confirmed booking and cannot be blocked',
      );
    }

    await this.prisma.blockedDateRange.create({
      data: { listingId, unitId: dto.unitId, startDate, endDate, reason: dto.reason },
    });
  }

  async unblockDates(userId: string, listingId: string, blockId: string): Promise<void> {
    await this.requireOwnedListing(userId, listingId);
    const block = await this.prisma.blockedDateRange.findFirst({
      where: { id: blockId, listingId },
    });
    if (!block) throw new NotFoundException('Blocked range not found');
    await this.prisma.blockedDateRange.delete({ where: { id: blockId } });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async requireVendorId(userId: string): Promise<string> {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!vendor) {
      throw new ForbiddenException('Complete vendor onboarding before managing equipment');
    }
    return vendor.id;
  }

  private async requireOwnedListing(userId: string, listingId: string): Promise<ListingDetail> {
    const vendorId = await this.requireVendorId(userId);
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: detailInclude,
    });
    if (!listing) throw new NotFoundException('Equipment not found');
    // 404 rather than 403: do not confirm that someone else's listing id exists.
    if (listing.vendorId !== vendorId) throw new NotFoundException('Equipment not found');
    return listing;
  }

  private assertEditable(status: ListingStatus): void {
    if (status === ListingStatus.ARCHIVED) {
      throw new ConflictException('Archived listings cannot be edited');
    }
    if (status === ListingStatus.SUSPENDED) {
      throw new ConflictException('Suspended listings cannot be edited; contact support');
    }
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || !category.isActive) {
      throw new BadRequestException('Unknown or inactive category');
    }
    if (category.kind !== 'EQUIPMENT') {
      throw new BadRequestException('That category belongs to the talent marketplace');
    }
  }

  /** Live bookings per listing, used to derive the Available/Booked chip. */
  private async liveBookingsFor(
    listingIds: string[],
  ): Promise<Map<string, { rented: boolean; nextDueDate: Date | null }>> {
    if (listingIds.length === 0) return new Map();

    const rows = await this.prisma.booking.findMany({
      where: { listingId: { in: listingIds }, status: { in: LIVE_STATUSES } },
      select: { listingId: true, endDate: true },
      orderBy: { endDate: 'asc' },
    });

    const map = new Map<string, { rented: boolean; nextDueDate: Date | null }>();
    for (const row of rows) {
      if (!row.listingId) continue;
      if (!map.has(row.listingId)) {
        map.set(row.listingId, { rented: true, nextDueDate: row.endDate });
      }
    }
    return map;
  }

  private outstandingRequirements(listing: ListingDetail): string[] {
    const missing: string[] = [];
    if (listing.images.length === 0) missing.push('Add at least one photo');
    if (listing.units.length === 0) missing.push('Add at least one physical unit');
    if (listing.rentalPriceMinor <= 0) missing.push('Set a rental price');
    if (!listing.description || listing.description.trim().length < 20) {
      missing.push('Write a description of at least 20 characters');
    }
    if (!listing.mainSpecification) missing.push('Add the main specification');
    return missing;
  }

  private toSummary(
    row: Prisma.ListingGetPayload<{ include: { category: true; images: true; units: true } }>,
    live: { rented: boolean; nextDueDate: Date | null } | undefined,
  ): EquipmentSummaryResponse {
    const primary = row.images.find((i) => i.isPrimary) ?? row.images[0];
    return {
      id: row.id,
      name: row.name,
      brand: row.brand,
      model: row.model,
      categoryName: row.category.name,
      primaryImageUrl: primary ? this.storage.urlFor(primary.fileKey) : null,
      status: row.status,
      rentalPriceMinor: row.rentalPriceMinor,
      rentalPeriodUnit: row.rentalPeriodUnit,
      currency: row.currency,
      unitCount: row.units.filter((u) => u.status !== UnitStatus.RETIRED).length,
      ratingAvg: Number(row.ratingAvg),
      ratingCount: row.ratingCount,
      isFeatured: row.isFeatured,
      availabilityLabel: live?.rented ? 'BOOKED' : 'AVAILABLE',
      nextDueDate: live?.nextDueDate ?? null,
      createdAt: row.createdAt,
    };
  }

  private toDetail(
    listing: ListingDetail,
    live: Map<string, { rented: boolean; nextDueDate: Date | null }>,
  ): EquipmentDetailResponse {
    const summary = this.toSummary(
      { ...listing, units: listing.units, images: listing.images, category: listing.category },
      live.get(listing.id),
    );
    const outstanding = this.outstandingRequirements(listing);

    return {
      ...summary,
      categoryId: listing.categoryId,
      description: listing.description,
      location: listing.location,
      mainSpecification: listing.mainSpecification,
      compatibility: listing.compatibility,
      powerBattery: listing.powerBattery,
      condition: listing.condition,
      conditionNotes: listing.conditionNotes,
      minRentalPeriods: listing.minRentalPeriods,
      maxRentalPeriods: listing.maxRentalPeriods,
      securityDepositMinor: listing.securityDepositMinor,
      replacementValueMinor: listing.replacementValueMinor,
      rentalRequirements: listing.rentalRequirements,
      rejectionReason: listing.rejectionReason,
      submittedAt: listing.submittedAt,
      publishedAt: listing.publishedAt,
      images: listing.images.map((i) => this.toImage(i)),
      specs: listing.specs.map((s) => ({
        group: s.group ?? undefined,
        label: s.label,
        value: s.value,
      })),
      includedItems: listing.includedItems.map((i) => ({
        kind: i.kind as IncludedItemKind,
        name: i.name,
        quantity: i.quantity,
      })),
      units: listing.units.map((u) => this.toUnit(u, 0)),
      accessories: listing.accessories.map((a) =>
        this.toSummary({ ...a.accessory, units: [] }, undefined),
      ),
      outstandingRequirements: outstanding,
      canSubmitForReview:
        outstanding.length === 0 &&
        (listing.status === ListingStatus.DRAFT || listing.status === ListingStatus.REJECTED),
    };
  }

  private toImage(image: {
    id: string;
    fileKey: string;
    altText: string | null;
    isPrimary: boolean;
    sortOrder: number;
  }): EquipmentImageResponse {
    return {
      id: image.id,
      url: this.storage.urlFor(image.fileKey),
      altText: image.altText,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    };
  }

  private toUnit(
    unit: {
      id: string;
      label: string | null;
      serialNumber: string | null;
      condition: ConditionGrade;
      conditionNotes: string | null;
      status: UnitStatus;
    },
    activeBookings: number,
  ): EquipmentUnitResponse {
    return {
      id: unit.id,
      label: unit.label,
      serialNumber: unit.serialNumber,
      condition: unit.condition,
      conditionNotes: unit.conditionNotes,
      status: unit.status,
      activeBookings,
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
