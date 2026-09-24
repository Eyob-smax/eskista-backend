import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  BookingType,
  CollectionMethod,
  ListingStatus,
  PricingModel,
  Prisma,
  Role,
  VerificationStatus,
} from '@prisma/client';
import { billablePeriods, computePriceBreakdown, workingDays } from '../../common/money';
import { CustomerService } from '../customer/customer.service';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../settings/pricing.service';
import { SettingsService } from '../settings/settings.service';
import {
  DraftResponse,
  UpsertEquipmentRequestDto,
  UpsertTalentRequestDto,
} from './dto/request.dto';

/** Bookings that hold stock, and therefore block a new one over the same dates. */
const HOLDING_STATUSES: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];

/**
 * Drafting, pricing and submitting a booking request.
 *
 * A draft is the same `Booking` row it will become (AD-6), so it keeps one reference for
 * its whole life and a customer who saves a draft sees the same number on the confirmation
 * screen. Drafts are excluded from every availability calculation — an unsubmitted enquiry
 * must never block anyone else's booking.
 */
@Injectable()
export class BookingRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly numbering: NumberingService,
    private readonly customers: CustomerService,
  ) {}

  // ── Equipment ──────────────────────────────────────────────────────────────

  async createEquipmentDraft(
    userId: string,
    dto: UpsertEquipmentRequestDto,
  ): Promise<DraftResponse> {
    const reference = await this.numbering.nextBookingReference();

    const booking = await this.prisma.booking.create({
      data: {
        reference,
        type: BookingType.EQUIPMENT,
        customerId: userId,
        status: BookingStatus.DRAFT,
        // A draft has no agreed dates yet; today is a placeholder the submit step replaces.
        startDate: new Date(),
        endDate: new Date(),
        periods: 1,
        contactPhone: dto.contactPhone ?? '',
        // Nothing is priced until submission — a draft total would be a promise the
        // catalogue price could break the next day.
        unitPriceMinor: 0,
        subtotalMinor: 0,
        totalMinor: 0,
        commissionRateBps: 0,
        commissionMinor: 0,
        supplierEarningsMinor: 0,
        equipmentDetail: { create: { quantity: 1, collectionMethod: CollectionMethod.DELIVERY } },
      },
    });

    return this.updateEquipmentDraft(userId, booking.id, dto);
  }

  async updateEquipmentDraft(
    userId: string,
    bookingId: string,
    dto: UpsertEquipmentRequestDto,
  ): Promise<DraftResponse> {
    const draft = await this.requireDraft(userId, bookingId, BookingType.EQUIPMENT);

    const listingId = dto.listingId ?? draft.listingId ?? undefined;
    const listing = listingId ? await this.findBookableListing(listingId) : null;

    const startDate = dto.startDate ? this.parseDate(dto.startDate, 'startDate') : draft.startDate;
    const endDate = dto.endDate ? this.parseDate(dto.endDate, 'endDate') : draft.endDate;
    if (endDate < startDate) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        listingId: listing?.id,
        vendorId: listing?.vendorId,
        startDate,
        endDate,
        periods: billablePeriods(startDate, endDate),
        unitPriceMinor: listing?.rentalPriceMinor ?? draft.unitPriceMinor,
        projectDescription: dto.projectDescription,
        contactPhone: dto.contactPhone ?? draft.contactPhone,
        additionalPhone: dto.additionalPhone,
        equipmentDetail: {
          update: {
            quantity: dto.quantity,
            collectionMethod: dto.collectionMethod,
            deliveryAddress: dto.deliveryAddress ?? dto.productionLocation,
            deliveryNotes: dto.deliveryNotes,
          },
        },
      },
      include: { equipmentDetail: true, listing: true },
    });

    return this.toDraftResponse(updated, await this.equipmentGaps(updated));
  }

  /**
   * Prices the request, freezes the snapshot and hands it to Eskista for review.
   *
   * Pricing happens exactly once, here, using the same `computePriceBreakdown` the quote
   * endpoint uses. From this point the figures are frozen: a later price change on the
   * listing must not rewrite what the customer agreed to.
   */
  async submit(userId: string, bookingId: string): Promise<DraftResponse> {
    const draft = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId: userId },
      include: { equipmentDetail: true, talentDetail: true, listing: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== BookingStatus.DRAFT) {
      throw new ConflictException('This request has already been submitted');
    }

    const gaps =
      draft.type === BookingType.EQUIPMENT
        ? await this.equipmentGaps(draft)
        : await this.talentGaps(draft);

    if (gaps.length > 0) {
      throw new BadRequestException({
        message: 'This request is not ready to submit',
        outstandingRequirements: gaps,
      });
    }

    const priced =
      draft.type === BookingType.EQUIPMENT
        ? await this.priceEquipment(draft)
        : await this.priceTalent(draft);

    const [updated] = await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          ...priced,
          status: BookingStatus.REQUEST_SUBMITTED,
          pricedAt: new Date(),
        },
        include: { equipmentDetail: true, listing: true },
      }),
      this.prisma.bookingStatusEvent.create({
        data: {
          bookingId,
          fromStatus: BookingStatus.DRAFT,
          toStatus: BookingStatus.REQUEST_SUBMITTED,
          actorId: userId,
          actorRole: Role.CUSTOMER,
        },
      }),
    ]);

    return this.toDraftResponse(updated, []);
  }

  async deleteDraft(userId: string, bookingId: string): Promise<void> {
    const draft = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId: userId },
      select: { id: true, status: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== BookingStatus.DRAFT) {
      throw new ConflictException('Only an unsubmitted draft can be deleted');
    }
    await this.prisma.booking.delete({ where: { id: bookingId } });
  }

  // ── Talent ─────────────────────────────────────────────────────────────────

  async createTalentDraft(userId: string, dto: UpsertTalentRequestDto): Promise<DraftResponse> {
    const reference = await this.numbering.nextTalentBookingReference();

    const booking = await this.prisma.booking.create({
      data: {
        reference,
        type: BookingType.TALENT,
        customerId: userId,
        status: BookingStatus.DRAFT,
        startDate: new Date(),
        endDate: new Date(),
        periods: 1,
        contactPhone: dto.contactPhone ?? '',
        unitPriceMinor: 0,
        subtotalMinor: 0,
        totalMinor: 0,
        commissionRateBps: 0,
        commissionMinor: 0,
        supplierEarningsMinor: 0,
        talentDetail: { create: { eventLocation: '' } },
      },
    });

    return this.updateTalentDraft(userId, booking.id, dto);
  }

  async updateTalentDraft(
    userId: string,
    bookingId: string,
    dto: UpsertTalentRequestDto,
  ): Promise<DraftResponse> {
    const draft = await this.requireDraft(userId, bookingId, BookingType.TALENT);

    const talentProfileId = dto.talentProfileId ?? draft.talentProfileId ?? undefined;
    const talent = talentProfileId ? await this.findBookableTalent(talentProfileId) : null;

    if (dto.talentServiceId && talent) {
      const service = await this.prisma.talentService.findFirst({
        where: { id: dto.talentServiceId, talentProfileId: talent.id, isActive: true },
      });
      if (!service) throw new BadRequestException('That service does not belong to this talent');
    }

    const startDate = dto.startDate ? this.parseDate(dto.startDate, 'startDate') : draft.startDate;
    const endDate = dto.endDate ? this.parseDate(dto.endDate, 'endDate') : draft.endDate;
    if (endDate < startDate) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    if (dto.startTime && dto.endTime && dto.startTime >= dto.endTime && startDate >= endDate) {
      throw new BadRequestException('endTime must be after startTime on a single-day booking');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        talentProfileId: talent?.id,
        talentServiceId: dto.talentServiceId,
        startDate,
        endDate,
        periods: workingDays(startDate, endDate),
        projectType: dto.projectType,
        projectDescription: dto.projectDescription,
        contactPhone: dto.contactPhone ?? draft.contactPhone,
        additionalPhone: dto.additionalPhone,
        talentDetail: {
          update: {
            eventLocation: [dto.venue, dto.city].filter(Boolean).join(', ') || undefined,
            city: dto.city,
            venue: dto.venue,
            locationNotes: dto.locationNotes,
            engagementModel: dto.engagementModel,
            startTime: dto.startTime,
            endTime: dto.endTime,
            headcount: dto.headcount,
            budgetBand: dto.budgetBand,
            budgetMinor: dto.budgetMinor,
          },
        },
      },
      include: { talentDetail: true },
    });

    return this.toDraftResponse(updated, await this.talentGaps(updated));
  }

  // ── readiness ──────────────────────────────────────────────────────────────

  /**
   * What is still missing before an equipment request can be submitted.
   *
   * Returned to the client so the wizard can show its gaps, *and* enforced at submit time.
   * The list is one function so the two can never disagree.
   */
  private async equipmentGaps(booking: {
    customerId: string;
    listingId: string | null;
    startDate: Date;
    endDate: Date;
    contactPhone: string;
    equipmentDetail: { collectionMethod: CollectionMethod; deliveryAddress: string | null } | null;
  }): Promise<string[]> {
    const gaps: string[] = [];

    if (!booking.listingId) gaps.push('listingId');
    if (!booking.contactPhone.trim()) gaps.push('contactPhone');

    const detail = booking.equipmentDetail;
    if (detail?.collectionMethod === CollectionMethod.DELIVERY && !detail.deliveryAddress) {
      gaps.push('deliveryAddress');
    }

    // The same rule the profile endpoint publishes, re-checked rather than re-implemented.
    const profile = await this.customers.getProfile(booking.customerId);
    for (const missing of profile.outstandingRequirements) {
      gaps.push(`customer.${missing}`);
    }

    return gaps;
  }

  private async talentGaps(booking: {
    customerId: string;
    talentProfileId: string | null;
    contactPhone: string;
    talentDetail: {
      city: string | null;
      budgetBand: string | null;
      budgetMinor: number | null;
    } | null;
  }): Promise<string[]> {
    const gaps: string[] = [];

    if (!booking.talentProfileId) gaps.push('talentProfileId');
    if (!booking.contactPhone.trim()) gaps.push('contactPhone');
    if (!booking.talentDetail?.city) gaps.push('city');

    // No budget requirement: talent rates are fixed, so the budget only informs Eskista.

    const profile = await this.customers.getProfile(booking.customerId);
    for (const missing of profile.outstandingRequirements) {
      gaps.push(`customer.${missing}`);
    }

    return gaps;
  }

  // ── pricing ────────────────────────────────────────────────────────────────

  private async priceEquipment(booking: {
    id: string;
    listingId: string | null;
    startDate: Date;
    endDate: Date;
    equipmentDetail: { quantity: number; collectionMethod: CollectionMethod } | null;
  }): Promise<Prisma.BookingUpdateInput> {
    const listing = await this.findBookableListing(booking.listingId ?? '');
    const quantity = booking.equipmentDetail?.quantity ?? 1;
    const periods = billablePeriods(booking.startDate, booking.endDate);

    if (periods < listing.minRentalPeriods) {
      throw new BadRequestException(
        `This item has a minimum rental of ${listing.minRentalPeriods} period(s)`,
      );
    }
    if (listing.maxRentalPeriods && periods > listing.maxRentalPeriods) {
      throw new BadRequestException(
        `This item can be rented for at most ${listing.maxRentalPeriods} period(s)`,
      );
    }

    await this.assertAvailable(
      listing.id,
      booking.startDate,
      booking.endDate,
      quantity,
      booking.id,
    );

    const [{ commissionRateBps, taxRateBps }, defaultDelivery, serviceFeeBps] = await Promise.all([
      this.pricing.rates({
        listingBps: listing.commissionRateBps,
        vendorBps: listing.vendor.commissionRateBps,
      }),
      this.settings.deliveryFeeMinor(),
      this.settings.serviceFeeBps(),
    ]);

    const deliveryFeeMinor =
      booking.equipmentDetail?.collectionMethod === CollectionMethod.PICKUP ? 0 : defaultDelivery;

    const b = computePriceBreakdown(
      {
        supplierUnitPriceMinor: listing.rentalPriceMinor,
        periods,
        quantity,
        deliveryFeeMinor,
        securityDepositMinor: (listing.securityDepositMinor ?? 0) * quantity,
        taxRateBps,
        serviceFeeRateBps: serviceFeeBps,
        commissionRateBps,
      },
      listing.currency,
    );

    return this.snapshot(b, periods);
  }

  /**
   * Prices a talent engagement from the talent's fixed rate.
   *
   * There is no negotiation (removed in the September 2026 review), so the rate is the
   * talent's listed one — the chosen service's price if a service was picked, otherwise
   * their base rate — marked up by commission and VAT exactly like equipment.
   *
   * The unit is the rate's own: a per-day rate is multiplied by the days booked, a
   * per-project rate is charged once, a per-hour rate by the hours on each day. The
   * customer's budget is recorded for Eskista's information but never prices anything.
   */
  private async priceTalent(booking: {
    talentProfileId: string | null;
    talentServiceId: string | null;
    startDate: Date;
    endDate: Date;
    talentDetail: { startTime: string | null; endTime: string | null } | null;
  }): Promise<Prisma.BookingUpdateInput> {
    const talent = await this.findBookableTalent(booking.talentProfileId ?? '');
    const service = booking.talentServiceId
      ? await this.prisma.talentService.findFirst({
          where: { id: booking.talentServiceId, talentProfileId: talent.id, isActive: true },
        })
      : null;

    const rate = service?.priceMinor ?? talent.baseRateMinor;
    const model = service?.pricingModel ?? talent.pricingModel;
    if (rate === null || rate === undefined) {
      throw new ConflictException(
        'This talent has not set a rate yet, so the request cannot be priced. Contact Eskista.',
      );
    }

    // Each booked date is a working day — not nights, as a rental is counted.
    const days = workingDays(booking.startDate, booking.endDate);
    let periods = days;
    if (model === PricingModel.PER_PROJECT) {
      periods = 1;
    } else if (model === PricingModel.PER_HOUR) {
      const hours = this.hoursPerDay(
        booking.talentDetail?.startTime,
        booking.talentDetail?.endTime,
      );
      periods = Math.max(hours, 1) * days;
    }

    const [{ commissionRateBps, taxRateBps }, serviceFeeBps] = await Promise.all([
      this.pricing.rates({ talentBps: talent.commissionRateBps }),
      this.settings.serviceFeeBps(),
    ]);

    const b = computePriceBreakdown(
      {
        supplierUnitPriceMinor: rate,
        periods,
        taxRateBps,
        serviceFeeRateBps: serviceFeeBps,
        commissionRateBps,
      },
      talent.currency,
    );

    return this.snapshot(b, periods);
  }

  /** Whole hours between two HH:mm clock times; 0 if either is missing or reversed. */
  private hoursPerDay(start: string | null | undefined, end: string | null | undefined): number {
    if (!start || !end) return 0;
    const [sh = 0, sm = 0] = start.split(':').map(Number);
    const [eh = 0, em = 0] = end.split(':').map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    return minutes > 0 ? Math.ceil(minutes / 60) : 0;
  }

  /** The priced figures frozen onto the booking at submission. */
  private snapshot(b: ReturnType<typeof computePriceBreakdown>, periods: number) {
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

  // ── guards ─────────────────────────────────────────────────────────────────

  private async assertAvailable(
    listingId: string,
    startDate: Date,
    endDate: Date,
    quantity: number,
    excludeBookingId: string,
  ): Promise<void> {
    const [units, blocks, holding] = await Promise.all([
      this.prisma.equipmentUnit.count({ where: { listingId, status: { not: 'RETIRED' } } }),
      this.prisma.blockedDateRange.count({
        where: { listingId, startDate: { lte: endDate }, endDate: { gte: startDate } },
      }),
      this.prisma.booking.findMany({
        where: {
          listingId,
          id: { not: excludeBookingId },
          status: { in: HOLDING_STATUSES },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { equipmentDetail: { select: { quantity: true } } },
      }),
    ]);

    if (blocks > 0) {
      throw new ConflictException('The vendor has made these dates unavailable');
    }

    const taken = holding.reduce((sum, b) => sum + (b.equipmentDetail?.quantity ?? 1), 0);
    if (units - taken < quantity) {
      throw new ConflictException(
        `Only ${Math.max(units - taken, 0)} unit(s) are available for those dates`,
      );
    }
  }

  private async requireDraft(
    userId: string,
    bookingId: string,
    type: BookingType,
  ): Promise<Prisma.BookingGetPayload<{ include: { equipmentDetail: true; talentDetail: true } }>> {
    const draft = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId: userId },
      include: { equipmentDetail: true, talentDetail: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== BookingStatus.DRAFT) {
      throw new ConflictException('This request has already been submitted and cannot be edited');
    }
    if (draft.type !== type) {
      throw new BadRequestException(`This draft is a ${draft.type.toLowerCase()} request`);
    }
    return draft;
  }

  private async findBookableListing(listingId: string) {
    const listing = await this.prisma.listing.findFirst({
      where: {
        id: listingId,
        status: ListingStatus.PUBLISHED,
        vendor: { status: VerificationStatus.VERIFIED },
      },
      include: { vendor: { select: { commissionRateBps: true } } },
    });
    if (!listing) throw new NotFoundException('Equipment not found');
    return listing;
  }

  private async findBookableTalent(talentProfileId: string) {
    const talent = await this.prisma.talentProfile.findFirst({
      where: {
        id: talentProfileId,
        status: VerificationStatus.VERIFIED,
        isAvailableForHire: true,
      },
    });
    if (!talent) throw new NotFoundException('Talent not found');
    return talent;
  }

  private toDraftResponse(
    booking: { id: string; reference: string; status: BookingStatus; updatedAt: Date },
    gaps: string[],
  ): DraftResponse {
    return {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      outstandingRequirements: gaps,
      canSubmit: gaps.length === 0 && booking.status === BookingStatus.DRAFT,
      updatedAt: booking.updatedAt.toISOString(),
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
