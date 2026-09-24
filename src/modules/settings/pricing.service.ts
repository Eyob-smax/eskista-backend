import { Injectable } from '@nestjs/common';
import { customerUnitPrice } from '../../common/money';
import { SettingsService } from './settings.service';

/**
 * Where a supplier's commission can be set, most specific first.
 *
 * Any level may be null, meaning "inherit". The first non-null wins.
 */
export interface CommissionOverrides {
  /** Set by an admin on one listing when approving it. */
  listingBps?: number | null;
  /** Set on a vendor, applying to all their listings. */
  vendorBps?: number | null;
  /** Set on a talent, applying to all their services. */
  talentBps?: number | null;
}

export interface PricingRates {
  commissionRateBps: number;
  taxRateBps: number;
}

/**
 * The single answer to "what commission and VAT apply here?"
 *
 * The catalogue, the quote and the booking all ask this, and must agree — a card showing
 * one price and a quote showing another is the most visible bug a marketplace can have.
 *
 * Commission resolves listing → vendor or talent → platform default. The default is a
 * platform setting an admin can edit; the overrides let an admin adjust one supplier or one
 * listing without touching anyone else. A booking snapshots the rate it was priced at, so
 * editing any of these later never reprices a booking already made.
 */
@Injectable()
export class PricingService {
  constructor(private readonly settings: SettingsService) {}

  async resolveCommissionBps(overrides: CommissionOverrides = {}): Promise<number> {
    const specific = [overrides.listingBps, overrides.vendorBps, overrides.talentBps].find(
      (v): v is number => typeof v === 'number',
    );
    return specific ?? (await this.settings.commissionBps());
  }

  async rates(overrides: CommissionOverrides = {}): Promise<PricingRates> {
    const [commissionRateBps, taxRateBps] = await Promise.all([
      this.resolveCommissionBps(overrides),
      this.settings.vatBps(),
    ]);
    return { commissionRateBps, taxRateBps };
  }

  /**
   * Resolves the rates once for a whole page of cards.
   *
   * The default commission and the VAT rate are the same for every row, so they are read
   * once rather than per card; only the per-row overrides vary.
   */
  async pricer(): Promise<(supplierUnitMinor: number, overrides?: CommissionOverrides) => number> {
    const [defaultBps, taxRateBps] = await Promise.all([
      this.settings.commissionBps(),
      this.settings.vatBps(),
    ]);

    return (supplierUnitMinor, overrides = {}) => {
      const specific = [overrides.listingBps, overrides.vendorBps, overrides.talentBps].find(
        (v): v is number => typeof v === 'number',
      );
      return customerUnitPrice(supplierUnitMinor, specific ?? defaultBps, taxRateBps);
    };
  }
}
