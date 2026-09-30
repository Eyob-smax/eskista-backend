import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  InspectionGrade,
  ListingStatus,
  Prisma,
  UnitStatus,
  type EquipmentUnit,
} from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import { customerUnitPrice } from '../../../common/money';
import type { UploadedFile } from '../../../common/upload';
import {
  CreateEquipmentDto,
  CreateUnitDto,
  UpdateEquipmentDto,
  UpdateUnitDto,
} from '../../equipment/dto/equipment.dto';
import { EquipmentService } from '../../equipment/equipment.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { HOLDS_UNIT } from '../bookings/admin-booking-ops.service';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise } from '../core/admin-format';
import { AdminInspectionsService } from '../inspections/admin-inspections.service';
import { GRADE_LABELS } from '../inspections/inspection-rules';
import {
  AdminListingsQuery,
  AdminUnitsQuery,
  EquipmentKpisResponse,
  ListingAdminRowResponse,
  UnitDetailResponse,
  UnitRowResponse,
  type UnitState,
} from './admin-catalog.dto';

const OUT_WITH_CLIENT: BookingStatus[] = [
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];
const BACK_IN_QA: BookingStatus[] = [BookingStatus.RETURN_RECEIVED, BookingStatus.INSPECTION];

const unitInclude = {
  listing: {
    select: {
      id: true,
      name: true,
      rentalPriceMinor: true,
      rentalPeriodUnit: true,
      commissionRateBps: true,
      categoryId: true,
      category: { select: { name: true } },
      vendor: { select: { id: true, businessName: true, commissionRateBps: true } },
      images: { where: { isPrimary: true }, take: 1 },
    },
  },
  bookingUnits: {
    where: { booking: { status: { in: HOLDS_UNIT } } },
    include: {
      booking: { select: { reference: true, status: true, startDate: true, endDate: true } },
    },
  },
} satisfies Prisma.EquipmentUnitInclude;

type UnitRow = Prisma.EquipmentUnitGetPayload<{ include: typeof unitInclude }>;

/**
 * Where a unit is right now, as the Equipment Management table shows it: out on a rental,
 * back and waiting for inspection, held for an upcoming one, in QA, retired, or free.
 */
export function unitState(
  unit: Pick<EquipmentUnit, 'status' | 'lastGrade'>,
  bookings: { status: BookingStatus }[],
): UnitState {
  if (unit.status === UnitStatus.RETIRED) return 'RETIRED';
  if (bookings.some((b) => OUT_WITH_CLIENT.includes(b.status))) return 'RENTED';
  if (bookings.some((b) => BACK_IN_QA.includes(b.status))) return 'RETURNED';
  if (unit.status === UnitStatus.MAINTENANCE || unit.lastGrade === InspectionGrade.DAMAGED)
    return 'IN_QA';
  if (bookings.length > 0) return 'RESERVED';
  return 'AVAILABLE';
}

const STATE_LABELS: Record<UnitState, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  RENTED: 'Rented',
  RETURNED: 'Returned',
  IN_QA: 'Needs Attention',
  RETIRED: 'Retired',
};

/**
 * Equipment Management: every physical unit across every vendor, the unit detail, and the
 * listings behind them. Listing changes go through the vendor's own EquipmentService as
 * that vendor, so an admin edit is held to exactly the vendor's rules.
 */
