import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgreementStatus,
  AgreementType,
  BookingStatus,
  DocumentStatus,
  Prisma,
  SettlementStatus,
  UnitStatus,
  VendorKind,
  VerificationStatus,
} from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import { AgreementsService } from '../../agreements/agreements.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { toPayoutAccountResponse } from '../../payout-accounts/payout-accounts';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise, minorToDecimal, toCsv } from '../core/admin-format';
import {
  AdminVendorsQuery,
  VendorDetailResponse,
  VendorRowResponse,
  VerifyVendorDto,
} from './admin-users.dto';

const ACTIVE_RENTAL: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
];

const STATUS_LABELS: Record<VerificationStatus, string> = {
  DRAFT: 'Incomplete',
  PENDING_REVIEW: 'Pending',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

const rowInclude = {
  user: { select: { phone: true, image: true, isBlocked: true } },
  _count: {
    select: {
      bookings: { where: { status: { in: ACTIVE_RENTAL } } },
    },
  },
  listings: {
    select: { _count: { select: { units: { where: { status: { not: UnitStatus.RETIRED } } } } } },
  },
} satisfies Prisma.VendorProfileInclude;

type Row = Prisma.VendorProfileGetPayload<{ include: typeof rowInclude }>;

/** What must be in place before a vendor can be verified. */
export function vendorVerificationBlockers(v: {
  status: VerificationStatus;
  kind: VendorKind;
  documents: { type: string; status: DocumentStatus }[];
  agreementStatus: AgreementStatus | null;
}): string[] {
  const blockers: string[] = [];
  if (v.status !== VerificationStatus.PENDING_REVIEW && v.status !== VerificationStatus.REJECTED) {
    blockers.push(
      `The vendor is ${STATUS_LABELS[v.status].toLowerCase()}, not awaiting verification`,
    );
  }
  const live = v.documents.filter((d) => d.status !== DocumentStatus.REJECTED);
  const hasId = live.some((d) => d.type === 'FAYDA_ID' || d.type === 'PASSPORT');
  const hasBusiness = live.some(
    (d) => d.type === 'BUSINESS_REGISTRATION' || d.type === 'BUSINESS_LICENSE',
  );
  if (!hasId && v.kind === VendorKind.INDIVIDUAL) blockers.push('No ID document uploaded');
  if (!hasBusiness && v.kind === VendorKind.COMPANY)
    blockers.push('No business registration or license uploaded');
  if (
    v.agreementStatus !== AgreementStatus.UNDER_REVIEW &&
    v.agreementStatus !== AgreementStatus.APPROVED
  ) {
    blockers.push('The signed vendor agreement has not been uploaded');
  }
  return blockers;
}

/**
 * Vendor Accounts: every vendor, their standing with Eskista and their money — lifetime
 * earnings and what is still held for payout — and verifying or suspending them.
 */
@Injectable()
export class AdminVendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agreements: AgreementsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminVendorsQuery): Promise<Paginated<VendorRowResponse>> {
    const where = this.where(query);
    const [rows, total] = await Promise.all([
      this.prisma.vendorProfile.findMany({
        where,
        include: rowInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.vendorProfile.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toRow(r)),
      total,
      query,
    );
  }

  async detail(id: string): Promise<VendorDetailResponse> {
    const v = await this.prisma.vendorProfile.findUnique({
      where: { id },
      include: {
        ...rowInclude,
        documents: { orderBy: { createdAt: 'desc' } },
        agreements: { where: { kind: AgreementType.VENDOR_ONBOARDING } },
        payoutAccounts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        verifiedByAdmin: { select: { name: true } },
      },
    });
    if (!v) throw new NotFoundException('Vendor not found');

    const [paid, pending, listings, recent] = await Promise.all([
      this.prisma.settlement.aggregate({
        where: { vendorId: id, status: SettlementStatus.PAID },
        _sum: { netMinor: true },
        _count: true,
      }),
      this.prisma.settlement.aggregate({
        where: { vendorId: id, status: { not: SettlementStatus.PAID } },
        _sum: { netMinor: true },
      }),
      this.prisma.listing.groupBy({ by: ['status'], where: { vendorId: id }, _count: true }),
      this.prisma.booking.findMany({
        where: { vendorId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          reference: true,
          status: true,
          startDate: true,
          endDate: true,
          supplierEarningsMinor: true,
          listing: { select: { name: true } },
        },
      }),
    ]);
    const agreement = v.agreements[0] ?? null;

    return {
      ...this.toRow(v),
      kind: v.kind,
      vendorType: v.vendorType,
      email: v.email,
      about: v.about,
      rating: Number(v.ratingAvg),
      ratingCount: v.ratingCount,
      commissionRateBps: v.commissionRateBps,
      lifetimeEarningsMinor: paid._sum.netMinor ?? 0,
      paidBookings: paid._count,
      pendingSettlementMinor: pending._sum.netMinor ?? 0,
      payoutAccounts: v.payoutAccounts.map(toPayoutAccountResponse),
      primaryPayout: v.payoutAccounts[0] ? toPayoutAccountResponse(v.payoutAccounts[0]) : null,
      alternativePayout: v.payoutAccounts[1] ? toPayoutAccountResponse(v.payoutAccounts[1]) : null,
      documents: v.documents.map((d) => ({
        id: d.id,
        type: d.type,
        typeLabel: humanise(d.type),
        status: d.status,
        fileName: d.fileName,
        url: this.storage.urlFor(d.fileKey),
        uploadedAt: d.createdAt.toISOString(),
        rejectionReason: d.rejectionReason,
      })),
      agreement: agreement
        ? {
            id: agreement.id,
            status: agreement.status,
            documentUrl: agreement.documentKey
              ? `/api/v1/admin/agreements/${agreement.id}/pdf`
              : null,
            signedCopyUrl: agreement.scannedCopyKey
              ? this.storage.urlFor(agreement.scannedCopyKey)
              : null,
            uploadedAt: agreement.uploadedAt?.toISOString() ?? null,
          }
        : null,
      listingsByStatus: Object.fromEntries(listings.map((l) => [l.status, l._count])),
      recentBookings: recent.map((b) => ({
        reference: b.reference,
        itemName: b.listing?.name ?? null,
        status: b.status,
        startDate: b.startDate.toISOString().slice(0, 10),
        endDate: b.endDate.toISOString().slice(0, 10),
        earningsMinor: b.supplierEarningsMinor,
      })),
      verificationBlockers: vendorVerificationBlockers({
        status: v.status,
        kind: v.kind,
        documents: v.documents,
        agreementStatus: agreement?.status ?? null,
      }),
      verifiedAt: v.verifiedAt?.toISOString() ?? null,
      verifiedBy: v.verifiedByAdmin?.name ?? null,
      rejectionReason: v.rejectionReason,
      suspendedAt: v.suspendedAt?.toISOString() ?? null,
      suspendedReason: v.suspendedReason,
    };
  }

  /**
   * Verify: accepts the documents and the signed vendor agreement, and makes the vendor's
   * approved equipment visible on the catalogue.
   */
  async verify(adminId: string, id: string, dto: VerifyVendorDto): Promise<VendorDetailResponse> {
    const v = await this.prisma.vendorProfile.findUnique({
      where: { id },
      include: {
        documents: true,
        agreements: { where: { kind: AgreementType.VENDOR_ONBOARDING } },
      },
    });
    if (!v) throw new NotFoundException('Vendor not found');
    const agreement = v.agreements[0] ?? null;
    const blockers = vendorVerificationBlockers({
      status: v.status,
      kind: v.kind,
      documents: v.documents,
      agreementStatus: agreement?.status ?? null,
    });
    if (blockers.length > 0)
      throw new ConflictException({ message: 'This vendor cannot be verified yet', blockers });

    if (agreement?.status === AgreementStatus.UNDER_REVIEW)
      await this.agreements.approveScan(agreement.id, adminId);
    const now = new Date();
    await this.prisma.vendorProfile.update({
      where: { id },
      data: {
        status: VerificationStatus.VERIFIED,
        verifiedAt: now,
        verifiedByAdminId: adminId,
        rejectionReason: null,
        ...(dto.commissionRateBps !== undefined
          ? { commissionRateBps: dto.commissionRateBps }
          : {}),
        documents: {
          updateMany: {
            where: { status: DocumentStatus.PENDING },
            data: { status: DocumentStatus.VERIFIED, reviewedAt: now, reviewedById: adminId },
          },
        },
      },
    });
    await this.notifications.send(v.userId, 'VENDOR_VERIFIED');
    await this.audit.record(
      adminId,
      'vendor.verify',
      'VendorProfile',
      id,
      { status: v.status },
      dto,
      dto.note,
    );
    return this.detail(id);
  }

  async reject(adminId: string, id: string, reason: string): Promise<VendorDetailResponse> {
    const v = await this.require(id);
    if (v.status !== VerificationStatus.PENDING_REVIEW) {
      throw new ConflictException('Only a vendor awaiting verification can be rejected');
    }
    await this.prisma.vendorProfile.update({
      where: { id },
      data: {
        status: VerificationStatus.REJECTED,
        rejectionReason: reason,
        verifiedByAdminId: adminId,
      },
    });
    await this.notifications.send(v.userId, 'VENDOR_REJECTED', { reason });
    await this.audit.record(
      adminId,
      'vendor.reject',
      'VendorProfile',
      id,
      undefined,
      undefined,
      reason,
    );
    return this.detail(id);
  }

  /** Suspend: the vendor's gear leaves the catalogue. Their open rentals go on. */
  async suspend(adminId: string, id: string, reason: string): Promise<VendorDetailResponse> {
    const v = await this.require(id);
    if (v.status === VerificationStatus.SUSPENDED) return this.detail(id);
    await this.prisma.vendorProfile.update({
      where: { id },
      data: {
        status: VerificationStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedReason: reason,
      },
    });
    await this.notifications.send(v.userId, 'VENDOR_SUSPENDED', { reason });
    await this.audit.record(
      adminId,
      'vendor.suspend',
      'VendorProfile',
      id,
      { status: v.status },
      undefined,
      reason,
    );
    return this.detail(id);
  }

  async reactivate(adminId: string, id: string): Promise<VendorDetailResponse> {
    const v = await this.require(id);
    if (v.status !== VerificationStatus.SUSPENDED)
      throw new ConflictException('This vendor is not suspended');
    await this.prisma.vendorProfile.update({
      where: { id },
      data: {
        status: v.verifiedAt ? VerificationStatus.VERIFIED : VerificationStatus.PENDING_REVIEW,
        suspendedAt: null,
        suspendedReason: null,
      },
    });
    await this.audit.record(adminId, 'vendor.reactivate', 'VendorProfile', id);
    return this.detail(id);
  }

  async exportCsv(query: AdminVendorsQuery): Promise<string> {
    const rows = await this.prisma.vendorProfile.findMany({
      where: this.where(query),
      include: rowInclude,
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    const earnings = await this.prisma.settlement.groupBy({
      by: ['vendorId'],
      where: { vendorId: { in: rows.map((r) => r.id) }, status: SettlementStatus.PAID },
      _sum: { netMinor: true },
    });
    const byVendor = new Map(earnings.map((e) => [e.vendorId, e._sum.netMinor ?? 0]));
    return toCsv(
      [
        'Vendor',
        'Joined',
        'Location',
        'Representative',
        'Phone',
        'Email',
        'Units',
        'Active rentals',
        'Status',
        'Lifetime earnings (ETB)',
      ],
      rows.map((r) => {
        const row = this.toRow(r);
        return [
          r.businessName,
          r.createdAt.toISOString().slice(0, 10),
          r.location,
          r.contactName,
          row.phone,
          r.email,
          row.inventoryUnits,
          row.activeRentals,
          row.statusLabel,
          minorToDecimal(byVendor.get(r.id) ?? 0),
        ];
      }),
    );
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private where(query: AdminVendorsQuery): Prisma.VendorProfileWhereInput {
    const q = query.q;
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.location ? { location: { contains: query.location, mode: 'insensitive' } } : {}),
      ...(q
        ? {
            OR: [
              { businessName: { contains: q, mode: 'insensitive' } },
              { contactName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };
  }

  private async require(id: string) {
    const v = await this.prisma.vendorProfile.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  private toRow(v: Row): VendorRowResponse {
    return {
      id: v.id,
      businessName: v.businessName,
      logoUrl: v.logoKey ? this.storage.urlFor(v.logoKey) : null,
      joinedAt: v.createdAt.toISOString(),
      location: v.location,
      representative: v.contactName,
      phone: v.phone ?? v.user.phone,
      inventoryUnits: v.listings.reduce((sum, l) => sum + l._count.units, 0),
      activeRentals: v._count.bookings,
      status: v.status,
      statusLabel: STATUS_LABELS[v.status],
      accountBlocked: v.user.isBlocked,
    };
  }
}
