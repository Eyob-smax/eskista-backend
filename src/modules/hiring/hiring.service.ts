import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  AdminTier,
  BookingStatus,
  BookingType,
  InvitationStatus,
  Prisma,
  Role,
  VerificationStatus,
  type TalentProfile,
} from '@prisma/client';
import { computePriceBreakdown } from '../../common/money';
import { AgreementsService } from '../agreements/agreements.service';
import { JOB_NAMES, jobIdFor } from '../jobs/jobs.constants';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../settings/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import { humanise, talentAvatarUrl } from '../talent/talent-media';
import {
  CustomerInvitationResponse,
  CustomerInvitationsResponse,
  InvitationPriceResponse,
} from './dto/hiring.dto';
import {
  CUSTOMER_STATUS_LABELS,
  IN_THE_RUNNING,
  effectiveStatus,
  formatDateRange,
  hoursLeft,
  isLapsed,
  judgeRequest,
  talentPeriods,
} from './hiring-rules';

const HOUR_MS = 3_600_000;

/**
 * Bookings that commit a talent's time. A talent in one of these cannot accept or be hired
 * for overlapping dates. Includes AWAITING_PAYMENT: once hired, the dates are theirs.
 */
export const TALENT_COMMITTED: BookingStatus[] = [
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
];

const requestInclude = {
  talentDetail: true,
  invitations: {
    include: {
      talentProfile: { include: { user: { select: { image: true } } } },
      hiredBooking: { select: { reference: true } },
    },
    orderBy: { invitedAt: 'asc' },
  },
} satisfies Prisma.BookingInclude;

type RequestRow = Prisma.BookingGetPayload<{ include: typeof requestInclude }>;

type RequestService = {
  id: string;
  talentProfileId: string;
  priceMinor: number;
  pricingModel: TalentProfile['pricingModel'];
} | null;

type PricedSnapshot = Pick<
  Prisma.BookingUncheckedCreateInput,
  | 'periods'
  | 'currency'
  | 'unitPriceMinor'
  | 'subtotalMinor'
  | 'deliveryFeeMinor'
  | 'securityDepositMinor'
  | 'discountMinor'
  | 'taxRateBps'
  | 'taxMinor'
  | 'serviceFeeRateBps'
  | 'serviceFeeMinor'
  | 'totalMinor'
  | 'commissionRateBps'
  | 'commissionMinor'
  | 'supplierEarningsMinor'
>;

interface Actor {
  id: string | null;
  role: Role | null;
}

/**
 * The multi-talent hire: invitations, answers, the customer's choice, and expiry.
 *
 * Shared by the customer app (invite, choose) and the talent app (accept, decline), and
 * driven by jobs for the two clocks — 48 hours for a talent to answer, 72 hours from the
 * first acceptance for the customer to choose. All three limits are admin settings.
 *
 * Nothing is priced until a hire. Every talent has their own fixed rate, so a request that
 * has invited five of them has five possible prices; the customer sees each one beside the
 * talent, and the booking is priced from whoever they pick.
 *
 * Each hire is its own booking: the first reuses the request, later ones (headcount > 1)
 * become siblings pointing at it. Each has its own agreement, payment, payout and review.
 */
