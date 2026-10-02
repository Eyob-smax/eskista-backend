import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgreementStatus,
  BookingStatus,
  BookingType,
  DeliveryStage,
  FulfilmentDirection,
  InspectionKind,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  SettlementStatus,
  SupplierResponse,
  type Fulfilment,
} from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { settlementDisplayStatus } from '../../settlements/settlement-math';
import { AdminAgreementsService } from '../agreements/admin-agreements';
import { humanise } from '../core/admin-format';
import { buildAdminActions, buildAdminTimeline, type AdminFlowState } from '../core/booking-flow';
import { AdminInspectionsService } from '../inspections/admin-inspections.service';
import { AdminPaymentsService } from '../payments/admin-payments.service';
import {
  AdminBookingDetailResponse,
  BookingCountsResponse,
  BookingDocumentResponse,
} from './dto/admin-booking-detail.dto';
import {
  AdminBookingRowResponse,
  AdminBookingsQuery,
  LegResponse,
  type BookingView,
} from './dto/admin-bookings.dto';

const VIEW_STATUSES: Record<Exclude<BookingView, 'all'>, BookingStatus[]> = {
  requests: [
    BookingStatus.REQUEST_SUBMITTED,
    BookingStatus.ESKISTA_REVIEW,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.BOOKING_CONFIRMED,
  ],
  active: [
    BookingStatus.DELIVERY_PICKUP,
    BookingStatus.IN_PROGRESS,
    BookingStatus.RENTAL_COMPLETED,
    BookingStatus.RETURN_SCHEDULED,
    BookingStatus.RETURN_RECEIVED,
    BookingStatus.INSPECTION,
  ],
  deliveries: [
    BookingStatus.BOOKING_CONFIRMED,
    BookingStatus.DELIVERY_PICKUP,
    BookingStatus.RENTAL_COMPLETED,
    BookingStatus.RETURN_SCHEDULED,
  ],
  completed: [
    BookingStatus.SETTLEMENT,
    BookingStatus.CLOSED,
    BookingStatus.REJECTED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
};

const STATUS_LABELS: Partial<Record<BookingStatus, string>> = {
  REQUEST_SUBMITTED: 'New Request',
  ESKISTA_REVIEW: 'Pending Confirmation',
  DELIVERY_PICKUP: 'Out for Delivery',
  IN_PROGRESS: 'Rental Active',
  RETURN_RECEIVED: 'Returned to Hub',
};

const STAGE_LABELS: Record<FulfilmentDirection, Record<DeliveryStage, string>> = {
  OUTBOUND: {
    PREPARED: 'Packing Gear',
    PICKED_UP: 'Picked Up',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Handover Complete',
  },
  RETURN: {
    PREPARED: 'Scheduled',
    PICKED_UP: 'Collected',
    OUT_FOR_DELIVERY: 'On the Way to Hub',
    DELIVERED: 'Returned to Hub',
  },
};

const METHOD_LABELS: Record<string, string> = {
  DELIVERY: 'Courier Dispatch',
  PICKUP: 'Studio Pickup',
  SCHEDULED_PICKUP: 'Eskista Collects',
  DROP_OFF: 'Customer Drop-off',
};

const rowInclude = {
  // What the customer actually owes: a VAT-exempt invoice is smaller than the booking total.
  invoiceLines: {
    where: { invoice: { status: { not: InvoiceStatus.VOID } } },
    select: { totalMinor: true, securityDepositMinor: true },
    take: 1,
  },
  customer: { include: { customer: true } },
  listing: { select: { name: true, images: { where: { isPrimary: true }, take: 1 } } },
  vendor: { select: { id: true, businessName: true } },
  talentProfile: { select: { id: true, displayName: true, avatarKey: true } },
  assignedUnits: { include: { unit: { select: { label: true, serialNumber: true } } } },
  fulfilments: true,
  payments: { select: { status: true, amountMinor: true } },
  handover: true,
  inspections: { select: { kind: true, grade: true } },
  settlement: { select: { status: true } },
  agreements: { select: { status: true, counterpartyId: true } },
  equipmentDetail: true,
} satisfies Prisma.BookingInclude;

type RowBooking = Prisma.BookingGetPayload<{ include: typeof rowInclude }>;

const detailInclude = {
  ...rowInclude,
  talentDetail: true,
  talentProfile: {
    select: {
      id: true,
      userId: true,
      displayName: true,
      avatarKey: true,
      phone: true,
      email: true,
      professions: true,
      payoutAccounts: { orderBy: { isPrimary: 'desc' } },
    },
  },
  vendor: {
    select: {
      id: true,
      userId: true,
      businessName: true,
      contactName: true,
      phone: true,
      email: true,
      location: true,
      payoutAccounts: { orderBy: { isPrimary: 'desc' } },
    },
  },
  assignedUnits: { include: { unit: true } },
  handover: { include: { photos: true } },
  settlement: {
    include: { adjustments: { orderBy: { createdAt: 'asc' } }, paidBy: { select: { name: true } } },
  },
  invoiceLines: {
    where: { invoice: { status: { not: InvoiceStatus.VOID } } },
    include: { invoice: { select: { number: true, combined: true, status: true } } },
  },
  statusEvents: { orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true } } } },
  incidents: { orderBy: { createdAt: 'desc' } },
  attachments: true,
  invitations: {
    include: { talentProfile: { select: { id: true, displayName: true } } },
    orderBy: { invitedAt: 'asc' },
  },
  approvedBy: { select: { name: true } },
} satisfies Prisma.BookingInclude;

