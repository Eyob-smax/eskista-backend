import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Typed access to operator-editable platform settings.
 *
 * Every getter has a compile-time default, so a missing or malformed row degrades to a
 * sane value rather than taking the API down. Values are cached briefly — these are read
 * on most pricing paths and change a few times a year.
 */
export const SETTING_KEYS = {
  commissionBps: 'commission.default_bps',
  deliveryFeeMinor: 'delivery.flat_fee_minor',
  vatBps: 'tax.vat_bps',
  vatEnabled: 'tax.vat_enabled',
  paymentAccounts: 'payment.accounts',
  returnSlotTimes: 'return.slot_times',
  supportPhone: 'support.phone',
  returnInstructions: 'return.instructions',
  serviceFeeBps: 'fees.service_bps',
  maxInvitations: 'hiring.max_invitations',
  invitationTtlHours: 'hiring.invitation_ttl_hours',
  selectionTtlHours: 'hiring.selection_ttl_hours',
  company: 'company.details',
  payoutDelayDays: 'payout.delay_days',
} as const;

/** Eskista's own details, printed at the top of every invoice. */
export interface CompanyDetails {
  legalName: string;
  tin: string | null;
  vatNumber: string | null;
  address: string;
  phone: string;
  email: string | null;
}

/** The three limits on a multi-talent hire request, all admin-editable. */
export interface HiringSettings {
  /** How many talents one request may invite. */
  maxInvitations: number;
  /** How long an invited talent has to answer. */
  invitationTtlHours: number;
  /** How long the customer has to choose, counted from the first acceptance. */
  selectionTtlHours: number;
}

export const HIRING_DEFAULTS: HiringSettings = {
  maxInvitations: 5,
  invitationTtlHours: 48,
  selectionTtlHours: 72,
};

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** Default Eskista commission, in basis points. */
  async commissionBps(): Promise<number> {
    return this.getNumber(SETTING_KEYS.commissionBps, 1500, 0, 10_000);
  }

  /**
   * Standard VAT rate in basis points. Ethiopian VAT is 15% (1500 bps).
   *
   * This is only the default — whether it is actually charged is decided per invoice,
   * because the client confirmed some customers, including companies, do not pay it.
   */
  async vatBps(): Promise<number> {
    const enabled = await this.getBoolean(SETTING_KEYS.vatEnabled, false);
    if (!enabled) return 0;
    return this.getNumber(SETTING_KEYS.vatBps, 1500, 0, 10_000);
  }

  async deliveryFeeMinor(): Promise<number> {
    return this.getNumber(SETTING_KEYS.deliveryFeeMinor, 0, 0, 100_000_000);
  }

  async returnSlotTimes(): Promise<string[]> {
    const value = await this.raw(SETTING_KEYS.returnSlotTimes);
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      return value;
    }
    return ['09:00', '10:00', '14:00', '16:00'];
  }

  /**
   * The bullet list on the Return Equipment screen.
   *
   * Operator-editable because what a customer must pack back differs by season and by
   * what Eskista keeps losing.
   */
  async returnInstructions(): Promise<string[]> {
    const value = await this.raw(SETTING_KEYS.returnInstructions);
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      return value;
    }
    return [];
  }

  async paymentAccounts(): Promise<Record<string, unknown>> {
    const value = await this.raw(SETTING_KEYS.paymentAccounts);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  }

  /**
   * The number behind every "Contact Eskista" button.
   *
   * Configurable because it appears on the booking screens and in the agreements, and a
   * support line that changes should not need a deploy.
   */
  async supportPhone(): Promise<string> {
    const value = await this.raw(SETTING_KEYS.supportPhone);
    return typeof value === 'string' && value.trim().length > 0 ? value : '+251966554411';
  }

  /**
   * Eskista's own handling fee, in basis points, applied to the rental subtotal.
   *
   * Defaults to 0 so the line stays out of every breakdown until it is deliberately
   * switched on — see AD-12. The Booking Details screen shows one, but no document defines
   * how it is calculated, so nothing is assumed.
   */
  async serviceFeeBps(): Promise<number> {
    return this.getNumber(SETTING_KEYS.serviceFeeBps, 0, 0, 10_000);
  }

  /**
   * The multi-talent hire limits: up to 5 invitations per request, 48 hours for a talent
   * to answer, 72 hours for the customer to choose. Approved September 24, 2026.
   */
  async hiring(): Promise<HiringSettings> {
    const [maxInvitations, invitationTtlHours, selectionTtlHours] = await Promise.all([
      this.getNumber(SETTING_KEYS.maxInvitations, HIRING_DEFAULTS.maxInvitations, 1, 20),
      this.getNumber(SETTING_KEYS.invitationTtlHours, HIRING_DEFAULTS.invitationTtlHours, 1, 720),
      this.getNumber(SETTING_KEYS.selectionTtlHours, HIRING_DEFAULTS.selectionTtlHours, 1, 720),
    ]);
    return { maxInvitations, invitationTtlHours, selectionTtlHours };
  }

  /** Eskista's legal name, TIN and address for invoices. Admin-editable. */
  async company(): Promise<CompanyDetails> {
    const value = await this.raw(SETTING_KEYS.company);
    const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
    return {
      legalName: str(v.legalName) ?? 'Eskista Marketplace PLC',
      tin: str(v.tin),
      vatNumber: str(v.vatNumber),
      address: str(v.address) ?? 'Addis Ababa, Ethiopia',
      phone: str(v.phone) ?? (await this.supportPhone()),
      email: str(v.email),
    };
  }

  /** Days after an engagement completes that its payout is expected. Default one week. */
  async payoutDelayDays(): Promise<number> {
    return this.getNumber(SETTING_KEYS.payoutDelayDays, 7, 0, 90);
  }

  /** Invalidates the cache — call after an admin edits a setting. */
  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async raw(key: string): Promise<unknown> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    const value = row?.value ?? null;
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  private async getNumber(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): Promise<number> {
    const value = await this.raw(key);
    // An unset setting falls back. Number(null) is 0, which would otherwise pass as a value.
    if (value === null || value === undefined || value === '') return fallback;
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
      if (value !== null) {
        this.logger.warn(`Setting ${key} is invalid (${JSON.stringify(value)}); using ${fallback}`);
      }
      return fallback;
    }
    return num;
  }

  private async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const value = await this.raw(key);
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }
}
