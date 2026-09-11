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
} as const;

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

  async paymentAccounts(): Promise<Record<string, unknown>> {
    const value = await this.raw(SETTING_KEYS.paymentAccounts);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
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
