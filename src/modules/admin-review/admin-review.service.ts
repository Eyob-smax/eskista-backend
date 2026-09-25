import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ListingStatus, PricingModel, Prisma, VerificationStatus } from '@prisma/client';
import { applyBps, customerUnitPrice } from '../../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  ApproveDto,
  PricingPreviewResponse,
  RejectDto,
  ReviewItemResponse,
} from './dto/admin-review.dto';

type Unit = PricingPreviewResponse['periodUnit'];
type Rates = { defaultBps: number; vatBps: number };

const UNIT_FOR_MODEL: Record<PricingModel, Unit> = {
  PER_HOUR: 'HOUR',
  PER_DAY: 'DAY',
  PER_PROJECT: 'PROJECT',
};

const listingInclude = {
  vendor: { select: { businessName: true, status: true, commissionRateBps: true } },
} satisfies Prisma.ListingInclude;

const talentInclude = {
  services: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.TalentProfileInclude;

type ReviewListing = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;
type ReviewTalent = Prisma.TalentProfileGetPayload<{ include: typeof talentInclude }>;

/**
 * Pure: the numbers beside the Approve button.
 *
 * Commission resolves requested → already on the item → the vendor's → the platform
 * default, and the preview says which one it used so the form can label it "default" or
 * "custom".
 */
export function previewPricing(
  supplierPriceMinor: number,
  periodUnit: Unit,
  rates: Rates,
  levels: { requested?: number; item?: number | null; vendor?: number | null },
): PricingPreviewResponse {
  let commissionBps = rates.defaultBps;
  let commissionSource: PricingPreviewResponse['commissionSource'] = 'PLATFORM_DEFAULT';

  if (typeof levels.requested === 'number') {
    commissionBps = levels.requested;
    commissionSource = 'REQUESTED';
  } else if (typeof levels.item === 'number') {
    commissionBps = levels.item;
    commissionSource = 'ITEM';
  } else if (typeof levels.vendor === 'number') {
    commissionBps = levels.vendor;
    commissionSource = 'VENDOR';
  }

  const commissionMinor = applyBps(supplierPriceMinor, commissionBps);
  const customerPriceMinor = customerUnitPrice(supplierPriceMinor, commissionBps, rates.vatBps);

  return {
    supplierPriceMinor,
    periodUnit,
    defaultCommissionBps: rates.defaultBps,
    commissionBps,
    commissionSource,
    commissionMinor,
    vatBps: rates.vatBps,
    vatMinor: customerPriceMinor - supplierPriceMinor - commissionMinor,
    customerPriceMinor,
  };
}

/**
 * Reviewing what suppliers submit: equipment listings and talent registrations.
 *
 * The client's flow: the supplier proposes their price; the admin reviews it, sees the
 * default commission already filled in, may adjust it for this item, and approves. VAT is
 * added automatically.
 *
 * The rate agreed here is **stored on the item**, so it is the rate that was actually
 * reviewed. A later change to the global default only pre-fills new reviews; it never
 * silently moves something an admin already approved.
 */
@Injectable()
export class AdminReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // ── Listings ───────────────────────────────────────────────────────────────

  async listListings(): Promise<ReviewItemResponse[]> {
    const rows = await this.prisma.listing.findMany({
      where: { status: ListingStatus.PENDING_REVIEW },
      include: listingInclude,
      // Oldest first: the queue is served in the order suppliers joined it.
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    });
    const rates = await this.rates();
    return rows.map((l) => this.listingItem(l, rates));
  }

  async getListing(id: string, commissionBps?: number): Promise<ReviewItemResponse> {
    return this.listingItem(await this.findListing(id), await this.rates(), commissionBps);
  }

  async approveListing(adminId: string, id: string, dto: ApproveDto): Promise<ReviewItemResponse> {
    const listing = await this.findListing(id);
    const rates = await this.rates();
    const item = this.listingItem(listing, rates, dto.commissionRateBps);
    if (!item.canApprove) {
      throw new ConflictException({
        message: 'This listing cannot be approved yet',
        blockers: item.blockers,
      });
    }

    const commissionRateBps = item.pricing?.commissionBps ?? rates.defaultBps;
    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        status: ListingStatus.PUBLISHED,
        publishedAt: new Date(),
        reviewedById: adminId,
        rejectionReason: null,
        commissionRateBps,
        ...(dto.featured !== undefined ? { isFeatured: dto.featured } : {}),
      },
      include: listingInclude,
    });

    await this.audit(
      adminId,
      'listing.approve',
      'Listing',
      id,
      { status: listing.status, commissionRateBps: listing.commissionRateBps },
      { status: updated.status, commissionRateBps },
      dto.note,
    );

    return this.listingItem(updated, rates);
  }

  async rejectListing(adminId: string, id: string, dto: RejectDto): Promise<ReviewItemResponse> {
    const listing = await this.findListing(id);
    if (listing.status !== ListingStatus.PENDING_REVIEW) {
      throw new ConflictException('Only a listing awaiting review can be rejected');
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        status: ListingStatus.REJECTED,
        rejectionReason: dto.reason,
        reviewedById: adminId,
      },
      include: listingInclude,
    });

    await this.audit(
      adminId,
      'listing.reject',
      'Listing',
      id,
      { status: listing.status },
      { status: updated.status },
      dto.reason,
    );
    return this.listingItem(updated, await this.rates());
  }

  // ── Talent ─────────────────────────────────────────────────────────────────

  async listTalent(): Promise<ReviewItemResponse[]> {
    const rows = await this.prisma.talentProfile.findMany({
      where: { status: VerificationStatus.PENDING_REVIEW },
      include: talentInclude,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    const rates = await this.rates();
    return rows.map((t) => this.talentItem(t, rates));
  }

  async getTalent(id: string, commissionBps?: number): Promise<ReviewItemResponse> {
    return this.talentItem(await this.findTalent(id), await this.rates(), commissionBps);
  }

  async approveTalent(adminId: string, id: string, dto: ApproveDto): Promise<ReviewItemResponse> {
    const talent = await this.findTalent(id);
    const rates = await this.rates();
    const item = this.talentItem(talent, rates, dto.commissionRateBps);
    if (!item.canApprove) {
      throw new ConflictException({
        message: 'This talent cannot be approved yet',
        blockers: item.blockers,
      });
    }

    const commissionRateBps = dto.commissionRateBps ?? talent.commissionRateBps ?? rates.defaultBps;
    const updated = await this.prisma.talentProfile.update({
      where: { id },
      data: {
        status: VerificationStatus.VERIFIED,
        verifiedAt: new Date(),
        verifiedByAdminId: adminId,
        rejectionReason: null,
        commissionRateBps,
      },
      include: talentInclude,
    });

    await this.audit(
      adminId,
      'talent.approve',
      'TalentProfile',
      id,
      { status: talent.status, commissionRateBps: talent.commissionRateBps },
      { status: updated.status, commissionRateBps },
      dto.note,
    );

    return this.talentItem(updated, rates);
  }

  async rejectTalent(adminId: string, id: string, dto: RejectDto): Promise<ReviewItemResponse> {
    const talent = await this.findTalent(id);
    if (talent.status !== VerificationStatus.PENDING_REVIEW) {
      throw new ConflictException('Only a talent awaiting review can be rejected');
    }

    const updated = await this.prisma.talentProfile.update({
      where: { id },
      data: {
        status: VerificationStatus.REJECTED,
        rejectionReason: dto.reason,
        verifiedByAdminId: adminId,
      },
      include: talentInclude,
    });

    await this.audit(
      adminId,
      'talent.reject',
      'TalentProfile',
      id,
      { status: talent.status },
      { status: updated.status },
      dto.reason,
    );
    return this.talentItem(updated, await this.rates());
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async rates(): Promise<Rates> {
    const [defaultBps, vatBps] = await Promise.all([
      this.settings.commissionBps(),
      this.settings.vatBps(),
    ]);
    return { defaultBps, vatBps };
  }

  private listingItem(l: ReviewListing, rates: Rates, requested?: number): ReviewItemResponse {
    const blockers: string[] = [];
    if (l.status !== ListingStatus.PENDING_REVIEW) {
      blockers.push(`The listing is ${this.words(l.status)}, not awaiting review`);
    }
    if (l.vendor.status !== VerificationStatus.VERIFIED) {
      blockers.push('The vendor is not verified yet, so the listing would not appear anyway');
    }
    if (l.rentalPriceMinor <= 0) blockers.push('The vendor has not proposed a price');

    return {
      id: l.id,
      name: l.name,
      supplierName: l.vendor.businessName,
      status: l.status,
      submittedAt: l.submittedAt?.toISOString() ?? null,
      canApprove: blockers.length === 0,
      blockers,
      pricing: previewPricing(l.rentalPriceMinor, l.rentalPeriodUnit, rates, {
        requested,
        item: l.commissionRateBps,
        vendor: l.vendor.commissionRateBps,
      }),
    };
  }

  private talentItem(t: ReviewTalent, rates: Rates, requested?: number): ReviewItemResponse {
    const blockers: string[] = [];
    if (t.status !== VerificationStatus.PENDING_REVIEW) {
      blockers.push(`The talent is ${this.words(t.status)}, not awaiting review`);
    }
    if (t.baseRateMinor === null && t.services.length === 0) {
      blockers.push('The talent has not proposed a rate or any priced service');
    }

    const levels = { requested, item: t.commissionRateBps };
    return {
      id: t.id,
      name: t.displayName,
      supplierName: t.displayName,
      status: t.status,
      submittedAt: t.updatedAt.toISOString(),
      canApprove: blockers.length === 0,
      blockers,
      pricing:
        t.baseRateMinor === null
          ? null
          : previewPricing(t.baseRateMinor, UNIT_FOR_MODEL[t.pricingModel], rates, levels),
      services: t.services.map((s) => ({
        id: s.id,
        title: s.title,
        pricing: previewPricing(s.priceMinor, UNIT_FOR_MODEL[s.pricingModel], rates, levels),
      })),
    };
  }

  private words(status: string): string {
    return status.toLowerCase().replace(/_/g, ' ');
  }

  private async findListing(id: string): Promise<ReviewListing> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: listingInclude,
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  private async findTalent(id: string): Promise<ReviewTalent> {
    const talent = await this.prisma.talentProfile.findUnique({
      where: { id },
      include: talentInclude,
    });
    if (!talent) throw new NotFoundException('Talent not found');
    return talent;
  }

  private async audit(
    adminId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    reason?: string,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        entityType,
        entityId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
        reason,
      },
    });
  }
}
