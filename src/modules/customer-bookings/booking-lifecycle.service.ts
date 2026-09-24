import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementStatus,
  BookingStatus,
  FulfilmentDirection,
  FulfilmentMethod,
  IncidentStatus,
  PaymentStatus,
  ReviewKind,
  Role,
  type Booking,
} from '@prisma/client';
import {
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
} from '../../common/upload';
import type { UploadedFile } from '../../common/upload';
import { AgreementsService } from '../agreements/agreements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JOB_NAMES, jobIdFor } from '../jobs/jobs.constants';
import { JobsService } from '../jobs/jobs.service';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import {
  CustomerAgreementBodyResponse,
  CustomerAgreementResponse,
  DeclineAgreementDto,
  IncidentResponse,
  PaymentInstructionsResponse,
  ReportIncidentDto,
  ReturnOptionsResponse,
  ReviewResponse,
  ScheduleReturnDto,
  SubmitPaymentDto,
  SubmitReviewDto,
  UploadSignedCopyDto,
} from './dto/lifecycle.dto';

/** Statuses where the customer physically holds the equipment, so a return makes sense. */
const RETURNABLE: BookingStatus[] = [
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];

/** Statuses where something has actually happened that could go wrong. */
const REPORTABLE: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
  BookingStatus.SETTLEMENT,
  BookingStatus.CLOSED,
];

const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  DRAFT: 'Draft',
  AWAITING_UPLOAD: 'Awaiting Upload',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DECLINED: 'Declined',
  VOID: 'Void',
};

const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  REPORTED: 'Reported',
  UNDER_REVIEW: 'Under Review',
  RESOLVED: 'Resolved',
  DISMISSED: 'Closed',
};

const DEFAULT_RETURN_INSTRUCTIONS = [
  'Pack all included items and accessories.',
  'Ensure batteries and memory cards are returned.',
  'Equipment will be inspected on receipt.',
];

/**
 * The second half of a booking's life: agreement, payment, return, incidents, review.
 *
 * Everything here is keyed by the customer-facing reference and scoped to the signed-in
 * customer, so a reference belonging to someone else is indistinguishable from one that
 * does not exist.
 */
