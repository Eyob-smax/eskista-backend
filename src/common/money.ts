/**
 * Money helpers. Every amount in this codebase is an integer number of minor units
 * (ETB cents) with an explicit currency — never a float, and never a bare number passed
 * between layers without knowing which it is.
 */

export const DEFAULT_CURRENCY = 'ETB';

/** One basis point = 0.01%. 1500 bps = 15%. */
export const BPS_DIVISOR = 10_000;

export interface Money {
  amountMinor: number;
  currency: string;
}

export function money(amountMinor: number, currency = DEFAULT_CURRENCY): Money {
  return { amountMinor, currency };
}

/** Major → minor, e.g. 1200.5 ETB → 120050. */
export function toMinor(major: number): number {
  return Math.round(major * 100);
}

/** Minor → major, for display only. Never round-trip money through this. */
export function toMajor(minor: number): number {
  return minor / 100;
}

/**
 * Applies a basis-point rate to an amount, rounded half-up to the nearest minor unit.
 * Used for both commission and tax — the arithmetic is identical.
 */
export function applyBps(amountMinor: number, rateBps: number): number {
  if (amountMinor < 0) throw new RangeError('amountMinor must not be negative');
  if (rateBps < 0 || rateBps > BPS_DIVISOR) {
    throw new RangeError(`rateBps out of range: ${rateBps}`);
  }
  return Math.round((amountMinor * rateBps) / BPS_DIVISOR);
}

/**
 * Commission on a gross amount.
 *
 * Rounding is applied once, here, so the supplier's earnings always equal
 * `gross - commission` exactly and the two figures can never disagree by a cent.
 */
export function commissionOf(grossMinor: number, rateBps: number): number {
  return applyBps(grossMinor, rateBps);
}

export interface SplitResult {
  grossMinor: number;
  commissionRateBps: number;
  commissionMinor: number;
  supplierEarningsMinor: number;
}

/** Splits a gross rental into Eskista's commission and the supplier's earnings. */
export function splitCommission(grossMinor: number, rateBps: number): SplitResult {
  const commissionMinor = commissionOf(grossMinor, rateBps);
  return {
    grossMinor,
    commissionRateBps: rateBps,
    commissionMinor,
    supplierEarningsMinor: grossMinor - commissionMinor,
  };
}

export interface PriceBreakdownInput {
  unitPriceMinor: number;
  periods: number;
  quantity?: number;
  deliveryFeeMinor?: number;
  securityDepositMinor?: number;
  discountMinor?: number;
  taxRateBps?: number;
  /** Eskista's own handling fee. Defaults to 0, so the line is absent until configured. */
  serviceFeeRateBps?: number;
  commissionRateBps: number;
}

export interface PriceBreakdown {
  currency: string;
  unitPriceMinor: number;
  periods: number;
  quantity: number;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  securityDepositMinor: number;
  discountMinor: number;
  taxMinor: number;
  serviceFeeRateBps: number;
  serviceFeeMinor: number;
  /** Value of the goods and services. The VAT base and the invoice total. Excludes the deposit. */
  totalMinor: number;
  /** What the customer actually transfers: `totalMinor` plus the refundable deposit. */
  amountDueMinor: number;
  commissionRateBps: number;
  commissionMinor: number;
  supplierEarningsMinor: number;
}

/**
 * The single place a booking total is computed, so the customer's total, the vendor's
 * earnings and the invoice can never drift apart.
 *
 * Deliberate choices:
 *  - Commission is taken on the **rental subtotal only** — not on the delivery fee (that
 *    is Eskista's own revenue) and not on the refundable deposit.
 *  - Tax applies to the **rental subtotal − discount**, and to nothing else. Two screens
 *    fix this independently: Finalize Booking shows 10,500 + 500 delivery + 1,575 VAT =
 *    12,575, and Booking Details shows the same 1,575 beside a 300 service fee. In both,
 *    1,575 is 15% of 10,500 — taxing the delivery fee too would give 1,650 and neither
 *    total would reconcile. Delivery, the service fee and the refundable deposit are all
 *    outside the base.
 *  - The service fee sits **outside the VAT base**. That is what the Booking Details
 *    screen shows: 10,500 + 500 + 1,575 VAT + 300 fee = 12,875, where the VAT is 15% of
 *    11,000 and not of 11,300. Normal VAT treatment would tax the fee, so this is worth
 *    confirming — but the fee defaults to 0, so nothing turns on it until it is switched on.
 *  - Two totals are returned, because the designs show two (AD-9): `totalMinor` is the
 *    value of the goods (ETB 12,575 in the worked example) and `amountDueMinor` adds the
 *    refundable deposit (ETB 16,575). Returning one invites the caller to pick the wrong one.
 */
export function computePriceBreakdown(
  input: PriceBreakdownInput,
  currency = DEFAULT_CURRENCY,
): PriceBreakdown {
  const {
    unitPriceMinor,
    periods,
    quantity = 1,
    deliveryFeeMinor = 0,
    securityDepositMinor = 0,
    discountMinor = 0,
    taxRateBps = 0,
    serviceFeeRateBps = 0,
    commissionRateBps,
  } = input;

  if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new RangeError('unitPriceMinor must be a non-negative integer');
  }
  if (!Number.isInteger(periods) || periods < 1) {
    throw new RangeError('periods must be a positive integer');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError('quantity must be a positive integer');
  }

  const subtotalMinor = unitPriceMinor * periods * quantity;
  const cappedDiscount = Math.min(discountMinor, subtotalMinor + deliveryFeeMinor);

  // The discount comes off the rental before tax, but can never push the base below zero
  // when it is large enough to eat into the delivery fee as well.
  const taxableMinor = Math.max(subtotalMinor - cappedDiscount, 0);
  const taxMinor = applyBps(taxableMinor, taxRateBps);
  const serviceFeeMinor = applyBps(subtotalMinor, serviceFeeRateBps);

  const totalMinor = subtotalMinor + deliveryFeeMinor - cappedDiscount + taxMinor + serviceFeeMinor;
  const amountDueMinor = totalMinor + securityDepositMinor;

  const split = splitCommission(subtotalMinor, commissionRateBps);

  return {
    currency,
    unitPriceMinor,
    periods,
    quantity,
    subtotalMinor,
    deliveryFeeMinor,
    securityDepositMinor,
    discountMinor: cappedDiscount,
    taxMinor,
    serviceFeeRateBps,
    serviceFeeMinor,
    totalMinor,
    amountDueMinor,
    commissionRateBps,
    commissionMinor: split.commissionMinor,
    supplierEarningsMinor: split.supplierEarningsMinor,
  };
}

/** Inclusive day count, matching how the designs price a rental ("Aug 18 → Aug 21" = 3). */
export function billablePeriods(startDate: Date, endDate: Date): number {
  const ms =
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) -
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const days = Math.round(ms / 86_400_000);
  return Math.max(days, 1);
}

/** Formats for display/PDFs, e.g. "ETB 3,200.00". */
export function formatMoney(amountMinor: number, currency = DEFAULT_CURRENCY): string {
  const major = (amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${major}`;
}
