import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdminTier,
  AgreementStatus,
  AgreementType,
  BookingStatus,
  BookingType,
  InvitationStatus,
  Prisma,
  Role,
  SettlementStatus,
  type Agreement,
} from '@prisma/client';
import {
  DOCUMENT_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../common/upload';
import { AgreementsService } from '../agreements/agreements.service';
import { buildTimeline, statusBadge, stepsFor } from '../customer-bookings/booking-view';
import type {
  AttachmentResponse,
  CustomerAgreementBodyResponse,
  CustomerAgreementResponse,
} from '../customer-bookings/dto/lifecycle.dto';
import { renderAgreementPdf } from '../documents/pdf-renderer';
import { renderCvPdf } from '../documents/cv-renderer';
import type { HireRequestResponse, ListHireRequestsQuery } from '../hiring/dto/hiring.dto';
import {
  TALENT_STATUS_LABELS,
  effectiveStatus,
  hoursLeft,
  isLapsed,
  talentPeriods,
} from '../hiring/hiring-rules';
import { HiringService } from '../hiring/hiring.service';
import { maskAccount } from '../payout-accounts/payout-accounts';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AUTO_CLOSE_HOURS, SettlementsService } from '../settlements/settlements.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import type {
  EngagementCardResponse,
  EngagementDetailResponse,
  ListEngagementsQuery,
  TalentCompletionResponse,
  TalentCvResponse,
  TalentDashboardResponse,
  TalentEarningsResponse,
} from './dto/talent-work.dto';
import { computeCompletion } from './talent-completion';
import { buildCv, type CvDocument } from './talent-cv';
import { budgetLabel, humanise, profileUrlFor, talentAvatarUrl } from './talent-media';
import { TalentProfileService, type TalentWithSections } from './talent-profile.service';

const ENGAGEMENT_TABS: Record<NonNullable<ListEngagementsQuery['tab']>, BookingStatus[]> = {
  upcoming: [BookingStatus.AWAITING_PAYMENT, BookingStatus.BOOKING_CONFIRMED],
  active: [BookingStatus.DELIVERY_PICKUP, BookingStatus.IN_PROGRESS],
  completed: [
    BookingStatus.RENTAL_COMPLETED,
    BookingStatus.RETURN_SCHEDULED,
    BookingStatus.RETURN_RECEIVED,
    BookingStatus.INSPECTION,
    BookingStatus.SETTLEMENT,
    BookingStatus.CLOSED,
  ],
  cancelled: [BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.EXPIRED],
};

/** Everything a talent has been hired for, whatever happened next. */
const HIRED_STATUSES = Object.values(ENGAGEMENT_TABS).flat();

/** From here on the client has paid; venue access notes unlock. */
const CONFIRMED_OR_LATER: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  ...ENGAGEMENT_TABS.active,
  ...ENGAGEMENT_TABS.completed,
];

const AGREEMENT_LABELS: Record<AgreementStatus, string> = {
  DRAFT: 'Draft',
  AWAITING_UPLOAD: 'Download, sign and upload',
  UNDER_REVIEW: 'Under review by Eskista',
  APPROVED: 'Approved',
  REJECTED: 'Re-upload needed',
  DECLINED: 'Declined',
  VOID: 'Void',
};

const requestInclude = {
  booking: {
    include: {
      talentDetail: true,
      talentService: { select: { talentProfileId: true, priceMinor: true, pricingModel: true } },
    },
  },
  hiredBooking: { select: { reference: true, supplierEarningsMinor: true, currency: true } },
} satisfies Prisma.TalentInvitationInclude;

type InvitationRow = Prisma.TalentInvitationGetPayload<{ include: typeof requestInclude }>;

const engagementInclude = {
  talentDetail: true,
  settlement: {
    select: {
      status: true,
      paidAt: true,
      expectedAt: true,
      netMinor: true,
      currency: true,
      payoutReference: true,
      payoutProvider: true,
      payoutAccountNumber: true,
      payeeConfirmedAt: true,
      payeeDisputedAt: true,
    },
  },
} satisfies Prisma.BookingInclude;

type EngagementRow = Prisma.BookingGetPayload<{ include: typeof engagementInclude }>;