@Injectable()
export class BookingLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly agreements: AgreementsService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── Agreements ─────────────────────────────────────────────────────────────

  async listAgreements(userId: string, reference: string): Promise<CustomerAgreementResponse[]> {
    const booking = await this.requireBooking(userId, reference);

    const rows = await this.prisma.agreement.findMany({
      where: { bookingId: booking.id, counterpartyId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((a) => this.toAgreement(a, booking.reference));
  }

  /** The agreement with its frozen text, for the read-and-download screen. */
  async getAgreement(
    userId: string,
    reference: string,
    agreementId: string,
  ): Promise<CustomerAgreementBodyResponse> {
    const booking = await this.requireBooking(userId, reference);

    const agreement = await this.prisma.agreement.findFirst({
      where: { id: agreementId, bookingId: booking.id, counterpartyId: userId },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');

    return {
      ...this.toAgreement(agreement, booking.reference),
      body: await this.agreements.getBody(agreement.id, userId),
    };
  }

  /**
   * Accepts the customer's scan of the hand-signed contract.
   *
   * The file is stored under the booking, so both parties and Eskista can read it and
   * nobody else can.
   */
  async uploadSignedAgreement(
    userId: string,
    reference: string,
    agreementId: string,
    dto: UploadSignedCopyDto,
    file: UploadedFile | undefined,
  ): Promise<CustomerAgreementResponse> {
    const booking = await this.requireBooking(userId, reference);

    const valid = assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.receipt,
      field: 'signedAgreement',
    });

    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `bookings/${booking.reference}/agreements/signed`,
    });

    const updated = await this.agreements.uploadSignedCopy(agreementId, userId, {
      signerName: dto.signerName,
      signerPhone: dto.signerPhone,
      fileKey: stored.key,
      fileName: valid.originalname,
      mimeType: valid.mimetype,
      sizeBytes: valid.size,
    });

    return this.toAgreement(updated, booking.reference);
  }

  async declineAgreement(
    userId: string,
    reference: string,
    agreementId: string,
    dto: DeclineAgreementDto,
  ): Promise<CustomerAgreementResponse> {
    const booking = await this.requireBooking(userId, reference);
    const updated = await this.agreements.decline(agreementId, userId, dto.reason);
    return this.toAgreement(updated, booking.reference);
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  /**
   * Where to send the money, and how much.
   *
   * The accounts come from platform settings rather than the codebase: Eskista changes
   * banks without a deploy, and a hardcoded account number is how customers end up paying
   * into a closed account.
   */
  async getPaymentInstructions(
    userId: string,
    reference: string,
  ): Promise<PaymentInstructionsResponse> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      include: {
        listing: { select: { name: true } },
        talentProfile: { select: { displayName: true } },
        payments: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const accounts = await this.settings.paymentAccounts();
    const telebirr = this.readTelebirr(accounts);
    const bank = this.readBank(accounts);

    const verified = booking.payments
      .filter((p) => p.status === PaymentStatus.VERIFIED)
      .reduce((sum, p) => sum + p.amountMinor, 0);
    const pending = booking.payments.some((p) => p.status === PaymentStatus.SUBMITTED);

    const blockedReason = this.paymentBlocker(booking.status, pending);

    return {
      bookingReference: booking.reference,
      itemName: booking.listing?.name ?? booking.talentProfile?.displayName ?? 'Booking',
      startDate: booking.startDate.toISOString().slice(0, 10),
      endDate: booking.endDate.toISOString().slice(0, 10),
      currency: booking.currency,
      amountDueMinor: booking.totalMinor + booking.securityDepositMinor,
      amountPaidMinor: verified,
      telebirr,
      bank,
      canSubmit: blockedReason === null,
      blockedReason,
    };
  }

  /**
   * Records proof of an offline transfer.
   *
   * Eskista verifies it separately — nothing here confirms the booking. Deliberately does
   * **not** check the amount matches: a customer who transferred the wrong figure needs
   * Eskista to see the receipt and sort it out, not a 400 that leaves them with money sent
   * and no record of it.
   */
  async submitPayment(
    userId: string,
    reference: string,
    dto: SubmitPaymentDto,
    file: UploadedFile | undefined,
  ): Promise<{ id: string; status: PaymentStatus; submittedAt: string }> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      include: { payments: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const pending = booking.payments.some((p) => p.status === PaymentStatus.SUBMITTED);
    const blocker = this.paymentBlocker(booking.status, pending);
    if (blocker) throw new ConflictException(blocker);

    const valid = assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.receipt,
      field: 'receipt',
    });

    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `bookings/${booking.reference}/payments`,
    });

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          bookingId: booking.id,
          method: dto.method,
          transactionReference: dto.transactionReference,
          amountMinor: dto.amountMinor,
          currency: booking.currency,
          receiptFileKey: stored.key,
          receiptFileName: valid.originalname,
          receiptMimeType: valid.mimetype,
          receiptSizeBytes: valid.size,
          status: PaymentStatus.SUBMITTED,
        },
      });

      await tx.bookingStatusEvent.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: booking.status,
          actorId: userId,
          actorRole: Role.CUSTOMER,
          reason: 'Payment evidence submitted',
        },
      });

      return created;
    });

    // Deliberately no notification here. The customer just pressed the button; telling
    // them what they did is noise. "Payment Verified" is Eskista's to send, once they
    // have actually checked it.

    return {
      id: payment.id,
      status: payment.status,
      submittedAt: payment.submittedAt.toISOString(),
    };
  }

  // ── Return scheduling ──────────────────────────────────────────────────────

  async getReturnOptions(userId: string, reference: string): Promise<ReturnOptionsResponse> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      include: { equipmentDetail: true, fulfilments: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const [times, instructions] = await Promise.all([
      this.settings.returnSlotTimes(),
      this.settings.returnInstructions(),
    ]);

    const outbound = booking.fulfilments.find((f) => f.direction === FulfilmentDirection.OUTBOUND);

    return {
      bookingReference: booking.reference,
      dueAt: booking.dueAt?.toISOString() ?? null,
      slots: this.buildSlots(times, booking.endDate, booking.dueAt),
      instructions: instructions.length > 0 ? instructions : DEFAULT_RETURN_INSTRUCTIONS,
      suggestedAddress: outbound?.address ?? booking.equipmentDetail?.deliveryAddress ?? null,
    };
  }

  /**
   * Books the return.
   *
   * Idempotent by design: re-scheduling replaces the existing arrangement rather than
   * creating a second one, because a customer changing their mind is ordinary and two
   * open return jobs for one booking would confuse operations.
   */
  async scheduleReturn(
    userId: string,
    reference: string,
    dto: ScheduleReturnDto,
  ): Promise<ReturnOptionsResponse> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      select: { id: true, status: true, reference: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (!RETURNABLE.includes(booking.status)) {
      throw new ConflictException('A return can only be arranged once the equipment is with you.');
    }

    const method =
      dto.method === 'DROP_OFF' ? FulfilmentMethod.DROP_OFF : FulfilmentMethod.SCHEDULED_PICKUP;

    if (method === FulfilmentMethod.SCHEDULED_PICKUP && !dto.address) {
      throw new BadRequestException('address is required when Eskista collects the equipment');
    }

    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid ISO date-time');
    }

    // A first arrangement is always news; a repeat only if something moved.
    let changed = true;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.fulfilment.findFirst({
        where: { bookingId: booking.id, direction: FulfilmentDirection.RETURN },
      });

      if (existing) {
        // Only worth telling the customer if the arrangement actually moved. Re-submitting
        // the same slot — a double tap, a retried request — should not notify them twice.
        changed =
          existing.method !== method ||
          existing.scheduledAt?.getTime() !== scheduledAt.getTime() ||
          (existing.address ?? null) !== (dto.address ?? null);

        await tx.fulfilment.update({
          where: { id: existing.id },
          data: { method, scheduledAt, address: dto.address, notes: dto.notes },
        });
      } else {
        await tx.fulfilment.create({
          data: {
            bookingId: booking.id,
            direction: FulfilmentDirection.RETURN,
            method,
            scheduledAt,
            address: dto.address,
            notes: dto.notes,
          },
        });
      }

      if (booking.status !== BookingStatus.RETURN_SCHEDULED) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.RETURN_SCHEDULED },
        });
        await tx.bookingStatusEvent.create({
          data: {
            bookingId: booking.id,
            fromStatus: booking.status,
            toStatus: BookingStatus.RETURN_SCHEDULED,
            actorId: userId,
            actorRole: Role.CUSTOMER,
          },
        });
      }
    });

    // The reminder exists to nudge someone who has not arranged a return. They just
    // have, so sending it tomorrow would be an annoyance rather than a service.
    await this.jobs.cancel(jobIdFor(JOB_NAMES.returnReminder, booking.id));

    if (changed) {
      await this.notifications.send(
        userId,
        'RETURN_SCHEDULED',
        {
          reference: booking.reference,
          when: scheduledAt.toISOString().slice(0, 16).replace('T', ' '),
        },
        { bookingReference: booking.reference },
      );
    }

    return this.getReturnOptions(userId, reference);
  }

  // ── Incidents ──────────────────────────────────────────────────────────────

  /**
   * Files a problem report.
   *
   * Routed to Eskista, never to the vendor — the screen says so explicitly, and the whole
   * operating model is that Eskista is the customer's only counterparty.
   */
  async reportIncident(
    userId: string,
    reference: string,
    dto: ReportIncidentDto,
    files: UploadedFile[],
  ): Promise<IncidentResponse> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      select: { id: true, reference: true, status: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (!REPORTABLE.includes(booking.status)) {
      throw new ConflictException('An issue can only be reported once the booking is confirmed.');
    }

    if (files.length > 6) {
      throw new BadRequestException('At most 6 photos may be attached to one report');
    }
    for (const file of files) {
      assertValidFile(file, {
        allowed: IMAGE_MIME_TYPES,
        maxBytes: UPLOAD_LIMITS.image,
        field: 'photos',
      });
    }

    const stored = await Promise.all(
      files.map((file) =>
        this.storage.put({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder: `bookings/${booking.reference}/incidents`,
        }),
      ),
    );

    const incidentReference = await this.numbering.nextIncidentReference();

    const incident = await this.prisma.incident.create({
      data: {
        reference: incidentReference,
        bookingId: booking.id,
        reportedById: userId,
        type: dto.type,
        phase: dto.phase,
        description: dto.description,
        status: IncidentStatus.REPORTED,
        photos: {
          create: stored.map((s, index) => ({ fileKey: s.key, sortOrder: index })),
        },
      },
      include: { photos: { orderBy: { sortOrder: 'asc' } } },
    });

    await this.notifications.send(
      userId,
      'INCIDENT_RECEIVED',
      { reference: incident.reference },
      { bookingReference: booking.reference, incidentReference: incident.reference },
    );

    return this.toIncident(incident);
  }

  async listIncidents(userId: string, reference: string): Promise<IncidentResponse[]> {
    const booking = await this.requireBooking(userId, reference);

    const rows = await this.prisma.incident.findMany({
      where: { bookingId: booking.id, reportedById: userId },
      include: { photos: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((i) => this.toIncident(i));
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  /**
   * Rates the completed booking.
   *
   * Only once, and only after it closes — rating equipment still in your hands rates an
   * experience that has not finished. Writing the review also updates the aggregate on the
   * listing and the supplier, in the same transaction, so the catalogue never shows a star
   * count that disagrees with the reviews behind it.
   */
  async submitReview(
    userId: string,
    reference: string,
    dto: SubmitReviewDto,
  ): Promise<ReviewResponse> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
      include: { reviews: { where: { authorId: userId } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.status !== BookingStatus.CLOSED) {
      throw new ConflictException('You can rate a booking once it is completed.');
    }
    if (booking.reviews.length > 0) {
      throw new ConflictException('You have already rated this booking.');
    }

    const kind = booking.talentProfileId ? ReviewKind.TALENT : ReviewKind.EQUIPMENT;

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          bookingId: booking.id,
          kind,
          authorId: userId,
          listingId: booking.listingId,
          vendorId: booking.vendorId,
          talentProfileId: booking.talentProfileId,
          rating: dto.rating,
          comment: dto.comment,
        },
      });

      // Recompute from the reviews themselves rather than nudging a running average:
      // an incremental update drifts the moment one review is hidden or deleted.
      if (booking.listingId) {
        await this.refreshListingRating(tx, booking.listingId);
      }
      if (booking.talentProfileId) {
        await this.refreshTalentRating(tx, booking.talentProfileId);
      }

      return created;
    });

    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt.toISOString(),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async requireBooking(userId: string, reference: string): Promise<Booking> {
    const booking = await this.prisma.booking.findFirst({
      where: { reference, customerId: userId },
    });
    // 404 rather than 403: another customer's reference is not confirmable.
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** Why payment cannot be submitted right now, or null when it can. */
  private paymentBlocker(status: BookingStatus, hasPending: boolean): string | null {
    if (status === BookingStatus.DRAFT) {
      return 'Submit your request before paying.';
    }
    if (status === BookingStatus.REQUEST_SUBMITTED || status === BookingStatus.ESKISTA_REVIEW) {
      return 'Eskista is still reviewing your request.';
    }
    if (
      status === BookingStatus.CANCELLED ||
      status === BookingStatus.REJECTED ||
      status === BookingStatus.EXPIRED
    ) {
      return 'This booking is closed.';
    }
    if (hasPending) {
      return 'Eskista is verifying your previous payment.';
    }
    return null;
  }

  /**
   * Turns the configured times into concrete slots on the return day.
   *
   * A slot past the return deadline is returned but marked unavailable, rather than
   * hidden — a customer who has already missed the deadline should see why the option is
   * closed rather than wonder where it went.
   */
  private buildSlots(
    times: string[],
    endDate: Date,
    dueAt: Date | null,
  ): ReturnOptionsResponse['slots'] {
    const day = endDate.toISOString().slice(0, 10);

    return times.map((time) => {
      const startsAt = new Date(`${day}T${time}:00.000Z`);
      const available = dueAt ? startsAt <= dueAt : true;

      return {
        startsAt: startsAt.toISOString(),
        label: `${this.formatDay(startsAt)} · ${time}`,
        available,
      };
    });
  }

  private formatDay(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  private readTelebirr(accounts: Record<string, unknown>): PaymentInstructionsResponse['telebirr'] {
    const raw = accounts.telebirr;
    if (typeof raw !== 'object' || raw === null) return null;
    const { number, accountName } = raw as Record<string, unknown>;
    if (typeof number !== 'string' || typeof accountName !== 'string') return null;
    return { number, accountName };
  }

  private readBank(accounts: Record<string, unknown>): PaymentInstructionsResponse['bank'] {
    const raw = accounts.bank;
    if (typeof raw !== 'object' || raw === null) return null;
    const { bank, accountName, accountNumber } = raw as Record<string, unknown>;
    if (
      typeof bank !== 'string' ||
      typeof accountName !== 'string' ||
      typeof accountNumber !== 'string'
    ) {
      return null;
    }
    return { bank, accountName, accountNumber };
  }

  private toAgreement(
    a: {
      id: string;
      kind: CustomerAgreementResponse['kind'];
      status: AgreementStatus;
      version: number;
      contentHash: string | null;
      documentKey: string | null;
      scannedCopyKey: string | null;
      signerName: string | null;
      sentAt: Date | null;
      uploadedAt: Date | null;
      reviewedAt: Date | null;
      rejectionReason: string | null;
    },
    bookingReference: string,
  ): CustomerAgreementResponse {
    return {
      id: a.id,
      kind: a.kind,
      status: a.status,
      statusLabel: AGREEMENT_STATUS_LABELS[a.status],
      bookingReference,
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

  private toIncident(incident: {
    reference: string;
    type: IncidentResponse['type'];
    phase: IncidentResponse['phase'];
    status: IncidentStatus;
    description: string;
    resolution: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    photos: { id: string; fileKey: string }[];
  }): IncidentResponse {
    return {
      reference: incident.reference,
      type: incident.type,
      phase: incident.phase,
      status: incident.status,
      statusLabel: INCIDENT_STATUS_LABELS[incident.status],
      description: incident.description,
      resolution: incident.resolution,
      photos: incident.photos.map((p) => ({ id: p.id, url: this.storage.urlFor(p.fileKey) })),
      createdAt: incident.createdAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    };
  }

  private async refreshListingRating(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    listingId: string,
  ): Promise<void> {
    const agg = await tx.review.aggregate({
      where: { listingId, isPublished: true },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await tx.listing.update({
      where: { id: listingId },
      data: {
        ratingAvg: agg._avg.rating ?? 0,
        ratingCount: agg._count.rating,
      },
    });
  }

  private async refreshTalentRating(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    talentProfileId: string,
  ): Promise<void> {
    const agg = await tx.review.aggregate({
      where: { talentProfileId, isPublished: true },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await tx.talentProfile.update({
      where: { id: talentProfileId },
      data: {
        ratingAvg: agg._avg.rating ?? 0,
        ratingCount: agg._count.rating,
      },
    });
  }
}
