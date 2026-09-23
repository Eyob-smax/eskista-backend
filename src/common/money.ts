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
 * The tax already contained in a VAT-inclusive amount.
 *
 * Every price on the platform is quoted VAT-inclusive, so VAT is **extracted**, never
 * added: at 15%, the tax inside ETB 11,000 is `11,000 × 15/115 = 1,434.78`, not
 * `11,000 × 15% = 1,650`. Using `applyBps` here would overstate the tax by about 15% of
 * itself on every invoice.
 */
export function extractInclusiveTax(inclusiveMinor: number, rateBps: number): number {
  if (inclusiveMinor < 0) throw new RangeError('inclusiveMinor must not be negative');
  if (rateBps < 0 || rateBps > BPS_DIVISOR) {
    throw new RangeError(`rateBps out of range: ${rateBps}`);
  }
  return Math.round((inclusiveMinor * rateBps) / (BPS_DIVISOR + rateBps));
}

/** What is left of a VAT-inclusive amount once the tax is taken out. */
export function netOfInclusiveTax(inclusiveMinor: number, rateBps: number): number {
  return inclusiveMinor - extractInclusiveTax(inclusiveMinor, rateBps);
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
  /** VAT-inclusive, as listed by the supplier. */
  unitPriceMinor: number;
  periods: number;
  quantity: number;
  /** VAT-inclusive rental line. */
  subtotalMinor: number;
  deliveryFeeMinor: number;
  securityDepositMinor: number;
  discountMinor: number;
  serviceFeeRateBps: number;
  serviceFeeMinor: number;
  /**
   * The VAT *already contained* in `totalMinor` — not an addition to it. Show it as
   * "Includes VAT (15%)", never as a line that sums into the total.
   */
  taxMinor: number;
  taxRateBps: number;
  /** `totalMinor` less the VAT it contains. The figure that matters for accounting. */
  netTotalMinor: number;
  /**
   * What the customer owes for the goods and services, VAT included. Excludes the
   * refundable deposit.
   */
  totalMinor: number;
  /** What the customer actually transfers: `totalMinor` plus the refundable deposit. */
  amountDueMinor: number;
  commissionRateBps: number;
  /** Commission, taken on the rental net of VAT. */
  commissionMinor: number;
  /** The rental subtotal net of the VAT it contains. The base commission is taken on. */
  netSubtotalMinor: number;
  supplierEarningsMinor: number;
}

/**
 * The single place a booking total is computed, so the customer's total, the vendor's
 * earnings and the invoice can never drift apart.
 *
 * **Every price entering this function is VAT-inclusive**, per the client's September 2026
 * instruction: "all platform-facing prices across all categories are 15% VAT-inclusive."
 * VAT is therefore extracted from the total, never added to it.
 *
 * This deliberately contradicts the design sheets, which print
 * `10,500 + 500 delivery + 1,575 VAT = 12,575` — unambiguously additive. Under the rule
 * the client confirmed, the same booking totals **11,000**, of which 1,434.78 is VAT. The
 * printed totals on Finalize Booking, Complete Payment and Booking Details are wrong and
 * need reissuing. Recorded here because the arithmetic is the thing most likely to be
 * "corrected" back by someone comparing code against the mockups.
 *
 * Other deliberate choices:
 *  - Commission is taken on the rental **net of VAT**, because the VAT inside a price
 *    belongs to the tax authority and is not revenue Eskista may take a share of.
 *  - Commission applies to the rental only — not the delivery fee, which is Eskista's own
 *    revenue, and not the refundable deposit.
 *  - The **security deposit carries no VAT** and sits outside every total. It is a
 *    returnable holding, not consideration for a supply.
 *  - Two totals are returned (AD-9): `totalMinor` is the value of the goods and services,
 *    `amountDueMinor` adds the deposit. Returning one invites the caller to pick the wrong
 *    one on the payment screen.
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
  const serviceFeeMinor = applyBps(subtotalMinor, serviceFeeRateBps);

  const billableMinor = subtotalMinor + deliveryFeeMinor + serviceFeeMinor;
  const cappedDiscount = Math.min(discountMinor, billableMinor);

  // Everything above is VAT-inclusive, so the total is simply what the customer pays and
  // the tax is extracted from it rather than added on.
  const totalMinor = billableMinor - cappedDiscount;
  const taxMinor = extractInclusiveTax(totalMinor, taxRateBps);
  const netTotalMinor = totalMinor - taxMinor;

  const amountDueMinor = totalMinor + securityDepositMinor;

  // Commission is taken on the rental net of its own VAT, so Eskista never takes a share
  // of money owed to the tax authority. The discount is not applied here: a discount is
  // Eskista's concession to the customer, not a reduction of what the supplier earns.
  const netSubtotalMinor = netOfInclusiveTax(subtotalMinor, taxRateBps);
  const split = splitCommission(netSubtotalMinor, commissionRateBps);

  return {
    currency,
    unitPriceMinor,
    periods,
    quantity,
    subtotalMinor,
    deliveryFeeMinor,
    securityDepositMinor,
    discountMinor: cappedDiscount,
    serviceFeeRateBps,
    serviceFeeMinor,
    taxMinor,
    taxRateBps,
    netTotalMinor,
    totalMinor,
    amountDueMinor,
    commissionRateBps,
    commissionMinor: split.commissionMinor,
    netSubtotalMinor,
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
