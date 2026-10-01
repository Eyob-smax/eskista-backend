import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, PaymentStatus, Prisma, Role, VerificationStatus } from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise, minorToDecimal, toCsv } from '../core/admin-format';
import {
  AdminCustomersQuery,
  CustomerDetailResponse,
  CustomerRowResponse,
} from './admin-users.dto';

const OPEN: BookingStatus[] = [
  BookingStatus.REQUEST_SUBMITTED,
  BookingStatus.ESKISTA_REVIEW,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
  BookingStatus.SETTLEMENT,
];

const rowInclude = {
  customer: true,
  _count: { select: { bookings: { where: { status: { not: BookingStatus.DRAFT } } } } },
} satisfies Prisma.UserInclude;

type Row = Prisma.UserGetPayload<{ include: typeof rowInclude }>;

/**
 * Customer Accounts. Anyone who books — companies and individuals — with their bookings,
 * their optional "Verified customer" document, and suspension.
 */
@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminCustomersQuery): Promise<Paginated<CustomerRowResponse>> {
    const where = this.where(query);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: rowInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toRow(r)),
      total,
      query,
    );
  }

  async detail(id: string): Promise<CustomerDetailResponse> {
    const u = await this.prisma.user.findFirst({
      where: { id, roles: { some: { role: Role.CUSTOMER } } },
      include: {
        ...rowInclude,
        customer: { include: { verifiedByAdmin: { select: { name: true } } } },
      },
    });
    if (!u) throw new NotFoundException('Customer not found');
    const [open, spend, recent, incidents] = await Promise.all([
      this.prisma.booking.findMany({
        where: { customerId: id, status: { in: OPEN } },
        orderBy: { startDate: 'asc' },
        select: {
          reference: true,
          type: true,
          status: true,
          startDate: true,
          endDate: true,
          totalMinor: true,
          listing: { select: { name: true } },
          talentProfile: { select: { displayName: true } },
        },
      }),
      this.prisma.payment.aggregate({
        where: { booking: { customerId: id }, status: PaymentStatus.VERIFIED },
        _sum: { amountMinor: true },
      }),
      this.prisma.booking.findMany({
        where: { customerId: id, status: { notIn: [...OPEN, BookingStatus.DRAFT] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          reference: true,
          status: true,
          startDate: true,
          listing: { select: { name: true } },
          talentProfile: { select: { displayName: true } },
        },
      }),
      this.prisma.incident.count({ where: { booking: { customerId: id } } }),
    ]);
    const p = u.customer;
    return {
      ...this.toRow(u),
      kind: p?.kind ?? 'INDIVIDUAL',
      additionalPhone: p?.additionalPhone ?? u.additionalPhone,
      address: p?.address ?? null,
      tinNumber: u.tinNumber,
      vatExempt: u.vatExempt,
      telegramUsername: u.telegramUsername,
      document: p?.documentKey
        ? {
            type: p.documentType,
            typeLabel: p.documentType ? humanise(p.documentType) : null,
            fileName: p.documentName,
            url: this.storage.urlFor(p.documentKey),
            uploadedAt: p.documentUploadedAt?.toISOString() ?? null,
          }
        : null,
      verifiedAt: p?.verifiedAt?.toISOString() ?? null,
      verifiedBy: p?.verifiedByAdmin?.name ?? null,
      verificationRejection: p?.rejectionReason ?? null,
      totalSpendMinor: spend._sum.amountMinor ?? 0,
      completedBookings: p?.completedBookings ?? 0,
      incidents,
      activeBookings: open.map((b) => ({
        reference: b.reference,
        type: b.type,
        itemName: b.listing?.name ?? b.talentProfile?.displayName ?? 'Talent request',
        status: b.status,
        statusLabel: humanise(b.status),
        startDate: b.startDate.toISOString().slice(0, 10),
        endDate: b.endDate.toISOString().slice(0, 10),
        totalMinor: b.totalMinor,
      })),
      pastBookings: recent.map((b) => ({
        reference: b.reference,
        itemName: b.listing?.name ?? b.talentProfile?.displayName ?? 'Talent request',
        status: b.status,
        startDate: b.startDate.toISOString().slice(0, 10),
      })),
      blockedAt: u.blockedAt?.toISOString() ?? null,
      blockedReason: u.blockedReason,
    };
  }

  /** The "Verified customer" badge, from the uploaded business document. */
  async verify(adminId: string, id: string): Promise<CustomerDetailResponse> {
    const p = await this.profile(id);
    if (!p.documentKey) throw new ConflictException('The customer has not uploaded a document');
    await this.prisma.customerProfile.update({
      where: { id: p.id },
      data: {
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedAt: new Date(),
        verifiedByAdminId: adminId,
        rejectionReason: null,
      },
    });
    await this.audit.record(adminId, 'customer.verify', 'CustomerProfile', p.id);
    return this.detail(id);
  }

  async rejectVerification(
    adminId: string,
    id: string,
    reason: string,
  ): Promise<CustomerDetailResponse> {
    const p = await this.profile(id);
    await this.prisma.customerProfile.update({
      where: { id: p.id },
      data: {
        verificationStatus: VerificationStatus.REJECTED,
        rejectionReason: reason,
        verifiedByAdminId: adminId,
      },
    });
    await this.audit.record(
      adminId,
      'customer.verification.reject',
      'CustomerProfile',
      p.id,
      undefined,
      undefined,
      reason,
    );
    return this.detail(id);
  }

  /** Suspend User: blocks sign-in everywhere — the whole account, every role. */
  async suspend(adminId: string, id: string, reason: string): Promise<CustomerDetailResponse> {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (!u) throw new NotFoundException('Customer not found');
    if (u.roles.some((r) => r.role === Role.ADMIN)) {
      throw new ConflictException('Admins are suspended from the admin team screen');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isBlocked: true, blockedAt: new Date(), blockedReason: reason },
      }),
      this.prisma.session.deleteMany({ where: { userId: id } }),
    ]);
    await this.notifications.send(id, 'ACCOUNT_SUSPENDED', { reason });
    await this.audit.record(adminId, 'user.suspend', 'User', id, undefined, undefined, reason);
    return this.detail(id);
  }

  async reactivate(adminId: string, id: string): Promise<CustomerDetailResponse> {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (!u) throw new NotFoundException('Customer not found');
    if (u.roles.some((r) => r.role === Role.ADMIN)) {
      throw new ConflictException('Admins are reactivated from the admin team screen');
    }
    await this.prisma.user.update({
      where: { id },
      data: { isBlocked: false, blockedAt: null, blockedReason: null },
    });
    await this.audit.record(adminId, 'user.reactivate', 'User', id);
    return this.detail(id);
  }

  async exportCsv(query: AdminCustomersQuery): Promise<string> {
    const rows = await this.prisma.user.findMany({
      where: this.where(query),
      include: rowInclude,
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    const spend = await this.prisma.payment.groupBy({
      by: ['bookingId'],
      where: {
        status: PaymentStatus.VERIFIED,
        booking: { customerId: { in: rows.map((r) => r.id) } },
      },
      _sum: { amountMinor: true },
    });
    const bookings = await this.prisma.booking.findMany({
      where: { id: { in: spend.map((s) => s.bookingId) } },
      select: { id: true, customerId: true },
    });
    const owner = new Map(bookings.map((b) => [b.id, b.customerId]));
    const byCustomer = new Map<string, number>();
    for (const s of spend) {
      const c = owner.get(s.bookingId);
      if (c) byCustomer.set(c, (byCustomer.get(c) ?? 0) + (s._sum.amountMinor ?? 0));
    }
    return toCsv(
      [
        'Name',
        'Organisation',
        'Location',
        'Phone',
        'Email',
        'Bookings',
        'Verified',
        'Status',
        'Spend (ETB)',
        'Joined',
      ],
      rows.map((u) => {
        const r = this.toRow(u);
        return [
          r.name,
          r.organisation,
          r.location,
          r.phone,
          r.email,
          r.bookings,
          r.verificationLabel,
          r.statusLabel,
          minorToDecimal(byCustomer.get(u.id) ?? 0),
          u.createdAt.toISOString().slice(0, 10),
        ];
      }),
    );
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private where(query: AdminCustomersQuery): Prisma.UserWhereInput {
    const q = query.q;
    return {
      roles: { some: { role: Role.CUSTOMER } },
      // Customers who have not set anything up yet still count, but admins do not.
      NOT: { roles: { some: { role: Role.ADMIN } } },
      ...(query.status ? { isBlocked: query.status === 'SUSPENDED' } : {}),
      ...(query.verification || query.kind
        ? {
            customer: {
              ...(query.verification ? { verificationStatus: query.verification } : {}),
              ...(query.kind ? { kind: query.kind } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { customer: { organisationName: { contains: q, mode: 'insensitive' } } },
              { customer: { contactPerson: { contains: q, mode: 'insensitive' } } },
              { customer: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private async profile(userId: string) {
    const p = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('This customer has no profile yet');
    return p;
  }

  private toRow(u: Row): CustomerRowResponse {
    const p = u.customer;
    const verification = p?.verificationStatus ?? VerificationStatus.DRAFT;
    return {
      id: u.id,
      name: p?.contactPerson ?? u.name,
      organisation: p?.organisationName ?? null,
      avatarUrl: u.image,
      location: p?.city ?? null,
      phone: p?.phone ?? u.phone,
      email: p?.email ?? (u.email.endsWith('.invalid') ? null : u.email),
      bookings: u._count.bookings,
      verification,
      verificationLabel:
        verification === VerificationStatus.VERIFIED
          ? 'Verified'
          : verification === VerificationStatus.PENDING_REVIEW
            ? 'Pending'
            : 'Unverified',
      status: u.isBlocked ? 'SUSPENDED' : 'ACTIVE',
      statusLabel: u.isBlocked ? 'Suspended' : 'Active',
      joinedAt: u.createdAt.toISOString(),
    };
  }
}
