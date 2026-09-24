import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { customerUnitPrice } from '../../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';
import {
  CommissionResponse,
  PricingSettingsResponse,
  SetCommissionDto,
  UpdatePricingSettingsDto,
} from './dto/admin-pricing.dto';

/**
 * The commission Eskista adds on top of every supplier's price, and where to adjust it.
 *
 * Three levels, most specific wins: a listing, then its vendor (or a talent), then the
 * platform default. Every change is audited, and none reprices an existing booking —
 * each booking snapshotted the rate it was priced at.
 */
@Injectable()
export class AdminPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async getSettings(): Promise<PricingSettingsResponse> {
    const [defaultCommissionBps, vatBps, serviceFeeBps, deliveryFeeMinor] = await Promise.all([
      this.settings.commissionBps(),
      this.settings.vatBps(),
      this.settings.serviceFeeBps(),
      this.settings.deliveryFeeMinor(),
    ]);
    return {
      defaultCommissionBps,
      vatBps,
      serviceFeeBps,
      deliveryFeeMinor,
      exampleCustomerPriceFor1000Minor: customerUnitPrice(100_000, defaultCommissionBps, vatBps),
    };
  }

  async updateSettings(
    adminId: string,
    dto: UpdatePricingSettingsDto,
  ): Promise<PricingSettingsResponse> {
    const before = await this.getSettings();
    const changes: [string, number][] = [];
    if (dto.defaultCommissionBps !== undefined) {
      changes.push([SETTING_KEYS.commissionBps, dto.defaultCommissionBps]);
    }
    if (dto.serviceFeeBps !== undefined)
      changes.push([SETTING_KEYS.serviceFeeBps, dto.serviceFeeBps]);
    if (dto.deliveryFeeMinor !== undefined) {
      changes.push([SETTING_KEYS.deliveryFeeMinor, dto.deliveryFeeMinor]);
    }

    await this.prisma.$transaction(
      changes.map(([key, value]) =>
        this.prisma.platformSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    // Settings are cached for a minute; drop the cache so the catalogue moves now.
    this.settings.invalidate();

    const after = await this.getSettings();
    await this.audit(
      adminId,
      'pricing.settings.update',
      'PlatformSetting',
      'pricing',
      before,
      after,
      dto.reason,
    );
    return after;
  }

  async setListingCommission(
    adminId: string,
    listingId: string,
    dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { vendor: { select: { commissionRateBps: true } } },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    await this.prisma.listing.update({
      where: { id: listingId },
      data: { commissionRateBps: dto.commissionRateBps },
    });
    await this.audit(
      adminId,
      'commission.set',
      'Listing',
      listingId,
      { commissionRateBps: listing.commissionRateBps },
      { commissionRateBps: dto.commissionRateBps },
      dto.reason,
    );

    return this.describe(listingId, [
      ['LISTING', dto.commissionRateBps],
      ['VENDOR', listing.vendor.commissionRateBps],
    ]);
  }

  async setVendorCommission(
    adminId: string,
    vendorId: string,
    dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    const vendor = await this.prisma.vendorProfile.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    await this.prisma.vendorProfile.update({
      where: { id: vendorId },
      data: { commissionRateBps: dto.commissionRateBps },
    });
    await this.audit(
      adminId,
      'commission.set',
      'VendorProfile',
      vendorId,
      { commissionRateBps: vendor.commissionRateBps },
      { commissionRateBps: dto.commissionRateBps },
      dto.reason,
    );

    return this.describe(vendorId, [['VENDOR', dto.commissionRateBps]]);
  }

  async setTalentCommission(
    adminId: string,
    talentId: string,
    dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    const talent = await this.prisma.talentProfile.findUnique({ where: { id: talentId } });
    if (!talent) throw new NotFoundException('Talent not found');

    await this.prisma.talentProfile.update({
      where: { id: talentId },
      data: { commissionRateBps: dto.commissionRateBps },
    });
    await this.audit(
      adminId,
      'commission.set',
      'TalentProfile',
      talentId,
      { commissionRateBps: talent.commissionRateBps },
      { commissionRateBps: dto.commissionRateBps },
      dto.reason,
    );

    return this.describe(talentId, [['TALENT', dto.commissionRateBps]]);
  }

  /** Walks the levels and reports which one supplies the rate that now applies. */
  private async describe(
    id: string,
    levels: ['LISTING' | 'VENDOR' | 'TALENT', number | null][],
  ): Promise<CommissionResponse> {
    const own = levels[0]?.[1] ?? null;
    for (const [source, bps] of levels) {
      if (typeof bps === 'number') {
        return { id, commissionRateBps: own, effectiveCommissionBps: bps, source };
      }
    }
    return {
      id,
      commissionRateBps: own,
      effectiveCommissionBps: await this.settings.commissionBps(),
      source: 'PLATFORM_DEFAULT',
    };
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