@Injectable()
export class HiringService implements OnModuleInit {
  private readonly logger = new Logger(HiringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly numbering: NumberingService,
    private readonly agreements: AgreementsService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  onModuleInit(): void {
    this.jobs.registerHandler(JOB_NAMES.invitationExpiry, ({ bookingId }) =>
      this.reconcile(bookingId),
    );
    this.jobs.registerHandler(JOB_NAMES.selectionDeadline, ({ bookingId }) =>
      this.reconcile(bookingId),
    );
    this.jobs.registerHandler(JOB_NAMES.selectionReminder, ({ bookingId }) =>
      this.selectionReminder(bookingId),
    );
  }

  // ── Draft ──────────────────────────────────────────────────────────────────

  /**
   * Replaces the talents invited on a draft.
   *
   * A draft's invitations are rows like any other, so the request keeps them when it is
   * submitted, but a talent never sees one until then — every talent-side query filters
   * out drafts. Nothing is sent and no clock starts here.
   */
  async setDraftInvitations(bookingId: string, talentProfileIds: string[]): Promise<void> {
    const unique = [...new Set(talentProfileIds)];
    const { maxInvitations } = await this.settings.hiring();
    if (unique.length > maxInvitations) {
      throw new BadRequestException(
        `You can invite up to ${maxInvitations} talents to one request`,
      );
    }

    if (unique.length > 0) {
      const bookable = await this.prisma.talentProfile.findMany({
        where: { id: { in: unique }, ...BOOKABLE_TALENT },
        select: { id: true },
      });
      const found = new Set(bookable.map((t) => t.id));
      const missing = unique.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new NotFoundException({
          message: 'Some of these talents are not available to hire',
          talentProfileIds: missing,
        });
      }
    }

    // Placeholder deadline; the real one is set when the request is sent.
    const placeholder = new Date(Date.now() + 365 * 24 * HOUR_MS);

    await this.prisma.$transaction([
      this.prisma.talentInvitation.deleteMany({
        where: { bookingId, talentProfileId: { notIn: unique } },
      }),
      this.prisma.talentInvitation.createMany({
        data: unique.map((talentProfileId) => ({
          bookingId,
          talentProfileId,
          expiresAt: placeholder,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  /**
   * Sends a submitted request to every invited talent and starts their 48 hours.
   *
   * The request moves straight to ESKISTA_REVIEW, which the timeline labels "Talent
   * Confirmation": there is nothing for anyone to do at REQUEST_SUBMITTED any more.
   */
  async submitRequest(customerId: string, bookingId: string): Promise<void> {
    const invitations = await this.prisma.talentInvitation.findMany({
      where: { bookingId },
      include: { talentProfile: { select: { id: true, status: true, isAvailableForHire: true } } },
    });
    if (invitations.length === 0) {
      throw new BadRequestException({
        message: 'This request is not ready to submit',
        outstandingRequirements: ['talentProfileIds'],
      });
    }

    const gone = invitations.filter(
      (i) =>
        i.talentProfile.status !== VerificationStatus.VERIFIED ||
        !i.talentProfile.isAvailableForHire,
    );
    if (gone.length > 0) {
      throw new ConflictException({
        message:
          'Some of the talents on this request are no longer taking work. Remove them ' +
          'and submit again.',
        talentProfileIds: gone.map((i) => i.talentProfileId),
      });
    }

    const { invitationTtlHours } = await this.settings.hiring();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + invitationTtlHours * HOUR_MS);

    await this.prisma.$transaction([
      this.prisma.talentInvitation.updateMany({
        where: { bookingId },
        data: { status: InvitationStatus.INVITED, invitedAt: now, expiresAt },
      }),
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.ESKISTA_REVIEW, selectionDeadlineAt: null },
      }),
      this.prisma.bookingStatusEvent.create({
        data: {
          bookingId,
          fromStatus: BookingStatus.DRAFT,
          toStatus: BookingStatus.REQUEST_SUBMITTED,
          actorId: customerId,
          actorRole: Role.CUSTOMER,
          createdAt: now,
        },
      }),
      this.prisma.bookingStatusEvent.create({
        data: {
          bookingId,
          fromStatus: BookingStatus.REQUEST_SUBMITTED,
          toStatus: BookingStatus.ESKISTA_REVIEW,
          reason: `Sent to ${invitations.length} talent(s)`,
          createdAt: new Date(now.getTime() + 1),
        },
      }),
    ]);

    await this.announce(
      bookingId,
      invitations.map((i) => i.id),
      invitationTtlHours,
      expiresAt,
    );
    const request = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { reference: true, customer: { select: { name: true } } },
    });
    await this.notifications.notifyAdmins(
      'ADMIN_BOOKING_REQUEST',
      {
        customer: request.customer.name,
        item: `${invitations.length} talent${invitations.length === 1 ? '' : 's'}`,
        reference: request.reference,
      },
      { bookingReference: request.reference },
      [AdminTier.ADMIN, AdminTier.SUPPORT],
    );
  }

  /**
   * Invites more talents to a request that is still open — typically after some declined.
   * Allowed until anyone is hired, within the admin limit.
   */
  async inviteMore(
    customerId: string,
    reference: string,
    talentProfileIds: string[],
  ): Promise<CustomerInvitationsResponse> {
    const request = await this.requireCustomerRequest(customerId, reference);
    await this.reconcile(request.id);
    const fresh = await this.requireCustomerRequest(customerId, reference);

    if (fresh.status !== BookingStatus.ESKISTA_REVIEW) {
      throw new ConflictException('This request is no longer open to new invitations');
    }
    if (fresh.invitations.some((i) => i.status === InvitationStatus.HIRED)) {
      throw new ConflictException('A talent has already been hired for this request');
    }

    const { maxInvitations, invitationTtlHours } = await this.settings.hiring();
    const already = new Set(fresh.invitations.map((i) => i.talentProfileId));
    const toAdd = [...new Set(talentProfileIds)].filter((id) => !already.has(id));
    if (toAdd.length === 0) {
      throw new ConflictException('Those talents have already been invited');
    }
    if (fresh.invitations.length + toAdd.length > maxInvitations) {
      throw new BadRequestException(
        `A request can invite at most ${maxInvitations} talents ` +
          `(${fresh.invitations.length} already invited)`,
      );
    }

    const bookable = await this.prisma.talentProfile.findMany({
      where: { id: { in: toAdd }, ...BOOKABLE_TALENT },
      select: { id: true },
    });
    if (bookable.length !== toAdd.length) {
      throw new NotFoundException('Some of these talents are not available to hire');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + invitationTtlHours * HOUR_MS);
    await this.prisma.talentInvitation.createMany({
      data: toAdd.map((talentProfileId) => ({
        bookingId: fresh.id,
        talentProfileId,
        invitedAt: now,
        expiresAt,
      })),
    });

    const created = await this.prisma.talentInvitation.findMany({
      where: { bookingId: fresh.id, talentProfileId: { in: toAdd } },
      select: { id: true },
    });
    await this.announce(
      fresh.id,
      created.map((c) => c.id),
      invitationTtlHours,
      expiresAt,
    );

    return this.listForCustomer(customerId, reference);
  }

  // ── Talent answers ─────────────────────────────────────────────────────────

  async accept(userId: string, invitationId: string): Promise<void> {
    const inv = await this.requireOwnInvitation(userId, invitationId);
    await this.assertAnswerable(inv);

    const conflict = await this.scheduleConflict(
      inv.talentProfileId,
      inv.booking.startDate,
      inv.booking.endDate,
      inv.bookingId,
    );
    if (conflict) throw new ConflictException(conflict);

    const now = new Date();
    await this.prisma.talentInvitation.update({
      where: { id: inv.id },
      data: { status: InvitationStatus.ACCEPTED, respondedAt: now, viewedAt: inv.viewedAt ?? now },
    });

    if (inv.booking.autoHireFirstAccept) {
      await this.hireInvitations(inv.bookingId, [inv.id], { id: null, role: null }, false);
      return;
    }

    const { selectionTtlHours } = await this.settings.hiring();
    let deadline = inv.booking.selectionDeadlineAt;
    if (!deadline) {
      // The customer's clock starts on the first yes, not on submission: there is nothing
      // to choose between until someone is available.
      deadline = new Date(now.getTime() + selectionTtlHours * HOUR_MS);
      await this.prisma.booking.update({
        where: { id: inv.bookingId },
        data: { selectionDeadlineAt: deadline },
      });
      await this.jobs.scheduleAt(
        JOB_NAMES.selectionDeadline,
        { bookingId: inv.bookingId },
        deadline,
        jobIdFor(JOB_NAMES.selectionDeadline, inv.bookingId),
      );
      if (selectionTtlHours > 24) {
        await this.jobs.scheduleAt(
          JOB_NAMES.selectionReminder,
          { bookingId: inv.bookingId },
          new Date(deadline.getTime() - 24 * HOUR_MS),
          jobIdFor(JOB_NAMES.selectionReminder, inv.bookingId),
        );
      }
    }

    await this.notifications.send(
      inv.booking.customerId,
      'TALENT_ACCEPTED',
      {
        talent: inv.talentProfile.displayName,
        reference: inv.booking.reference,
        hours: String(hoursLeft(deadline, now) ?? selectionTtlHours),
      },
      { bookingReference: inv.booking.reference, invitationId: inv.id },
    );
  }

  async decline(userId: string, invitationId: string, reason?: string): Promise<void> {
    const inv = await this.requireOwnInvitation(userId, invitationId);
    await this.assertAnswerable(inv);

    const now = new Date();
    await this.prisma.talentInvitation.update({
      where: { id: inv.id },
      data: {
        status: InvitationStatus.DECLINED,
        respondedAt: now,
        viewedAt: inv.viewedAt ?? now,
        declineReason: reason,
      },
    });
    await this.jobs.cancel(jobIdFor(JOB_NAMES.invitationExpiry, inv.id));

    await this.notifications.send(
      inv.booking.customerId,
      'TALENT_DECLINED',
      { talent: inv.talentProfile.displayName, reference: inv.booking.reference },
      { bookingReference: inv.booking.reference, invitationId: inv.id },
    );
    await this.reconcile(inv.bookingId);
  }

  /**
   * Takes back an acceptance before the customer has chosen.
   *
   * Once hired, pulling out is a cancellation of a real engagement with an agreement behind
   * it, and goes through Eskista rather than a button.
   */
  async withdraw(userId: string, invitationId: string, reason?: string): Promise<void> {
    const inv = await this.requireOwnInvitation(userId, invitationId);
    if (inv.status === InvitationStatus.HIRED) {
      throw new ConflictException(
        'You have already been hired for this request. Contact Eskista to cancel.',
      );
    }
    if (inv.status !== InvitationStatus.ACCEPTED) {
      throw new ConflictException('Only an accepted request can be withdrawn');
    }

    await this.prisma.talentInvitation.update({
      where: { id: inv.id },
      data: {
        status: InvitationStatus.WITHDRAWN,
        respondedAt: new Date(),
        declineReason: reason,
      },
    });
    await this.notifications.send(
      inv.booking.customerId,
      'TALENT_DECLINED',
      { talent: inv.talentProfile.displayName, reference: inv.booking.reference },
      { bookingReference: inv.booking.reference, invitationId: inv.id },
    );
    await this.reconcile(inv.bookingId);
  }

  // ── Customer ───────────────────────────────────────────────────────────────

  async listForCustomer(
    customerId: string,
    reference: string,
  ): Promise<CustomerInvitationsResponse> {
    const first = await this.requireCustomerRequest(customerId, reference);
    // Reads settle anything whose time is up, so the list never offers an expired talent.
    await this.reconcile(first.id);
    const request = await this.requireCustomerRequest(customerId, reference);

    const [{ maxInvitations }, quote] = await Promise.all([
      this.settings.hiring(),
      this.quoter(await this.requestService(request)),
    ]);
    const now = new Date();
    const headcount = request.talentDetail?.headcount ?? 1;
    const hiredCount = request.invitations.filter(
      (i) => i.status === InvitationStatus.HIRED,
    ).length;
    const open = request.status === BookingStatus.ESKISTA_REVIEW;
    const statuses = request.invitations.map((i) => effectiveStatus(i, now));

    const phase: CustomerInvitationsResponse['phase'] =
      hiredCount > 0
        ? 'HIRED'
        : !open
          ? 'CLOSED'
          : statuses.includes(InvitationStatus.ACCEPTED)
            ? 'READY_TO_CHOOSE'
            : 'WAITING_FOR_REPLIES';

    const invitations: CustomerInvitationResponse[] = request.invitations.map((i) => {
      const status = effectiveStatus(i, now);
      return {
        id: i.id,
        talent: {
          id: i.talentProfile.id,
          displayName: i.talentProfile.displayName,
          profession: i.talentProfile.professions[0] ?? null,
          avatarUrl: talentAvatarUrl(i.talentProfile, this.storage),
          location: i.talentProfile.location,
          rating: i.talentProfile.ratingCount > 0 ? Number(i.talentProfile.ratingAvg) : null,
          reviewCount: i.talentProfile.ratingCount,
        },
        status,
        statusLabel: CUSTOMER_STATUS_LABELS[status],
        price: quote(i.talentProfile, request),
        expiresAt: i.expiresAt.toISOString(),
        respondedAt: i.respondedAt?.toISOString() ?? null,
        hiredBookingReference: i.hiredBooking?.reference ?? null,
        canHire: open && hiredCount === 0 && status === InvitationStatus.ACCEPTED,
      };
    });

    return {
      reference: request.reference,
      phase,
      headcount,
      hiredCount,
      autoHireFirstAccept: request.autoHireFirstAccept,
      selectionDeadlineAt: request.selectionDeadlineAt?.toISOString() ?? null,
      selectionHoursLeft: hoursLeft(request.selectionDeadlineAt, now),
      maxInvitations,
      canInviteMore: open && hiredCount === 0 && request.invitations.length < maxInvitations,
      invitations,
    };
  }

  /**
   * The customer's choice. Hires the named talents, rejects everyone else still in the
   * running, prices each hire and issues its two agreements.
   */
  async hire(
    customerId: string,
    reference: string,
    talentProfileIds: string[],
  ): Promise<CustomerInvitationsResponse> {
    const first = await this.requireCustomerRequest(customerId, reference);
    await this.reconcile(first.id);
    const request = await this.requireCustomerRequest(customerId, reference);

    if (request.status !== BookingStatus.ESKISTA_REVIEW) {
      throw new ConflictException('This request is no longer open for hiring');
    }
    if (request.invitations.some((i) => i.status === InvitationStatus.HIRED)) {
      throw new ConflictException('You have already hired for this request');
    }

    const headcount = request.talentDetail?.headcount ?? 1;
    const wanted = [...new Set(talentProfileIds)];
    if (wanted.length > headcount) {
      throw new BadRequestException(
        `This request is for ${headcount} ${headcount === 1 ? 'person' : 'people'}; ` +
          `you picked ${wanted.length}`,
      );
    }

    const byTalent = new Map(request.invitations.map((i) => [i.talentProfileId, i]));
    const chosen = wanted.map((id) => byTalent.get(id));
    const notAccepted = wanted.filter(
      (_id, index) => chosen[index]?.status !== InvitationStatus.ACCEPTED,
    );
    if (notAccepted.length > 0) {
      throw new ConflictException({
        message: 'You can only hire talents who have accepted this request',
        talentProfileIds: notAccepted,
      });
    }

    await this.hireInvitations(
      request.id,
      chosen.map((i) => i!.id),
      { id: customerId, role: Role.CUSTOMER },
      true,
    );
    return this.listForCustomer(customerId, reference);
  }

  /**
   * Closes the invitations when a customer cancels the request, and tells each talent.
   * Called by the customer booking service after it has cancelled the booking itself.
   */
  async cancelRequest(bookingId: string): Promise<void> {
    const open = await this.prisma.talentInvitation.findMany({
      where: { bookingId, status: { in: IN_THE_RUNNING } },
      include: {
        talentProfile: { select: { userId: true } },
        booking: { select: { startDate: true, endDate: true, projectType: true, status: true } },
      },
    });
    if (open.length === 0) return;

    await this.prisma.talentInvitation.updateMany({
      where: { id: { in: open.map((i) => i.id) } },
      data: { status: InvitationStatus.CANCELLED, decidedAt: new Date() },
    });
    await this.cancelClocks(
      bookingId,
      open.map((i) => i.id),
    );

    for (const inv of open) {
      // A talent who never saw a draft need not hear it was cancelled.
      if (inv.booking.status === BookingStatus.DRAFT) continue;
      await this.notifications.send(
        inv.talentProfile.userId,
        'HIRE_REQUEST_CANCELLED',
        {
          project: humanise(inv.booking.projectType)?.toLowerCase() ?? 'project',
          dates: formatDateRange(inv.booking.startDate, inv.booking.endDate),
        },
        { invitationId: inv.id },
      );
    }
  }

  // ── Clocks ─────────────────────────────────────────────────────────────────

  /**
   * Brings a request up to date: lapses unanswered invitations, and closes the request if
   * nobody is left or the customer ran out of time.
   *
   * Idempotent and safe to call from anywhere — the expiry jobs, every read, every answer.
   * The jobs make it timely; the reads make it correct even when a job was lost.
   */
  async reconcile(bookingId: string): Promise<void> {
    const request = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        invitations: {
          include: { talentProfile: { select: { userId: true } } },
        },
      },
    });
    if (!request || request.type !== BookingType.TALENT) return;
    if (request.status === BookingStatus.DRAFT) return;