/**
 * The talent's working life on Eskista: hire requests, engagements, their agreements,
 * earnings, the dashboard and the CV.
 *
 * **Privacy.** A talent never sees who the client is — no name, company or phone. Talents
 * and clients each contract with Eskista, and Eskista stays in the middle. The brief,
 * dates, city, headcount and budget are shown from the start; the venue once hired; access
 * notes once the client has paid.
 */
@Injectable()
export class TalentWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: TalentProfileService,
    private readonly hiring: HiringService,
    private readonly agreements: AgreementsService,
    private readonly settings: SettingsService,
    private readonly settlements: SettlementsService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── Hire requests ──────────────────────────────────────────────────────────

  async listRequests(userId: string, query: ListHireRequestsQuery): Promise<HireRequestResponse[]> {
    const talent = await this.profiles.requireTalent(userId);
    await this.settleLapsed(talent.id);

    const filter = query.status ?? 'all';
    const statuses: InvitationStatus[] | undefined =
      filter === 'pending'
        ? [InvitationStatus.INVITED]
        : filter === 'accepted'
          ? [InvitationStatus.ACCEPTED]
          : filter === 'closed'
            ? [
                InvitationStatus.DECLINED,
                InvitationStatus.EXPIRED,
                InvitationStatus.WITHDRAWN,
                InvitationStatus.HIRED,
                InvitationStatus.REJECTED,
                InvitationStatus.CANCELLED,
              ]
            : undefined;

    const rows = await this.prisma.talentInvitation.findMany({
      where: {
        talentProfileId: talent.id,
        booking: { status: { not: BookingStatus.DRAFT } },
        ...(statuses ? { status: { in: statuses } } : {}),
      },
      include: requestInclude,
      orderBy: [{ invitedAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    return rows.map((r) => this.toHireRequest(r, talent));
  }

  /** Opens a request. The first open is what turns a "new opportunity" into a seen one. */
  async getRequest(userId: string, invitationId: string): Promise<HireRequestResponse> {
    const talent = await this.profiles.requireTalent(userId);
    const row = await this.requireInvitation(talent.id, invitationId);
    if (isLapsed(row, new Date())) await this.hiring.reconcile(row.bookingId);

    if (!row.viewedAt) {
      await this.prisma.talentInvitation.update({
        where: { id: row.id },
        data: { viewedAt: new Date() },
      });
    }
    const fresh = await this.requireInvitation(talent.id, invitationId);
    return this.toHireRequest(fresh, talent);
  }

  async accept(userId: string, invitationId: string): Promise<HireRequestResponse> {
    await this.hiring.accept(userId, invitationId);
    return this.getRequest(userId, invitationId);
  }

  async decline(
    userId: string,
    invitationId: string,
    reason?: string,
  ): Promise<HireRequestResponse> {
    await this.hiring.decline(userId, invitationId, reason);
    return this.getRequest(userId, invitationId);
  }

  async withdraw(
    userId: string,
    invitationId: string,
    reason?: string,
  ): Promise<HireRequestResponse> {
    await this.hiring.withdraw(userId, invitationId, reason);
    return this.getRequest(userId, invitationId);
  }

  // ── Engagements ────────────────────────────────────────────────────────────

  async listEngagements(
    userId: string,
    query: ListEngagementsQuery,
  ): Promise<EngagementCardResponse[]> {
    const talent = await this.profiles.requireTalent(userId);
    const tab = query.tab ?? 'upcoming';
    const rows = await this.prisma.booking.findMany({
      where: { talentProfileId: talent.id, status: { in: ENGAGEMENT_TABS[tab] } },
      include: engagementInclude,
      orderBy:
        tab === 'upcoming' || tab === 'active'
          ? [{ startDate: 'asc' }, { id: 'asc' }]
          : [{ startDate: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    return rows.map((r) => this.toEngagementCard(r));
  }

  async getEngagement(userId: string, reference: string): Promise<EngagementDetailResponse> {
    const talent = await this.profiles.requireTalent(userId);
    const booking = await this.prisma.booking.findFirst({
      where: { reference, talentProfileId: talent.id, status: { in: HIRED_STATUSES } },
      include: {
        ...engagementInclude,
        statusEvents: { orderBy: { createdAt: 'desc' } },
        agreements: { where: { counterpartyId: userId, kind: AgreementType.TALENT_SERVICE } },
      },
    });
    if (!booking) throw new NotFoundException('Engagement not found');

    const owners = booking.parentBookingId ? [booking.id, booking.parentBookingId] : [booking.id];
    const [attachments, supportPhone] = await Promise.all([
      this.prisma.bookingAttachment.findMany({
        where: { bookingId: { in: owners } },
        orderBy: { createdAt: 'asc' },
      }),
      this.settings.supportPhone(),
    ]);

    const unlocked = CONFIRMED_OR_LATER.includes(booking.status);
    const agreement = booking.agreements[0] ?? null;
    const agreementPending =
      agreement?.status === AgreementStatus.AWAITING_UPLOAD ||
      agreement?.status === AgreementStatus.REJECTED;

    const s = booking.settlement;
    const paid = s?.status === SettlementStatus.PAID;
    const actions: EngagementDetailResponse['actions'] = [];
    if (agreementPending) {
      actions.push({ key: 'SIGN_AGREEMENT', label: 'Download & Sign Agreement', primary: true });
    } else if (paid && !s.payeeConfirmedAt) {
      actions.push({ key: 'CONFIRM_PAYMENT', label: 'Confirm Payment', primary: true });
    } else if (s?.payeeConfirmedAt && booking.status === BookingStatus.SETTLEMENT) {
      actions.push({ key: 'COMPLETE_BOOKING', label: 'Complete Booking', primary: true });
    }
    actions.push({
      key: 'CONTACT_ESKISTA',
      label: 'Contact Eskista',
      primary: actions.length === 0,
    });

    return {
      ...this.toEngagementCard(booking),
      projectType: booking.projectType,
      projectDescription: booking.projectDescription,
      engagementModel: booking.talentDetail?.engagementModel ?? 'PER_DAY',
      headcount: booking.talentDetail?.headcount ?? null,
      venue: booking.talentDetail?.venue ?? null,
      locationNotes: unlocked ? (booking.talentDetail?.locationNotes ?? null) : null,
      locationNotesLocked: !unlocked && !!booking.talentDetail?.locationNotes,
      timeline: buildTimeline(
        BookingType.TALENT,
        booking.status,
        this.stepTimestamps(booking.statusEvents),
      ),
      attachments: attachments.map((a) => this.toAttachment(a)),
      agreement: agreement ? this.toAgreement(agreement, booking.reference) : null,
      actions,
      supportPhone,
      payout: s
        ? {
            status: s.status,
            statusLabel: s.status === SettlementStatus.PAID ? 'Paid' : 'Pending',
            amountMinor: s.netMinor,
            currency: s.currency,
            expectedAt: s.expectedAt?.toISOString().slice(0, 10) ?? null,
            paidAt: s.paidAt?.toISOString() ?? null,
            payoutReference: s.payoutReference,
            paidTo:
              s.payoutProvider && s.payoutAccountNumber
                ? `${s.payoutProvider} ${maskAccount(s.payoutAccountNumber)}`
                : null,
            confirmedAt: s.payeeConfirmedAt?.toISOString() ?? null,
            disputedAt: s.payeeDisputedAt?.toISOString() ?? null,
          }
        : null,
      documents: s
        ? [
            {
              kind: 'SETTLEMENT_RECORD',
              label: 'Settlement Record',
              url: `/api/v1/talent/bookings/${booking.reference}/settlement-record.pdf`,
              format: 'PDF',
            },
          ]
        : [],
    };
  }

  // ── Payout ─────────────────────────────────────────────────────────────────

  /**
   * Confirm Payment: the payout reached the talent. "Payment Received! You can now complete
   * this booking, or it will automatically close in 24 hours." `confirmed: false` reports it
   * missing for Eskista to follow up.
   */
  async confirmPayout(
    userId: string,
    reference: string,
    confirmed: boolean,
    note?: string,
  ): Promise<TalentCompletionResponse> {
    const booking = await this.requireEngagement(userId, reference);
    const s = booking.settlement;
    if (s?.status !== SettlementStatus.PAID) {
      throw new ConflictException('Eskista has not sent your payout yet');
    }
    if (s.payeeConfirmedAt) throw new ConflictException('You have already confirmed this payout');

    const now = new Date();
    await this.prisma.settlement.update({
      where: { bookingId: booking.id },
      data: confirmed
        ? { payeeConfirmedAt: now, payeeDisputedAt: null, payeeDisputeNote: null }
        : { payeeDisputedAt: now, payeeDisputeNote: note },
    });
    await this.prisma.bookingStatusEvent.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        actorId: userId,
        actorRole: Role.TALENT,
        reason: confirmed ? 'Talent confirmed the payout' : 'Talent reported the payout missing',
        metadata: note ? { note } : undefined,
      },
    });
    if (confirmed && booking.status === BookingStatus.SETTLEMENT) {
      await this.settlements.scheduleAutoClose(booking.id, now);
    }
    if (!confirmed) {
      const talent = await this.profiles.requireTalent(userId);
      await this.notifications.notifyAdmins(
        'ADMIN_PAYOUT_DISPUTED',
        { payee: talent.displayName, reference },
        { bookingReference: reference },
        [AdminTier.FINANCE],
      );
    }

    return {
      title: confirmed ? 'Payment Received!' : 'Eskista Has Been Told',
      message: confirmed
        ? `Payment confirmed. You can now complete this booking, or it will automatically ` +
          `close in ${AUTO_CLOSE_HOURS} hours.`
        : 'Eskista will look into your payout and contact you.',
      engagement: await this.getEngagement(userId, reference),
    };
  }

  async complete(userId: string, reference: string): Promise<EngagementDetailResponse> {
    const booking = await this.requireEngagement(userId, reference);
    if (!booking.settlement?.payeeConfirmedAt) {
      throw new ConflictException('Confirm you received the payment first');
    }
    await this.settlements.close(booking.id, userId, Role.TALENT);
    return this.getEngagement(userId, reference);
  }

  async settlementPdf(
    userId: string,
    reference: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const talent = await this.profiles.requireTalent(userId);
    const booking = await this.requireEngagement(userId, reference);
    return this.settlements.recordPdf(booking.id, talent.displayName, this.titleFor(booking));
  }

  private async requireEngagement(userId: string, reference: string): Promise<EngagementRow> {
    const talent = await this.profiles.requireTalent(userId);
    const booking = await this.prisma.booking.findFirst({
      where: { reference, talentProfileId: talent.id, status: { in: HIRED_STATUSES } },
      include: engagementInclude,
    });
    if (!booking) throw new NotFoundException('Engagement not found');
    return booking;
  }

  // ── Agreement ──────────────────────────────────────────────────────────────

  async getAgreement(userId: string, reference: string): Promise<CustomerAgreementBodyResponse> {
    const agreement = await this.requireAgreement(userId, reference);
    return {
      ...this.toAgreement(agreement, reference),
      body: await this.agreements.getBody(agreement.id, userId),
    };
  }

  async agreementPdf(
    userId: string,
    reference: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const agreement = await this.getAgreement(userId, reference);
    const buffer = await renderAgreementPdf({
      title: 'Talent Service Agreement',
      reference,
      meta: [
        { label: 'Ref', value: reference },
        { label: 'Issued', value: agreement.sentAt?.slice(0, 10) ?? '—' },
        { label: 'Version', value: String(agreement.version) },
        { label: 'Governed by', value: agreement.governedBy },
      ],
      body: agreement.body,
      contentHash: agreement.contentHash,
      signerName: agreement.signerName,
      signedAt: agreement.uploadedAt ? new Date(agreement.uploadedAt) : null,
    });
    return { buffer, filename: `${reference}-talent-agreement.pdf` };
  }

  async uploadSignedAgreement(
    userId: string,
    reference: string,
    signer: { signerName: string; signerPhone?: string },
    file: UploadedFile | undefined,
  ): Promise<CustomerAgreementResponse> {
    const agreement = await this.requireAgreement(userId, reference);
    const valid = assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.receipt,
      field: 'signedAgreement',
    });
    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `bookings/${reference}/agreements/signed`,
    });
    const updated = await this.agreements.uploadSignedCopy(agreement.id, userId, {
      signerName: signer.signerName,
      signerPhone: signer.signerPhone,
      fileKey: stored.key,
      fileName: valid.originalname,
      mimeType: valid.mimetype,
      sizeBytes: valid.size,
    });
    await this.notifications.notifyAdmins(
      'ADMIN_AGREEMENT_UPLOADED',
      { reference },
      { bookingReference: reference, agreementId: agreement.id },
      [AdminTier.ADMIN],
    );
    return this.toAgreement(updated, reference);
  }

  async declineAgreement(
    userId: string,
    reference: string,
    reason: string,
  ): Promise<CustomerAgreementResponse> {
    const agreement = await this.requireAgreement(userId, reference);
    const updated = await this.agreements.decline(agreement.id, userId, reason);
    return this.toAgreement(updated, reference);
  }

  // ── Dashboard & earnings ───────────────────────────────────────────────────

  async dashboard(userId: string): Promise<TalentDashboardResponse> {
    const talent = await this.profiles.requireTalent(userId);
    await this.settleLapsed(talent.id);

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const counted = HIRED_STATUSES.filter((s) => !ENGAGEMENT_TABS.cancelled.includes(s));

    const [month, pending, upcoming] = await Promise.all([
      this.prisma.booking.aggregate({
        where: {
          talentProfileId: talent.id,
          status: { in: counted.filter((s) => s !== BookingStatus.AWAITING_PAYMENT) },
          startDate: { gte: monthStart, lt: nextMonth },
        },
        _sum: { supplierEarningsMinor: true },
      }),
      this.prisma.talentInvitation.findMany({
        where: {
          talentProfileId: talent.id,
          status: InvitationStatus.INVITED,
          expiresAt: { gt: now },
          booking: { status: BookingStatus.ESKISTA_REVIEW },
        },
        include: requestInclude,
        orderBy: { invitedAt: 'desc' },
      }),
      this.prisma.booking.findMany({
        where: { talentProfileId: talent.id, status: { in: ENGAGEMENT_TABS.upcoming } },
        include: engagementInclude,
        orderBy: { startDate: 'asc' },
        take: 5,
      }),
    ]);

    const unopened = pending.filter((p) => !p.viewedAt);
    const completion = computeCompletion(this.profiles.completionInput(talent));

    return {
      firstName: talent.displayName.split(/\s+/)[0] ?? talent.displayName,
      status: talent.status,
      thisMonthEarningsMinor: month._sum.supplierEarningsMinor ?? 0,
      currency: talent.currency,
      profileViews: talent.profileViewCount,
      pendingRequests: pending.length,
      newOpportunities: unopened.length,
      newOpportunityTypes: [
        ...new Set(
          unopened
            .map((p) => humanise(p.booking.projectType))
            .filter((t): t is string => t !== null),
        ),
      ],
      completionPercent: completion.percent,
      showCompleteProfile: completion.percent < 100,
      profileUrl: profileUrlFor(talent.slug),
      hireRequests: pending.slice(0, 5).map((p) => this.toHireRequest(p, talent)),
      upcoming: upcoming.map((b) => this.toEngagementCard(b)),
    };
  }

  /**
   * The Earnings tab. Every figure is what the talent is paid — their own rate, in full —
   * never the client's price.
   */
  async earnings(userId: string): Promise<TalentEarningsResponse> {
    const talent = await this.profiles.requireTalent(userId);
    const rows = await this.prisma.booking.findMany({
      where: {
        talentProfileId: talent.id,
        status: { in: HIRED_STATUSES.filter((s) => !ENGAGEMENT_TABS.cancelled.includes(s)) },
      },
      include: engagementInclude,
      orderBy: { startDate: 'desc' },
      take: 200,
    });

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let totalRevenueMinor = 0;
    let todayMinor = 0;
    let upcomingMinor = 0;
    let pendingMinor = 0;

    const items: TalentEarningsResponse['items'] = [];
    for (const b of rows) {
      // Awaiting payment is not yet money anyone has committed; leave it out of the totals.
      if (b.status === BookingStatus.AWAITING_PAYMENT) continue;
      const status = this.payoutStatus(b);
      if (status === 'CANCELLED') continue;
      if (status === 'PAID') {
        totalRevenueMinor += b.supplierEarningsMinor;
        if (b.settlement?.paidAt && b.settlement.paidAt >= todayStart) {
          todayMinor += b.supplierEarningsMinor;
        }
      } else if (status === 'PENDING') {
        pendingMinor += b.supplierEarningsMinor;
      } else {
        upcomingMinor += b.supplierEarningsMinor;
      }
      items.push({
        reference: b.reference,
        title: this.titleFor(b),
        date: b.startDate.toISOString().slice(0, 10),
        earningsMinor: b.supplierEarningsMinor,
        status,
        paidAt: b.settlement?.paidAt?.toISOString() ?? null,
      });
    }

    return {
      currency: talent.currency,
      totalRevenueMinor,
      todayMinor,
      upcomingMinor,
      pendingMinor,
      items,
    };
  }

  // ── CV ─────────────────────────────────────────────────────────────────────

  async cv(userId: string): Promise<TalentCvResponse> {
    const talent = await this.profiles.requireTalent(userId);
    return this.cvFor(talent, true);
  }

  async cvPdf(userId: string): Promise<{ buffer: Buffer; filename: string }> {
    const talent = await this.profiles.requireTalent(userId);
    const buffer = await renderCvPdf(this.cvFor(talent, true));
    return { buffer, filename: `${talent.slug ?? 'cv'}-cv.pdf` };
  }

  cvFor(talent: TalentWithSections, includeContact: boolean): CvDocument {
    return buildCv(talent, {
      includeContact,
      avatarUrl: talentAvatarUrl(talent, this.storage),
      profileUrl: profileUrlFor(talent.slug),
    });
  }

  // ── mapping ────────────────────────────────────────────────────────────────

  private toHireRequest(
    row: InvitationRow,
    talent: {
      id: string;
      baseRateMinor: number | null;
      pricingModel: TalentWithSections['pricingModel'];
      currency: string;
    },
  ): HireRequestResponse {
    const now = new Date();
    const b = row.booking;
    const d = b.talentDetail;
    const status = effectiveStatus(row, now);
    const open = b.status === BookingStatus.ESKISTA_REVIEW;

    // Their own service, if the client picked one of theirs; otherwise their base rate.
    const service =
      b.talentService && b.talentService.talentProfileId === talent.id ? b.talentService : null;
    const rate = service?.priceMinor ?? talent.baseRateMinor ?? 0;
    const model = service?.pricingModel ?? talent.pricingModel;
    const estimate = rate * talentPeriods(model, b.startDate, b.endDate, d?.startTime, d?.endTime);

    return {
      id: row.id,
      reference: row.hiredBooking?.reference ?? b.reference,
      status,
      statusLabel: TALENT_STATUS_LABELS[status],
      isNew: !row.viewedAt,
      title: this.titleFor(b),
      projectType: b.projectType,
      projectDescription: b.projectDescription,
      startDate: b.startDate.toISOString().slice(0, 10),
      endDate: b.endDate.toISOString().slice(0, 10),
      startTime: d?.startTime ?? null,
      endTime: d?.endTime ?? null,
      engagementModel: d?.engagementModel ?? 'PER_DAY',
      city: d?.city ?? null,
      headcount: d?.headcount ?? 1,
      budgetBand: d?.budgetBand ?? null,
      budgetMinor: d?.budgetMinor ?? null,
      budgetLabel: budgetLabel(d?.budgetBand, d?.budgetMinor),
      yourEarningsMinor: row.hiredBooking?.supplierEarningsMinor ?? estimate,
      currency: row.hiredBooking?.currency ?? talent.currency,
      receivedAt: row.invitedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      hoursToRespond: status === InvitationStatus.INVITED ? hoursLeft(row.expiresAt, now) : null,
      canRespond: open && status === InvitationStatus.INVITED,
      canWithdraw: open && status === InvitationStatus.ACCEPTED,
      engagementReference:
        status === InvitationStatus.HIRED ? (row.hiredBooking?.reference ?? null) : null,
    };
  }

  private toEngagementCard(b: EngagementRow): EngagementCardResponse {
    return {
      reference: b.reference,
      title: this.titleFor(b),
      status: b.status,
      badge: statusBadge(b.status),
      startDate: b.startDate.toISOString().slice(0, 10),
      endDate: b.endDate.toISOString().slice(0, 10),
      startTime: b.talentDetail?.startTime ?? null,
      endTime: b.talentDetail?.endTime ?? null,
      city: b.talentDetail?.city ?? null,
      earningsMinor: b.supplierEarningsMinor,
      currency: b.currency,
      payoutStatus: this.payoutStatus(b),
    };
  }

  private payoutStatus(b: EngagementRow): EngagementCardResponse['payoutStatus'] {
    if (ENGAGEMENT_TABS.cancelled.includes(b.status)) return 'CANCELLED';
    if (b.settlement?.status === SettlementStatus.PAID) return 'PAID';
    if (ENGAGEMENT_TABS.completed.includes(b.status)) return 'PENDING';
    return 'UPCOMING';
  }

  /** "Brand campaign" — the project type, or the brief's first line when there is none. */
  private titleFor(b: { projectType: string | null; projectDescription: string | null }): string {
    return (
      humanise(b.projectType) ??
      b.projectDescription?.split('\n')[0]?.slice(0, 60) ??
      'Hire request'
    );
  }

  private toAgreement(a: Agreement, reference: string): CustomerAgreementResponse {
    return {
      id: a.id,
      kind: a.kind,
      status: a.status,
      statusLabel: AGREEMENT_LABELS[a.status] ?? a.status,
      bookingReference: reference,
      version: a.version,
      contentHash: a.contentHash,
      governedBy: 'Ethiopian Law',
      documentUrl: a.documentKey ? this.storage.urlFor(a.documentKey) : null,
      signedCopyUrl: a.scannedCopyKey ? this.storage.urlFor(a.scannedCopyKey) : null,
      signerName: a.signerName,
      sentAt: a.sentAt?.toISOString() ?? null,
      uploadedAt: a.uploadedAt?.toISOString() ?? null,
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
      rejectionReason: a.rejectionReason,
      awaitingCustomer:
        a.status === AgreementStatus.AWAITING_UPLOAD || a.status === AgreementStatus.REJECTED,
    };
  }

  private toAttachment(a: {
    id: string;
    fileKey: string;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number | null;
    createdAt: Date;
  }): AttachmentResponse {
    return {
      id: a.id,
      fileName: a.fileName,
      url: this.storage.urlFor(a.fileKey),
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private stepTimestamps(
    events: { toStatus: BookingStatus; createdAt: Date }[],
  ): Map<string, Date> {
    const byStatus = new Map<BookingStatus, Date>();
    for (const event of events) byStatus.set(event.toStatus, event.createdAt);
    const result = new Map<string, Date>();
    for (const step of stepsFor(BookingType.TALENT)) {
      for (const status of step.active) {
        const at = byStatus.get(status);
        if (at && !result.has(step.key)) result.set(step.key, at);
      }
    }
    return result;
  }

  // ── lookups ────────────────────────────────────────────────────────────────

  /** Lapses this talent's unanswered requests whose 48 hours are up. */
  private async settleLapsed(talentProfileId: string): Promise<void> {
    const lapsed = await this.prisma.talentInvitation.findMany({
      where: {
        talentProfileId,
        status: InvitationStatus.INVITED,
        expiresAt: { lte: new Date() },
        booking: { status: { not: BookingStatus.DRAFT } },
      },
      select: { bookingId: true },
      take: 20,
    });
    for (const bookingId of new Set(lapsed.map((l) => l.bookingId))) {
      await this.hiring.reconcile(bookingId);
    }
  }

  private async requireInvitation(talentProfileId: string, id: string): Promise<InvitationRow> {
    const row = await this.prisma.talentInvitation.findFirst({
      where: { id, talentProfileId, booking: { status: { not: BookingStatus.DRAFT } } },
      include: requestInclude,
    });
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }

  private async requireAgreement(userId: string, reference: string): Promise<Agreement> {
    const agreement = await this.prisma.agreement.findFirst({
      where: {
        kind: AgreementType.TALENT_SERVICE,
        counterpartyId: userId,
        booking: { reference },
      },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    return agreement;
  }
}
