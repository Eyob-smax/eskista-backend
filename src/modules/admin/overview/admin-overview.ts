import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AgreementStatus,
  BookingStatus,
  BookingType,
  IncidentStatus,
  PaymentStatus,
  SettlementStatus,
  SupplierResponse,
  VerificationStatus,
  ListingStatus,
} from '@prisma/client';
import { CurrentUser } from '../../auth/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAccess } from '../core/admin-access';
import { greeting, trendPercent } from '../core/admin-format';
import { AdminBookingsService } from '../bookings/admin-bookings.service';
import { AdminBookingsQuery } from '../bookings/dto/admin-bookings.dto';
import { AdminOverviewResponse } from './admin-overview.dto';

const HOUR = 3_600_000;
const PRE_APPROVAL = [BookingStatus.REQUEST_SUBMITTED, BookingStatus.ESKISTA_REVIEW];
const ACTIVE = [
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];

/**
 * The Overview: "Good Morning, Abel", the four tiles, Attention Required and Recent
 * Bookings — plus every sidebar badge, so the dashboard shell needs one call.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: AdminBookingsService,
  ) {}

  async overview(adminId: string): Promise<AdminOverviewResponse> {
    const now = Date.now();
    const since = (hours: number) => new Date(now - hours * HOUR);

    const [
      admin,
      pendingRequests,
      newLast2h,
      requestsToday,
      requestsYesterday,
      awaitingPayment,
      paymentGroups,
      activeRentals,
      readyToApprove,
      agreementsToReview,
      overduePayouts,
      openIncidents,
      pendingTalent,
      pendingVendors,
      pendingListings,
      recent,
      badges,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { name: true } }),
      this.prisma.booking.count({ where: { status: { in: PRE_APPROVAL } } }),
      this.prisma.booking.count({
        where: { status: { in: PRE_APPROVAL }, createdAt: { gte: since(2) } },
      }),
      this.prisma.booking.count({
        where: { status: { not: BookingStatus.DRAFT }, createdAt: { gte: since(24) } },
      }),
      this.prisma.booking.count({
        where: {
          status: { not: BookingStatus.DRAFT },
          createdAt: { gte: since(48), lt: since(24) },
        },
      }),
      this.prisma.booking.count({ where: { status: BookingStatus.AWAITING_PAYMENT } }),
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.SUBMITTED },
        select: {
          reference: true,
          amountMinor: true,
          declaredTotalMinor: true,
          submittedAt: true,
          booking: { select: { reference: true, customer: { select: { name: true } } } },
        },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.booking.count({ where: { type: BookingType.EQUIPMENT, status: { in: ACTIVE } } }),
      this.prisma.booking.findMany({
        where: {
          type: BookingType.EQUIPMENT,
          status: { in: PRE_APPROVAL },
          supplierResponse: SupplierResponse.ACCEPTED,
        },
        select: {
          reference: true,
          createdAt: true,
          listing: { select: { name: true } },
          customer: { select: { name: true } },
        },
        orderBy: { supplierRespondedAt: 'asc' },
        take: 5,
      }),
      this.prisma.agreement.count({ where: { status: AgreementStatus.UNDER_REVIEW } }),
      this.prisma.settlement.count({
        where: {
          status: { in: [SettlementStatus.PENDING, SettlementStatus.IN_BATCH] },
          expectedAt: { lt: new Date() },
        },
      }),
      this.prisma.incident.count({
        where: { status: { in: [IncidentStatus.REPORTED, IncidentStatus.UNDER_REVIEW] } },
      }),
      this.prisma.talentProfile.count({ where: { status: VerificationStatus.PENDING_REVIEW } }),
      this.prisma.vendorProfile.count({ where: { status: VerificationStatus.PENDING_REVIEW } }),
      this.prisma.listing.count({ where: { status: ListingStatus.PENDING_REVIEW } }),
      this.bookings.list(
        Object.assign(new AdminBookingsQuery(), { page: 1, limit: 8, view: 'all' as const }),
      ),
      this.bookings.counts(),
    ]);

    // One card per transfer: the per-booking rows of a combined payment share a reference.
    const byRef = new Map<string, (typeof paymentGroups)[number]>();
    for (const p of paymentGroups)
      if (p.reference && !byRef.has(p.reference)) byRef.set(p.reference, p);
    const payments = [...byRef.values()];
    const first = admin.name.split(' ')[0] ?? admin.name;

    return {
      greeting: `${greeting()}, ${first}`,
      tiles: {
        pendingBookingRequests: {
          count: pendingRequests,
          newInLast2Hours: newLast2h,
          trendPercent: trendPercent(requestsToday, requestsYesterday),
        },
        awaitingPaymentConfirmation: { count: awaitingPayment, note: 'Quotations sent' },
        paymentsToVerify: { count: payments.length, note: 'Slips uploaded' },
        activeRentals: { count: activeRentals, note: 'Gear out on field' },
      },
      attentionRequired: [
        ...payments.slice(0, 5).map((p) => ({
          kind: 'PAYMENT_VERIFICATION',
          title: 'Payment Verification',
          detail: `${p.booking.customer.name} uploaded a slip for ${p.booking.reference}`,
          reference: p.reference!,
          bookingReference: p.booking.reference,
          amountMinor: p.declaredTotalMinor ?? p.amountMinor,
          at: p.submittedAt.toISOString(),
          action: { label: 'Verify Payment', href: `/admin/payments/${p.reference}` },
        })),
        ...readyToApprove.map((b) => ({
          kind: 'BOOKING_APPROVAL',
          title: 'Booking Awaiting Approval',
          detail: `${b.customer.name} · ${b.listing?.name ?? 'Equipment'}`,
          reference: b.reference,
          bookingReference: b.reference,
          at: b.createdAt.toISOString(),
          action: { label: 'Review Request', href: `/admin/bookings/${b.reference}` },
        })),
      ],
      queues: {
        agreementsToReview,
        overduePayouts,
        openIncidents,
        pendingTalentVerifications: pendingTalent,
        pendingVendorVerifications: pendingVendors,
        pendingListingReviews: pendingListings,
      },
      recentBookings: recent.data,
      badges: {
        ...badges,
        paymentVerification: payments.length,
        issues: openIncidents,
        agreements: agreementsToReview,
        talentVerification: pendingTalent,
        vendorVerification: pendingVendors,
        listingReview: pendingListings,
      },
    };
  }
}

@ApiTags('admin · overview')
@AdminAccess()
@Controller({ path: 'admin/overview', version: '1' })
export class AdminOverviewController {
  constructor(private readonly overview: AdminOverviewService) {}

  @Get()
  @ApiOperation({
    summary: 'Overview',
    description:
      'Greeting, the four tiles, Attention Required, Recent Bookings, and every sidebar badge.',
  })
  @ApiOkResponse({ type: AdminOverviewResponse })
  get(@CurrentUser('id') adminId: string): Promise<AdminOverviewResponse> {
    return this.overview.overview(adminId);
  }
}