    const now = new Date();
    const lapsed = request.invitations.filter((i) => isLapsed(i, now));
    if (lapsed.length > 0) {
      const { count } = await this.prisma.talentInvitation.updateMany({
        where: { id: { in: lapsed.map((i) => i.id) }, status: InvitationStatus.INVITED },
        data: { status: InvitationStatus.EXPIRED },
      });
      if (count > 0) {
        for (const inv of lapsed) {
          await this.notifications.send(
            inv.talentProfile.userId,
            'HIRE_REQUEST_EXPIRED',
            { dates: formatDateRange(request.startDate, request.endDate) },
            { invitationId: inv.id },
          );
        }
      }
    }

    if (request.status !== BookingStatus.ESKISTA_REVIEW) return;

    const verdict = judgeRequest(request.invitations, request.selectionDeadlineAt, now);
    if (verdict.kind === 'OPEN') return;

    // Guarded on status, so two reconciles racing each other close the request once.
    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.ESKISTA_REVIEW },
      data: { status: BookingStatus.EXPIRED },
    });
    if (count === 0) return;

    await this.prisma.bookingStatusEvent.create({
      data: {
        bookingId,
        fromStatus: BookingStatus.ESKISTA_REVIEW,
        toStatus: BookingStatus.EXPIRED,
        reason: verdict.reason,
      },
    });

    const stillAccepted = request.invitations.filter((i) => i.status === InvitationStatus.ACCEPTED);
    if (stillAccepted.length > 0) {
      await this.prisma.talentInvitation.updateMany({
        where: { id: { in: stillAccepted.map((i) => i.id) } },
        data: { status: InvitationStatus.EXPIRED, decidedAt: now },
      });
      for (const inv of stillAccepted) {
        await this.notifications.send(
          inv.talentProfile.userId,
          'HIRE_REQUEST_EXPIRED',
          { dates: formatDateRange(request.startDate, request.endDate) },
          { invitationId: inv.id },
        );
      }
    }

    await this.cancelClocks(
      bookingId,
      request.invitations.map((i) => i.id),
    );
    await this.notifications.send(
      request.customerId,
      'REQUEST_EXPIRED',
      { reason: verdict.reason, reference: request.reference },
      { bookingReference: request.reference },
    );
  }

  private async selectionReminder(bookingId: string): Promise<void> {
    const request = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        reference: true,
        customerId: true,
        status: true,
        invitations: { select: { status: true } },
      },
    });
    if (!request || request.status !== BookingStatus.ESKISTA_REVIEW) return;
    if (request.invitations.some((i) => i.status === InvitationStatus.HIRED)) return;
    if (!request.invitations.some((i) => i.status === InvitationStatus.ACCEPTED)) return;

    await this.notifications.send(
      request.customerId,
      'SELECTION_REMINDER',
      { reference: request.reference },
      { bookingReference: request.reference },
    );
  }

  // ── Hiring ─────────────────────────────────────────────────────────────────

  /**
   * Hires the given ACCEPTED invitations.
   *
   * The first hire on a request takes over the request booking itself, so a one-person hire
   * keeps the reference the customer has been looking at. Each further hire gets a sibling
   * booking of its own — same brief, dates and files — so it can carry its own price,
   * agreement, payment and payout.
   *
   * `decisive` is the customer choosing: everyone not picked is rejected at once. An
   * automatic hire only closes the rest when the headcount is full, so a request for three
   * keeps taking the first three yeses.
   */
  private async hireInvitations(
    requestId: string,
    invitationIds: string[],
    actor: Actor,
    decisive: boolean,
  ): Promise<void> {
    const request = await this.prisma.booking.findUniqueOrThrow({
      where: { id: requestId },
      include: requestInclude,
    });
    const headcount = request.talentDetail?.headcount ?? 1;
    const alreadyHired = request.invitations.filter(
      (i) => i.status === InvitationStatus.HIRED,
    ).length;

    const toHire = request.invitations
      .filter((i) => invitationIds.includes(i.id) && i.status === InvitationStatus.ACCEPTED)
      .slice(0, Math.max(headcount - alreadyHired, 0));
    if (toHire.length === 0) return;

    for (const inv of toHire) {
      const conflict = await this.scheduleConflict(
        inv.talentProfileId,
        request.startDate,
        request.endDate,
        request.id,
      );
      if (conflict) {
        throw new ConflictException(
          `${inv.talentProfile.displayName} is no longer free on those dates`,
        );
      }
    }

    const service = await this.requestService(request);
    const priced = await Promise.all(
      toHire.map((inv) => this.price(inv.talentProfile, request, service)),
    );
    const now = new Date();
    const hiredBookingIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const [index, inv] of toHire.entries()) {
        const snapshot = priced[index];
        const useRequest = alreadyHired === 0 && index === 0;

        let bookingId: string;
        if (useRequest) {
          const { count } = await tx.booking.updateMany({
            where: { id: request.id, status: BookingStatus.ESKISTA_REVIEW },
            data: {
              ...snapshot,
              talentProfileId: inv.talentProfileId,
              talentServiceId: this.serviceFor(service, inv.talentProfile),
              status: BookingStatus.AWAITING_PAYMENT,
              pricedAt: now,
              approvedAt: now,
              supplierResponse: 'ACCEPTED',
              supplierRespondedAt: inv.respondedAt ?? now,
            },
          });
          if (count === 0) throw new ConflictException('This request has already moved on');
          await tx.bookingStatusEvent.create({
            data: {
              bookingId: request.id,
              fromStatus: BookingStatus.ESKISTA_REVIEW,
              toStatus: BookingStatus.AWAITING_PAYMENT,
              actorId: actor.id,
              actorRole: actor.role,
              reason: `Hired ${inv.talentProfile.displayName}`,
            },
          });
          bookingId = request.id;
        } else {
          bookingId = await this.createSibling(tx, request, inv, snapshot, service, actor, now);
        }

        await tx.talentInvitation.update({
          where: { id: inv.id },
          data: { status: InvitationStatus.HIRED, decidedAt: now, hiredBookingId: bookingId },
        });
        hiredBookingIds.push(bookingId);
      }
    });

    const hiredTotal = alreadyHired + toHire.length;
    const closeTheRest = decisive || hiredTotal >= headcount;
    const rejected = closeTheRest
      ? request.invitations.filter(
          (i) => IN_THE_RUNNING.includes(i.status) && !toHire.some((h) => h.id === i.id),
        )
      : [];

    if (rejected.length > 0) {
      await this.prisma.talentInvitation.updateMany({
        where: { id: { in: rejected.map((i) => i.id) }, status: { in: IN_THE_RUNNING } },
        data: { status: InvitationStatus.REJECTED, decidedAt: now },
      });
    }
    if (closeTheRest) {
      await this.cancelClocks(
        request.id,
        request.invitations.map((i) => i.id),
      );
    }

    // Agreements after the commit: issuing writes the frozen text to storage, which cannot
    // roll back with the transaction. A failure here leaves a hired booking without its
    // paperwork, which Eskista can re-issue — not a hire that silently never happened.
    for (const bookingId of hiredBookingIds) {
      try {
        await this.agreements.issueForBooking(bookingId);
        await this.agreements.issueTalentService(bookingId);
      } catch (error) {
        this.logger.error(`Could not issue agreements for ${bookingId}: ${String(error)}`);
      }
    }

    await this.announceOutcome(request, toHire, hiredBookingIds, rejected, actor);

    const hired = await this.prisma.booking.findMany({
      where: { id: { in: hiredBookingIds } },
      select: {
        reference: true,
        customer: { select: { name: true } },
        talentProfile: { select: { displayName: true } },
      },
    });
    for (const h of hired) {
      await this.notifications.notifyAdmins(
        'ADMIN_TALENT_HIRED',
        {
          customer: h.customer.name,
          talent: h.talentProfile?.displayName ?? 'a talent',
          reference: h.reference,
        },
        { bookingReference: h.reference },
        [AdminTier.ADMIN],
      );
    }
  }

  private async createSibling(
    tx: Prisma.TransactionClient,
    request: RequestRow,
    inv: RequestRow['invitations'][number],
    snapshot: PricedSnapshot,
    service: RequestService,
    actor: Actor,
    now: Date,
  ): Promise<string> {
    const reference = await this.numbering.nextTalentBookingReference(tx);
    const d = request.talentDetail;

    const sibling = await tx.booking.create({
      data: {
        ...snapshot,
        reference,
        type: BookingType.TALENT,
        customerId: request.customerId,
        talentProfileId: inv.talentProfileId,
        talentServiceId: this.serviceFor(service, inv.talentProfile),
        parentBookingId: request.id,
        startDate: request.startDate,
        endDate: request.endDate,
        contactPhone: request.contactPhone,
        additionalPhone: request.additionalPhone,
        projectDescription: request.projectDescription,
        projectType: request.projectType,
        status: BookingStatus.AWAITING_PAYMENT,
        pricedAt: now,
        approvedAt: now,
        supplierResponse: 'ACCEPTED',
        supplierRespondedAt: inv.respondedAt ?? now,
        talentDetail: d
          ? {
              create: {
                eventLocation: d.eventLocation,
                city: d.city,
                venue: d.venue,
                locationNotes: d.locationNotes,
                engagementModel: d.engagementModel,
                startTime: d.startTime,
                endTime: d.endTime,
                requirements: d.requirements,
                headcount: d.headcount,
                budgetBand: d.budgetBand,
                budgetMinor: d.budgetMinor,
              },
            }
          : undefined,
      },
    });

    // Copy the request's history so the sibling's timeline shows when it was submitted.
    const history = await tx.bookingStatusEvent.findMany({
      where: { bookingId: request.id },
      orderBy: { createdAt: 'asc' },
    });
    await tx.bookingStatusEvent.createMany({
      data: [
        ...history.map((e) => ({
          bookingId: sibling.id,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          actorId: e.actorId,
          actorRole: e.actorRole,
          reason: e.reason,
          createdAt: e.createdAt,
        })),
        {
          bookingId: sibling.id,
          fromStatus: BookingStatus.ESKISTA_REVIEW,
          toStatus: BookingStatus.AWAITING_PAYMENT,
          actorId: actor.id,
          actorRole: actor.role,
          reason: `Hired ${inv.talentProfile.displayName} (from ${request.reference})`,
          createdAt: now,
        },
      ],
    });

    return sibling.id;
  }

  private async announceOutcome(
    request: RequestRow,
    hired: RequestRow['invitations'],
    hiredBookingIds: string[],
    rejected: RequestRow['invitations'],
    actor: Actor,
  ): Promise<void> {
    const dates = formatDateRange(request.startDate, request.endDate);
    const project = humanise(request.projectType)?.toLowerCase() ?? 'project';
    const refs = await this.prisma.booking.findMany({
      where: { id: { in: hiredBookingIds } },
      select: { id: true, reference: true },
    });
    const refOf = (index: number) =>
      refs.find((r) => r.id === hiredBookingIds[index])?.reference ?? request.reference;

    for (const [index, inv] of hired.entries()) {
      await this.notifications.send(
        inv.talentProfile.userId,
        'YOU_WERE_HIRED',
        { reference: refOf(index), dates },
        { bookingReference: refOf(index), invitationId: inv.id },
      );
      // An automatic hire happened without the customer, so tell them; a customer who just
      // pressed Hire does not need a notification about it.
      if (actor.role !== Role.CUSTOMER) {
        await this.notifications.send(
          request.customerId,
          'TALENT_HIRED_CONFIRMATION',
          { talent: inv.talentProfile.displayName, reference: refOf(index) },
          { bookingReference: refOf(index) },
        );
      }
    }
    for (const inv of rejected) {
      await this.notifications.send(
        inv.talentProfile.userId,
        'NOT_SELECTED',
        { project, dates },
        { invitationId: inv.id },
      );
    }
  }

  // ── Pricing ────────────────────────────────────────────────────────────────

  /**
   * The priced snapshot for hiring one talent on this request.
   *
   * The talent's own fixed rate — the request's chosen service if it is theirs, otherwise
   * their base rate — marked up by their commission and VAT exactly like equipment.
   */
  private async price(
    talent: TalentProfile,
    request: RequestRow,
    service: RequestService,
  ): Promise<PricedSnapshot> {
    const { rate, model } = this.rateFor(talent, service);
    if (rate === null) {
      throw new ConflictException(
        `${talent.displayName} has no rate on file, so this hire cannot be priced. ` +
          'Contact Eskista.',
      );
    }
    const periods = talentPeriods(
      model,
      request.startDate,
      request.endDate,
      request.talentDetail?.startTime,
      request.talentDetail?.endTime,
    );
    const [{ commissionRateBps, taxRateBps }, serviceFeeRateBps] = await Promise.all([
      this.pricing.rates({ talentBps: talent.commissionRateBps }),
      this.settings.serviceFeeBps(),
    ]);
    const b = computePriceBreakdown(
      { supplierUnitPriceMinor: rate, periods, taxRateBps, serviceFeeRateBps, commissionRateBps },
      talent.currency,
    );
    return {
      periods,
      currency: b.currency,
      unitPriceMinor: b.unitPriceMinor,
      subtotalMinor: b.subtotalMinor,
      deliveryFeeMinor: b.deliveryFeeMinor,
      securityDepositMinor: b.securityDepositMinor,
      discountMinor: b.discountMinor,
      taxRateBps: b.taxRateBps,
      taxMinor: b.taxMinor,
      serviceFeeRateBps: b.serviceFeeRateBps,
      serviceFeeMinor: b.serviceFeeMinor,
      totalMinor: b.totalMinor,
      commissionRateBps: b.commissionRateBps,
      commissionMinor: b.commissionMinor,
      supplierEarningsMinor: b.supplierEarningsMinor,
    };
  }

  /**
   * A synchronous per-talent quote for the invitation list, with the platform rates read
   * once for the whole list. Uses the same arithmetic as the hire, so the price beside a
   * talent is the price the booking gets.
   */
  private async quoter(
    service: RequestService,
  ): Promise<(talent: TalentProfile, request: RequestRow) => InvitationPriceResponse | null> {
    const [defaultBps, taxRateBps, serviceFeeRateBps] = await Promise.all([
      this.settings.commissionBps(),
      this.settings.vatBps(),
      this.settings.serviceFeeBps(),
    ]);
    return (talent, request) => {
      const { rate, model } = this.rateFor(talent, service);
      if (rate === null) return null;
      const periods = talentPeriods(
        model,
        request.startDate,
        request.endDate,
        request.talentDetail?.startTime,
        request.talentDetail?.endTime,
      );
      const b = computePriceBreakdown(
        {
          supplierUnitPriceMinor: rate,
          periods,
          taxRateBps,
          serviceFeeRateBps,
          commissionRateBps: talent.commissionRateBps ?? defaultBps,
        },
        talent.currency,
      );
      return {
        currency: b.currency,
        totalMinor: b.totalMinor,
        unitPriceMinor: b.unitPriceMinor,
        pricingModel: model,
        periods,
        taxNote: taxRateBps > 0 ? `Inc. ${(taxRateBps / 100).toFixed(0)}% VAT` : '',
      };
    };
  }

  /** The service picked on the request, if any. It belongs to one talent at most. */
  private async requestService(request: { talentServiceId: string | null }) {
    if (!request.talentServiceId) return null;
    return this.prisma.talentService.findFirst({
      where: { id: request.talentServiceId, isActive: true },
      select: { id: true, talentProfileId: true, priceMinor: true, pricingModel: true },
    });
  }

  private rateFor(
    talent: TalentProfile,
    service: RequestService,
  ): { rate: number | null; model: TalentProfile['pricingModel'] } {
    if (service && service.talentProfileId === talent.id) {
      return { rate: service.priceMinor, model: service.pricingModel };
    }
    return { rate: talent.baseRateMinor, model: talent.pricingModel };
  }

  /** The request's chosen service carries over only to the talent who offers it. */
  private serviceFor(service: RequestService, talent: TalentProfile): string | null {
    return service && service.talentProfileId === talent.id ? service.id : null;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Notifies newly invited talents and starts each one's answer clock. */
  private async announce(
    bookingId: string,
    invitationIds: string[],
    ttlHours: number,
    expiresAt: Date,
  ): Promise<void> {
    const invitations = await this.prisma.talentInvitation.findMany({
      where: { id: { in: invitationIds } },
      include: {
        talentProfile: { select: { userId: true } },
        booking: { select: { startDate: true, endDate: true, projectType: true } },
      },
    });

    for (const inv of invitations) {
      await this.notifications.send(
        inv.talentProfile.userId,
        'HIRE_REQUEST_RECEIVED',
        {
          project: humanise(inv.booking.projectType)?.toLowerCase() ?? 'project',
          dates: formatDateRange(inv.booking.startDate, inv.booking.endDate),
          hours: String(ttlHours),
        },
        { invitationId: inv.id },
      );
      await this.jobs.scheduleAt(
        JOB_NAMES.invitationExpiry,
        { bookingId },
        expiresAt,
        jobIdFor(JOB_NAMES.invitationExpiry, inv.id),
      );
    }
  }

  private async cancelClocks(bookingId: string, invitationIds: string[]): Promise<void> {
    await Promise.all([
      this.jobs.cancel(jobIdFor(JOB_NAMES.selectionDeadline, bookingId)),
      this.jobs.cancel(jobIdFor(JOB_NAMES.selectionReminder, bookingId)),
      ...invitationIds.map((id) => this.jobs.cancel(jobIdFor(JOB_NAMES.invitationExpiry, id))),
    ]);
  }

  /**
   * Why a talent cannot take these dates, or null if they can: a committed engagement or a
   * range they blocked themselves.
   */
  async scheduleConflict(
    talentProfileId: string,
    startDate: Date,
    endDate: Date,
    excludeRequestId: string,
  ): Promise<string | null> {
    const [booked, blocked] = await Promise.all([
      this.prisma.booking.count({
        where: {
          talentProfileId,
          status: { in: TALENT_COMMITTED },
          // Only `id`: a `not` on the nullable parent column would also drop every row
          // whose parent is NULL, which is nearly all of them.
          id: { not: excludeRequestId },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      this.prisma.talentBlockedDateRange.count({
        where: { talentProfileId, startDate: { lte: endDate }, endDate: { gte: startDate } },
      }),
    ]);
    if (booked > 0) return 'You are already booked on some of these dates';
    if (blocked > 0) return 'You have blocked some of these dates in your availability';
    return null;
  }

  private async assertAnswerable(inv: {
    status: InvitationStatus;
    expiresAt: Date;
    bookingId: string;
    booking: { status: BookingStatus };
  }): Promise<void> {
    if (isLapsed(inv, new Date())) {
      await this.reconcile(inv.bookingId);
      throw new ConflictException('This request has expired');
    }
    if (inv.booking.status !== BookingStatus.ESKISTA_REVIEW) {
      throw new ConflictException('This request is no longer open');
    }
    if (inv.status !== InvitationStatus.INVITED) {
      throw new ConflictException(
        `You have already answered this request (${inv.status.toLowerCase()})`,
      );
    }
  }

  private async requireOwnInvitation(userId: string, invitationId: string) {
    const inv = await this.prisma.talentInvitation.findFirst({
      where: {
        id: invitationId,
        talentProfile: { userId },
        booking: { status: { not: BookingStatus.DRAFT } },
      },
      include: {
        talentProfile: true,
        booking: {
          select: {
            id: true,
            reference: true,
            customerId: true,
            status: true,
            startDate: true,
            endDate: true,
            autoHireFirstAccept: true,
            selectionDeadlineAt: true,
          },
        },
      },
    });
    if (!inv) throw new NotFoundException('Request not found');
    return inv;
  }

  private async requireCustomerRequest(customerId: string, reference: string) {
    const request = await this.prisma.booking.findFirst({
      where: { reference, customerId, type: BookingType.TALENT },
      include: requestInclude,
    });
    if (!request) throw new NotFoundException('Booking not found');
    if (request.parentBookingId) {
      throw new BadRequestException(
        `Invitations belong to the original request; open the parent booking instead`,
      );
    }
    return request;
  }
}

/** A talent a customer can invite: approved, and taking work. */
export const BOOKABLE_TALENT: Prisma.TalentProfileWhereInput = {
  status: VerificationStatus.VERIFIED,
  isAvailableForHire: true,
};