type DetailBooking = Prisma.BookingGetPayload<{ include: typeof detailInclude }>;

/**
 * What the admin booking screens read: the tables, the sidebar counts, and the Booking
 * Detail with its Overview, Delivery & Inspection, Settlement and Documents tabs.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: AdminPaymentsService,
    private readonly inspections: AdminInspectionsService,
    private readonly agreements: AdminAgreementsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminBookingsQuery): Promise<Paginated<AdminBookingRowResponse>> {
    const where = this.where(query);
    const direction = query.sortOrder ?? 'desc';
    const orderBy: Prisma.BookingOrderByWithRelationInput =
      query.sortBy === 'startDate'
        ? { startDate: direction }
        : query.sortBy === 'amount'
          ? { totalMinor: direction }
          : { createdAt: direction };
    const [rows, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: rowInclude,
        orderBy: [orderBy, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toRow(r)),
      total,
      query,
    );
  }

  async detail(reference: string): Promise<AdminBookingDetailResponse> {
    const b = await this.prisma.booking.findUnique({
      where: { reference },
      include: detailInclude,
    });
    if (!b) throw new NotFoundException('Booking not found');

    const summary = this.toRow(b);
    const state = this.flowState(b);
    const outbound =
      b.fulfilments.find((f) => f.direction === FulfilmentDirection.OUTBOUND) ?? null;
    const ret = b.fulfilments.find((f) => f.direction === FulfilmentDirection.RETURN) ?? null;
    const returnInspection = b.inspections.find((i) => i.kind === InspectionKind.RETURN);

    const [inspections, agreements, paymentRows] = await Promise.all([
      this.inspections.forBooking(b.id),
      this.agreements.forBooking(b.id),
      this.payments.forBooking(b.id),
    ]);
    const verified = b.payments
      .filter((p) => p.status === PaymentStatus.VERIFIED)
      .reduce((sum, p) => sum + p.amountMinor, 0);
    const line = b.invoiceLines[0];
    const due = line
      ? line.totalMinor + line.securityDepositMinor
      : b.totalMinor + b.securityDepositMinor;
    const releasedMinor =
      inspections.find((i) => i.kind === InspectionKind.RETURN)?.depositReturnedMinor ?? null;

    const actions = buildAdminActions({
      ...state,
      supplierAccepted: b.supplierResponse === SupplierResponse.ACCEPTED,
      supplierDeclined: b.supplierResponse === SupplierResponse.DECLINED,
      agreementUnderReview: b.agreements.some((a) => a.status === AgreementStatus.UNDER_REVIEW),
      paymentPending: b.payments.some((p) => p.status === PaymentStatus.SUBMITTED),
      unitAssigned: b.assignedUnits.length > 0,
      outboundStage: outbound?.stage ?? null,
      depositRefundDue:
        b.securityDepositMinor > 0 && returnInspection !== undefined && !b.depositRefundedAt,
      outgoingDamaged: b.inspections.some(
        (i) => i.kind === InspectionKind.OUTGOING && i.grade === 'DAMAGED',
      ),
      settlementExists: b.settlement !== null,
      returnedToVendor: Boolean(b.handover?.returnedToVendorAt),
    });

    const s = b.settlement;
    const supplierAccount = (b.vendor?.payoutAccounts ?? b.talentProfile?.payoutAccounts ?? [])[0];

    return {
      summary,
      timeline: buildAdminTimeline(state),
      actions,
      overview: {
        purpose: b.projectDescription,
        projectType: b.projectType,
        contactPhone: b.contactPhone,
        additionalPhone: b.additionalPhone,
        customer: {
          ...summary.customer,
          kind: b.customer.customer?.kind ?? 'INDIVIDUAL',
          city: b.customer.customer?.city ?? null,
          address: b.customer.customer?.address ?? null,
          verified: b.customer.customer?.verificationStatus === 'VERIFIED',
          idDocumentOnFile: Boolean(b.customer.customer?.documentKey),
          idDocumentUrl: b.customer.customer?.documentKey
            ? this.storage.urlFor(b.customer.customer.documentKey)
            : null,
        },
        units: b.assignedUnits.map((u) => ({
          id: u.unit.id,
          label: u.unit.label,
          serialNumber: u.unit.serialNumber,
          custody: u.unit.custody,
          grade: u.unit.lastGrade,
          lastInspectedAt: u.unit.lastInspectedAt?.toISOString() ?? null,
          status: u.unit.status,
        })),
        delivery: {
          collectionMethod: b.equipmentDetail?.collectionMethod ?? null,
          address: b.equipmentDetail?.deliveryAddress ?? null,
          notes: b.equipmentDetail?.deliveryNotes ?? null,
          quantity: b.equipmentDetail?.quantity ?? null,
          dueAt: b.dueAt?.toISOString() ?? null,
        },
        talent: b.talentProfile
          ? {
              id: b.talentProfile.id,
              name: b.talentProfile.displayName,
              role: b.talentProfile.professions[0] ?? null,
              phone: b.talentProfile.phone,
              email: b.talentProfile.email,
              avatarUrl: b.talentProfile.avatarKey
                ? this.storage.urlFor(b.talentProfile.avatarKey)
                : null,
              earningsMinor: b.supplierEarningsMinor,
            }
          : null,
        engagement: b.talentDetail
          ? {
              location: b.talentDetail.eventLocation,
              venue: b.talentDetail.venue,
              city: b.talentDetail.city,
              startTime: b.talentDetail.startTime,
              endTime: b.talentDetail.endTime,
              engagementModel: b.talentDetail.engagementModel,
              headcount: b.talentDetail.headcount,
              requirements: b.talentDetail.requirements,
              budgetBand: b.talentDetail.budgetBand,
              budgetMinor: b.talentDetail.budgetMinor,
            }
          : null,
        invitations: b.invitations.map((i) => ({
          id: i.id,
          talentProfileId: i.talentProfile.id,
          talentName: i.talentProfile.displayName,
          status: i.status,
          invitedAt: i.invitedAt.toISOString(),
          respondedAt: i.respondedAt?.toISOString() ?? null,
          expiresAt: i.expiresAt.toISOString(),
          declineReason: i.declineReason,
        })),
        vendor: b.vendor
          ? {
              id: b.vendor.id,
              businessName: b.vendor.businessName,
              contactName: b.vendor.contactName,
              phone: b.vendor.phone,
              email: b.vendor.email,
              location: b.vendor.location,
              earningsMinor: b.supplierEarningsMinor,
              response: b.supplierResponse,
              respondedAt: b.supplierRespondedAt?.toISOString() ?? null,
              declineReason: b.supplierDeclineReason,
              payoutStatus: s ? settlementDisplayStatus(s.status, s.expectedAt) : 'NOT_DUE',
            }
          : null,
        approvedBy: b.approvedBy?.name ?? null,
        approvedAt: b.approvedAt?.toISOString() ?? null,
        attachments: b.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          url: this.storage.urlFor(a.fileKey),
        })),
      },
      delivery: {
        outbound: outbound ? this.toLeg(outbound) : null,
        return: ret ? this.toLeg(ret) : null,
        handover: b.handover
          ? {
              condition: b.handover.condition,
              preparedAt: b.handover.preparedAt?.toISOString() ?? null,
              method: b.handover.method,
              address: b.handover.address,
              contactPhone: b.handover.contactPhone,
              handedOverAt: b.handover.handedOverAt?.toISOString() ?? null,
              receivedAtHubAt: b.handover.receivedAtHubAt?.toISOString() ?? null,
              returnedToVendorAt: b.handover.returnedToVendorAt?.toISOString() ?? null,
              returnConfirmedAt: b.handover.returnConfirmedAt?.toISOString() ?? null,
              returnDisputeNote: b.handover.returnDisputedAt ? b.handover.returnDisputeNote : null,
              photos: b.handover.photos.map((p) => this.storage.urlFor(p.fileKey)),
            }
          : null,
        outgoingInspection: inspections.find((i) => i.kind === InspectionKind.OUTGOING) ?? null,
        returnInspection: inspections.find((i) => i.kind === InspectionKind.RETURN) ?? null,
      },
      settlement: {
        currency: b.currency,
        rentalMinor: b.subtotalMinor,
        deliveryFeeMinor: b.deliveryFeeMinor,
        serviceFeeMinor: b.serviceFeeMinor,
        discountMinor: b.discountMinor,
        vatMinor: b.taxMinor,
        vatRateBps: b.taxRateBps,
        depositHeldMinor: b.securityDepositMinor,
        totalChargedMinor: due,
        paidMinor: verified,
        balanceMinor: Math.max(0, due - verified),
        commissionMinor: b.commissionMinor,
        commissionRateBps: b.commissionRateBps,
        supplierNetMinor: s?.netMinor ?? b.supplierEarningsMinor,
        depositReleasedMinor: releasedMinor,
        depositRefund: b.depositRefundedAt
          ? {
              amountMinor: b.depositRefundMinor,
              refundedAt: b.depositRefundedAt.toISOString(),
              reference: b.depositRefundReference,
            }
          : null,
        invoice: line
          ? {
              number: line.invoice.number,
              combined: line.invoice.combined,
              status: line.invoice.status,
            }
          : null,
        payout: s
          ? {
              reference: s.reference,
              status: s.status,
              displayStatus: settlementDisplayStatus(s.status, s.expectedAt),
              grossMinor: s.grossMinor,
              commissionMinor: s.commissionMinor,
              adjustmentMinor: s.adjustmentMinor,
              netMinor: s.netMinor,
              expectedAt: s.expectedAt?.toISOString() ?? null,
              paidAt: s.paidAt?.toISOString() ?? null,
              paidBy: s.paidBy?.name ?? null,
              payoutReference: s.payoutReference,
              adjustments: s.adjustments.map((a) => ({
                id: a.id,
                amountMinor: a.amountMinor,
                reason: a.reason,
                createdAt: a.createdAt.toISOString(),
              })),
              payeeConfirmedAt:
                (s.payeeConfirmedAt ?? b.handover?.payoutConfirmedAt)?.toISOString() ?? null,
              payeeDisputeNote: s.payeeDisputeNote ?? b.handover?.payoutDisputeNote ?? null,
            }
          : null,
        payoutAccount: supplierAccount
          ? {
              channel: supplierAccount.channel,
              provider: supplierAccount.provider,
              accountName: supplierAccount.accountName,
              accountNumber: supplierAccount.accountNumber,
            }
          : null,
        payments: paymentRows,
      },
      documents: this.documents(b, paymentRows, agreements, inspections),
      agreements,
      incidents: b.incidents.map((i) => ({
        reference: i.reference,
        type: i.type,
        typeLabel: humanise(i.type),
        status: i.status,
        reporterRole: i.reporterRole,
        description: i.description,
        createdAt: i.createdAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
      })),
      activity: b.statusEvents.map((e) => ({
        at: e.createdAt.toISOString(),
        from: e.fromStatus,
        to: e.toStatus,
        actor: e.actor?.name ?? (e.actorRole ? humanise(e.actorRole) : 'System'),
        actorRole: e.actorRole,
        reason: e.reason,
      })),
    };
  }

  /** The sidebar badges. */
  async counts(): Promise<BookingCountsResponse> {
    const count = (where: Prisma.BookingWhereInput) => this.prisma.booking.count({ where });
    const [requests, active, deliveries, hiring] = await Promise.all([
      count({
        type: BookingType.EQUIPMENT,
        status: { in: [BookingStatus.REQUEST_SUBMITTED, BookingStatus.ESKISTA_REVIEW] },
      }),
      count({ type: BookingType.EQUIPMENT, status: { in: VIEW_STATUSES.active } }),
      count({ type: BookingType.EQUIPMENT, ...this.deliveriesWhere() }),
      count({
        type: BookingType.TALENT,
        status: { in: [BookingStatus.REQUEST_SUBMITTED, BookingStatus.ESKISTA_REVIEW] },
      }),
    ]);
    return {
      bookingRequests: requests,
      activeRentals: active,
      deliveriesAndPickups: deliveries,
      hiringRequests: hiring,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Gear to move: waiting to go out, on its way, or due back. */
  private deliveriesWhere(): Prisma.BookingWhereInput {
    return {
      OR: [
        { status: BookingStatus.BOOKING_CONFIRMED, handover: { receivedAtHubAt: { not: null } } },
        { status: BookingStatus.DELIVERY_PICKUP },
        { status: { in: [BookingStatus.RENTAL_COMPLETED, BookingStatus.RETURN_SCHEDULED] } },
      ],
    };
  }

  private where(query: AdminBookingsQuery): Prisma.BookingWhereInput {
    const q = query.q;
    const view = query.view ?? 'all';
    const and: Prisma.BookingWhereInput[] = [{ status: { not: BookingStatus.DRAFT } }];
    if (view === 'deliveries') and.push(this.deliveriesWhere());
    else if (view !== 'all') and.push({ status: { in: VIEW_STATUSES[view] } });
    if (query.status) and.push({ status: query.status });
    if (query.type) and.push({ type: query.type });
    if (view !== 'all' && view !== 'completed' && !query.type) {
      // The rental tables are equipment; talent has its own Hiring Requests screen.
      and.push({ type: BookingType.EQUIPMENT });
    }
    if (query.vendorId) and.push({ vendorId: query.vendorId });
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.talentProfileId) and.push({ talentProfileId: query.talentProfileId });
    if (query.from) and.push({ startDate: { gte: new Date(query.from) } });
    if (query.to) and.push({ startDate: { lte: new Date(query.to) } });
    if (q) {
      and.push({
        OR: [
          { reference: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { customer: { customer: { organisationName: { contains: q, mode: 'insensitive' } } } },
          { listing: { name: { contains: q, mode: 'insensitive' } } },
          { vendor: { businessName: { contains: q, mode: 'insensitive' } } },
          { talentProfile: { displayName: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    return { AND: and };
  }

  private flowState(b: RowBooking): AdminFlowState {
    return {
      type: b.type,
      status: b.status,
      preparedAt: b.handover?.preparedAt ?? null,
      handedOverAt: b.handover?.handedOverAt ?? null,
      receivedAtHubAt: b.handover?.receivedAtHubAt ?? null,
      hasOutgoingInspection: b.inspections.some((i) => i.kind === InspectionKind.OUTGOING),
      hasReturnInspection: b.inspections.some((i) => i.kind === InspectionKind.RETURN),
      settlementPaid: b.settlement?.status === SettlementStatus.PAID,
      talentAssigned: b.talentProfileId !== null,
      contractsApproved:
        b.agreements.length > 0 &&
        b.agreements
          .filter((a) => a.status !== AgreementStatus.VOID)
          .every((a) => a.status === AgreementStatus.APPROVED),
    };
  }

  private toRow(b: RowBooking): AdminBookingRowResponse {
    const profile = b.customer.customer;
    const outbound = b.fulfilments.find((f) => f.direction === FulfilmentDirection.OUTBOUND);
    const ret = b.fulfilments.find((f) => f.direction === FulfilmentDirection.RETURN);
    const image = b.listing?.images[0];
    const state = this.flowState(b);
    const timeline = buildAdminTimeline(state);
    const current = timeline.find((t) => t.state === 'IN_PROGRESS');

    return {
      reference: b.reference,
      type: b.type,
      customer: {
        id: b.customerId,
        name: profile?.contactPerson ?? b.customer.name,
        organisation: profile?.organisationName ?? null,
        phone: b.contactPhone ?? profile?.phone ?? b.customer.phone,
        email: profile?.email ?? null,
      },
      itemName: b.listing?.name ?? b.talentProfile?.displayName ?? 'Talent request',
      itemImageUrl: image
        ? this.storage.urlFor(image.fileKey)
        : b.talentProfile?.avatarKey
          ? this.storage.urlFor(b.talentProfile.avatarKey)
          : null,
      supplierName: b.vendor?.businessName ?? b.talentProfile?.displayName ?? null,
      startDate: b.startDate.toISOString().slice(0, 10),
      endDate: b.endDate.toISOString().slice(0, 10),
      periods: b.periods,
      status: b.status,
      statusLabel: STATUS_LABELS[b.status] ?? humanise(b.status),
      paymentState: this.paymentState(b),
      amountMinor: this.dueOf(b),
      currency: b.currency,
      supplierResponse: b.supplierResponse,
      units: b.assignedUnits
        .map((u) => u.unit.label ?? u.unit.serialNumber)
        .filter((v): v is string => typeof v === 'string'),
      delivery: outbound ? this.toLeg(outbound) : null,
      return: ret ? this.toLeg(ret) : null,
      nextAction: current?.label ?? null,
      createdAt: b.createdAt.toISOString(),
    };
  }

  private dueOf(b: RowBooking): number {
    const line = b.invoiceLines[0];
    return line
      ? line.totalMinor + line.securityDepositMinor
      : b.totalMinor + b.securityDepositMinor;
  }

  /** The Payment column: Pending Confirmation, Payment Pending, Receipt Uploaded, Payment Confirmed. */
  private paymentState(b: RowBooking): string {
    if (b.status === BookingStatus.REQUEST_SUBMITTED || b.status === BookingStatus.ESKISTA_REVIEW) {
      return 'Pending Confirmation';
    }
    if (b.payments.some((p) => p.status === PaymentStatus.SUBMITTED)) return 'Receipt Uploaded';
    if (b.payments.some((p) => p.status === PaymentStatus.RESUBMISSION_REQUESTED))
      return 'New Slip Requested';
    const paid = b.payments
      .filter((p) => p.status === PaymentStatus.VERIFIED)
      .reduce((sum, p) => sum + p.amountMinor, 0);
    if (paid >= this.dueOf(b) && paid > 0) return 'Payment Confirmed';
    if (paid > 0) return 'Partly Paid';
    if (
      (
        [BookingStatus.REJECTED, BookingStatus.CANCELLED, BookingStatus.EXPIRED] as BookingStatus[]
      ).includes(b.status)
    ) {
      return 'Not Paid';
    }
    return 'Payment Pending';
  }

  private toLeg(f: Fulfilment): LegResponse {
    return {
      direction: f.direction,
      method: f.method,
      methodLabel: METHOD_LABELS[f.method] ?? humanise(f.method),
      stage: f.stage,
      stageLabel: STAGE_LABELS[f.direction][f.stage],
      address: f.address,
      scheduledAt: f.scheduledAt?.toISOString() ?? null,
      etaAt: f.etaAt?.toISOString() ?? null,
      courierName: f.courierName,
      courierPhone: f.courierPhone,
      vehicle: [f.vehicleDescription, f.vehiclePlate].filter(Boolean).join(' · ') || null,
      dispatchedAt: f.dispatchedAt?.toISOString() ?? null,
      completedAt: f.completedAt?.toISOString() ?? null,
      notes: f.notes,
    };
  }

  /** The Documents tab: every file on the booking, who put it there and when. */
  private documents(
    b: DetailBooking,
    payments: Awaited<ReturnType<AdminPaymentsService['forBooking']>>,
    agreements: Awaited<ReturnType<AdminAgreementsService['forBooking']>>,
    inspections: Awaited<ReturnType<AdminInspectionsService['forBooking']>>,
  ): BookingDocumentResponse[] {
    const docs: BookingDocumentResponse[] = [];
    for (const p of payments) {
      docs.push({
        kind: 'PAYMENT_RECEIPT',
        title: `Payment receipt ${p.reference}`,
        url: p.receiptUrl,
        uploadedBy: p.customer.name,
        uploadedAt: p.submittedAt,
      });
    }
    for (const a of agreements) {
      if (a.documentUrl) {
        docs.push({
          kind: 'AGREEMENT',
          title: `${a.kindLabel} agreement`,
          url: `/api/v1/admin/agreements/${a.id}/pdf`,
          uploadedBy: 'Eskista',
          uploadedAt: a.sentAt,
        });
      }
      if (a.signedCopyUrl) {
        docs.push({
          kind: 'SIGNED_AGREEMENT',
          title: `Signed ${a.kindLabel.toLowerCase()} agreement`,
          url: a.signedCopyUrl,
          status: a.status,
          uploadedBy: a.signerName ?? a.counterpartyName,
          uploadedAt: a.uploadedAt,
        });
      }
    }
    for (const i of inspections) {
      docs.push({
        kind: `${i.kind}_INSPECTION_SHEET`,
        title: `${i.kindLabel} inspection sheet`,
        url: i.sheetUrl,
        uploadedBy: i.inspector,
        uploadedAt: i.inspectedAt,
      });
    }
    const line = b.invoiceLines[0];
    if (line) {
      docs.push({
        kind: 'INVOICE',
        title: `Invoice ${line.invoice.number}`,
        url: `/api/v1/admin/invoices/${line.invoice.number}/pdf`,
        uploadedBy: 'Eskista',
        uploadedAt: null,
      });
    }
    if (b.settlement) {
      docs.push({
        kind: 'SETTLEMENT_RECORD',
        title: `Settlement record ${b.settlement.reference ?? ''}`.trim(),
        url: `/api/v1/admin/settlements/${b.settlement.reference ?? b.reference}/pdf`,
        uploadedBy: 'Eskista',
        uploadedAt: b.settlement.createdAt.toISOString(),
      });
    }
    for (const photo of b.handover?.photos ?? []) {
      docs.push({
        kind: 'HANDOVER_PHOTO',
        title: photo.fileName,
        url: this.storage.urlFor(photo.fileKey),
        uploadedBy: b.vendor?.businessName ?? 'Vendor',
        uploadedAt: photo.createdAt.toISOString(),
      });
    }
    return docs;
  }
}