@Injectable()
export class AdminEquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly equipment: EquipmentService,
    private readonly inspections: AdminInspectionsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async kpis(): Promise<EquipmentKpisResponse> {
    const units = await this.prisma.equipmentUnit.findMany({
      where: {
        status: { not: UnitStatus.RETIRED },
        listing: { status: { not: ListingStatus.ARCHIVED } },
      },
      select: {
        status: true,
        lastGrade: true,
        bookingUnits: {
          where: { booking: { status: { in: HOLDS_UNIT } } },
          select: { booking: { select: { status: true } } },
        },
      },
    });
    const states = units.map((u) =>
      unitState(
        u,
        u.bookingUnits.map((b) => b.booking),
      ),
    );
    const count = (s: UnitState) => states.filter((x) => x === s).length;
    return {
      totalUnits: units.length,
      available: count('AVAILABLE') + count('RESERVED'),
      onRental: count('RENTED'),
      needsAttention: count('IN_QA') + count('RETURNED'),
    };
  }

  async units(query: AdminUnitsQuery): Promise<Paginated<UnitRowResponse>> {
    const q = query.q;
    const where: Prisma.EquipmentUnitWhereInput = {
      listing: {
        status: { not: ListingStatus.ARCHIVED },
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      },
      ...(q
        ? {
            OR: [
              { label: { contains: q, mode: 'insensitive' } },
              { serialNumber: { contains: q, mode: 'insensitive' } },
              { listing: { name: { contains: q, mode: 'insensitive' } } },
              { listing: { vendor: { businessName: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.equipmentUnit.findMany({
      where,
      include: unitInclude,
      orderBy: [{ listing: { name: 'asc' } }, { createdAt: 'asc' }],
    });
    const rates = await this.rates();
    // The state is derived, so it is filtered after reading. The table is one row per
    // physical unit, which stays in the low thousands.
    const shaped = rows
      .map((r) => this.toUnitRow(r, rates))
      .filter((r) => !query.state || r.state === query.state);
    return paginate(shaped.slice(query.skip, query.skip + query.limit), shaped.length, query);
  }

  /** Unit detail: Overview & Specs, Manual Inspection, Rental Bookings, Condition History. */
  async unit(unitId: string): Promise<UnitDetailResponse> {
    const unit = await this.prisma.equipmentUnit.findUnique({
      where: { id: unitId },
      include: unitInclude,
    });
    if (!unit) throw new NotFoundException('Unit not found');
    const listing = await this.prisma.listing.findUniqueOrThrow({
      where: { id: unit.listingId },
      include: {
        specs: { orderBy: { sortOrder: 'asc' } },
        includedItems: { orderBy: { sortOrder: 'asc' } },
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        vendor: { select: { id: true, businessName: true, phone: true, location: true } },
      },
    });
    const [history, upcoming, blocked, rates] = await Promise.all([
      this.inspections.unitHistory(unitId),
      this.prisma.bookingUnit.findMany({
        where: { unitId, booking: { status: { in: HOLDS_UNIT } } },
        include: {
          booking: {
            select: {
              reference: true,
              status: true,
              startDate: true,
              endDate: true,
              customer: { select: { name: true } },
            },
          },
        },
        orderBy: { booking: { startDate: 'asc' } },
      }),
      this.prisma.blockedDateRange.findMany({
        where: {
          OR: [{ unitId }, { listingId: unit.listingId, unitId: null }],
          endDate: { gte: new Date() },
        },
        orderBy: { startDate: 'asc' },
      }),
      this.rates(),
    ]);
    const row = this.toUnitRow(unit, rates);
    const active = upcoming.find(
      (u) => OUT_WITH_CLIENT.includes(u.booking.status) || BACK_IN_QA.includes(u.booking.status),
    );

    return {
      ...row,
      overview: {
        description: listing.description,
        brand: listing.brand,
        model: listing.model,
        mainSpecification: listing.mainSpecification,
        specs: listing.specs.map((s) => ({ group: s.group, label: s.label, value: s.value })),
        included: listing.includedItems.map((i) => ({
          kind: i.kind,
          name: i.name,
          quantity: i.quantity,
        })),
        media: listing.images.map((i) => ({
          id: i.id,
          url: this.storage.urlFor(i.fileKey),
          isPrimary: i.isPrimary,
        })),
        location: listing.location,
        securityDepositMinor: listing.securityDepositMinor,
        replacementValueMinor: listing.replacementValueMinor,
        listingStatus: listing.status,
        featureTier: listing.featureTier,
        vendor: listing.vendor,
        conditionNotes: unit.conditionNotes,
        acquiredAt: unit.acquiredAt?.toISOString() ?? null,
      },
      latestInspection: history[0] ?? null,
      rentals: {
        active: active
          ? {
              reference: active.booking.reference,
              status: active.booking.status,
              customer: active.booking.customer.name,
              startDate: active.booking.startDate.toISOString().slice(0, 10),
              endDate: active.booking.endDate.toISOString().slice(0, 10),
            }
          : null,
        // "Unit is currently in the Hub Vault" when nothing is out.
        message: active
          ? null
          : unit.custody === 'HUB'
            ? 'Unit is currently in the Hub Vault'
            : 'Unit is with the vendor',
        upcoming: upcoming
          .filter((u) => u !== active)
          .map((u) => ({
            reference: u.booking.reference,
            status: u.booking.status,
            customer: u.booking.customer.name,
            startDate: u.booking.startDate.toISOString().slice(0, 10),
            endDate: u.booking.endDate.toISOString().slice(0, 10),
          })),
        blocked: blocked.map((b) => ({
          startDate: b.startDate.toISOString().slice(0, 10),
          endDate: b.endDate.toISOString().slice(0, 10),
          reason: b.reason,
          wholeListing: b.unitId === null,
        })),
      },
      conditionHistory: history,
    };
  }

  /** Edit a unit: label, serial, condition notes, custody, or take it out of service. */
  async updateUnit(
    adminId: string,
    unitId: string,
    dto: UpdateUnitDto & { custody?: 'VENDOR' | 'HUB' | 'CLIENT' },
  ): Promise<UnitDetailResponse> {
    const unit = await this.prisma.equipmentUnit.findUnique({
      where: { id: unitId },
      include: { listing: { select: { vendor: { select: { userId: true } } } } },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    const { custody, ...rest } = dto;
    await this.equipment.updateUnit(unit.listing.vendor.userId, unit.listingId, unitId, rest);
    if (custody)
      await this.prisma.equipmentUnit.update({ where: { id: unitId }, data: { custody } });
    await this.audit.record(adminId, 'unit.update', 'EquipmentUnit', unitId, undefined, dto);
    return this.unit(unitId);
  }

  async addUnit(
    adminId: string,
    listingId: string,
    dto: CreateUnitDto,
  ): Promise<UnitDetailResponse> {
    const vendorUserId = await this.vendorUserFor(listingId);
    const created = await this.equipment.createUnit(vendorUserId, listingId, dto);
    await this.audit.record(adminId, 'unit.create', 'Listing', listingId, undefined, dto);
    return this.unit(created.id);
  }

  // ── Listings ───────────────────────────────────────────────────────────────

  async listings(query: AdminListingsQuery): Promise<Paginated<ListingAdminRowResponse>> {
    const q = query.q;
    const where: Prisma.ListingWhereInput = {
      ...(query.status ? { status: query.status } : { status: { not: ListingStatus.ARCHIVED } }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { brand: { contains: q, mode: 'insensitive' } },
              { vendor: { businessName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total, rates] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: {
          vendor: { select: { id: true, businessName: true, commissionRateBps: true } },
          category: { select: { name: true } },
          images: { where: { isPrimary: true }, take: 1 },
          _count: { select: { units: true, bookings: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.listing.count({ where }),
      this.rates(),
    ]);
    return paginate(
      rows.map((l) => ({
        id: l.id,
        name: l.name,
        imageUrl: l.images[0] ? this.storage.urlFor(l.images[0].fileKey) : null,
        vendor: { id: l.vendor.id, name: l.vendor.businessName },
        category: l.category.name,
        status: l.status,
        statusLabel: humanise(l.status),
        rentalPriceMinor: l.rentalPriceMinor,
        customerPriceMinor: customerUnitPrice(
          l.rentalPriceMinor,
          l.commissionRateBps ?? l.vendor.commissionRateBps ?? rates.commissionBps,
          rates.vatBps,
        ),
        periodUnit: l.rentalPeriodUnit,
        units: l._count.units,
        bookings: l._count.bookings,
        featureTier: l.featureTier,
        rating: Number(l.ratingAvg),
        updatedAt: l.updatedAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async listing(listingId: string) {
    return this.equipment.findOne(await this.vendorUserFor(listingId), listingId);
  }

  /** Add Equipment on a vendor's behalf. Created as a draft; submit and approve as usual. */
  async createListing(adminId: string, vendorId: string, dto: CreateEquipmentDto) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { userId: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const created = await this.equipment.create(vendor.userId, dto);
    await this.audit.record(adminId, 'listing.create', 'Listing', created.id, undefined, {
      vendorId,
    });
    return created;
  }

  async updateListing(adminId: string, listingId: string, dto: UpdateEquipmentDto) {
    const updated = await this.equipment.update(
      await this.vendorUserFor(listingId),
      listingId,
      dto,
    );
    await this.audit.record(adminId, 'listing.update', 'Listing', listingId, undefined, dto);
    return updated;
  }

  async addImage(adminId: string, listingId: string, file: UploadedFile) {
    const result = await this.equipment.addImage(
      await this.vendorUserFor(listingId),
      listingId,
      file,
    );
    await this.audit.record(adminId, 'listing.image.add', 'Listing', listingId);
    return result;
  }

  async submit(adminId: string, listingId: string) {
    const result = await this.equipment.submitForReview(
      await this.vendorUserFor(listingId),
      listingId,
    );
    await this.audit.record(adminId, 'listing.submit', 'Listing', listingId);
    return result;
  }

  /** Take a published listing off the catalogue, or put it back. */
  async setSuspended(adminId: string, listingId: string, suspended: boolean, reason?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { vendor: { select: { userId: true } } },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (suspended && listing.status !== ListingStatus.PUBLISHED) {
      throw new ConflictException('Only a published listing can be suspended');
    }
    if (!suspended && listing.status !== ListingStatus.SUSPENDED) {
      throw new ConflictException('This listing is not suspended');
    }
    await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: suspended ? ListingStatus.SUSPENDED : ListingStatus.PUBLISHED,
        rejectionReason: suspended ? (reason ?? null) : null,
        ...(suspended ? { isFeatured: false, featureTier: null } : {}),
      },
    });
    if (suspended) {
      await this.notifications.send(listing.vendor.userId, 'LISTING_REJECTED', {
        item: listing.name,
        reason: reason ?? 'It has been suspended by Eskista.',
      });
    }
    await this.audit.record(
      adminId,
      suspended ? 'listing.suspend' : 'listing.unsuspend',
      'Listing',
      listingId,
      undefined,
      undefined,
      reason,
    );
    return this.listing(listingId);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async vendorUserFor(listingId: string): Promise<string> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { vendor: { select: { userId: true } } },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing.vendor.userId;
  }

  private async rates(): Promise<{ commissionBps: number; vatBps: number }> {
    const [commissionBps, vatBps] = await Promise.all([
      this.settings.commissionBps(),
      this.settings.vatBps(),
    ]);
    return { commissionBps, vatBps };
  }

  private toUnitRow(u: UnitRow, rates: { commissionBps: number; vatBps: number }): UnitRowResponse {
    const state = unitState(
      u,
      u.bookingUnits.map((b) => b.booking),
    );
    const current = u.bookingUnits.find(
      (b) => OUT_WITH_CLIENT.includes(b.booking.status) || BACK_IN_QA.includes(b.booking.status),
    );
    const image = u.listing.images[0];
    return {
      id: u.id,
      label: u.label ?? `Unit ${u.id.slice(0, 4).toUpperCase()}`,
      serialNumber: u.serialNumber,
      listingId: u.listing.id,
      equipmentName: u.listing.name,
      imageUrl: image ? this.storage.urlFor(image.fileKey) : null,
      vendor: { id: u.listing.vendor.id, name: u.listing.vendor.businessName },
      category: u.listing.category.name,
      state,
      stateLabel: STATE_LABELS[state],
      unitStatus: u.status,
      custody: u.custody,
      grade: u.lastGrade,
      gradeLabel: u.lastGrade ? GRADE_LABELS[u.lastGrade] : null,
      lastInspectedAt: u.lastInspectedAt?.toISOString() ?? null,
      dailyRateMinor: u.listing.rentalPriceMinor,
      customerRateMinor: customerUnitPrice(
        u.listing.rentalPriceMinor,
        u.listing.commissionRateBps ?? u.listing.vendor.commissionRateBps ?? rates.commissionBps,
        rates.vatBps,
      ),
      periodUnit: u.listing.rentalPeriodUnit,
      currentBooking: current?.booking.reference ?? null,
    };
  }
}
