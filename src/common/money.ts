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
 * Used to report the VAT inside a customer's total for the invoice. At 15%, the tax inside
 * ETB 11,500 is `11,500 × 15/115 = 1,500`, not `11,500 × 15% = 1,725`. Using `applyBps`
 * here would overstate the tax by about 15% of itself on every invoice.
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

/**
 * Adds a basis-point rate on top of an amount, rounded half-up.
 *
 * The opposite direction to `extractInclusiveTax`: that takes VAT *out* of a price that
 * already contains it; this puts it *on* a price that does not. Confusing the two is how an
 * invoice ends up 15% of 15% wrong.
 */
export function grossUp(netMinor: number, rateBps: number): number {
  return netMinor + applyBps(netMinor, rateBps);
}

/**
 * What the customer sees per period for a supplier's price.
 *
 * Supplier price, plus Eskista's commission, plus VAT. This is the figure on every
 * catalogue card — the "VAT inclusive" price — and it is derived, never stored, so a
 * change to the commission or VAT rate moves the catalogue without touching any listing.
 */
export function customerUnitPrice(
  supplierUnitMinor: number,
  commissionRateBps: number,
  taxRateBps: number,
): number {
  const withCommission = supplierUnitMinor + applyBps(supplierUnitMinor, commissionRateBps);
  return grossUp(withCommission, taxRateBps);
}

export interface PriceBreakdownInput {
  /** What the supplier asked for, per period. This is what they will be paid. */
  supplierUnitPriceMinor: number;
  periods: number;
  quantity?: number;
  /** Eskista's delivery charge, before VAT. */
  deliveryFeeMinor?: number;
  securityDepositMinor?: number;
  /** A concession on the VAT-inclusive total. Comes out of Eskista's margin. */
  discountMinor?: number;
  taxRateBps?: number;
  /** Eskista's handling fee, as a share of the rental before VAT. Defaults to 0. */
  serviceFeeRateBps?: number;
  commissionRateBps: number;
}

export interface PriceBreakdown {
  currency: string;
  /** Per period, as the customer sees it — commission and VAT included. */
  unitPriceMinor: number;
  /** Per period, as the supplier set it. */
  supplierUnitPriceMinor: number;
  periods: number;
  quantity: number;
  /** The rental line, VAT-inclusive: `unitPriceMinor × periods × quantity`, exactly. */
  subtotalMinor: number;
  /** Delivery, VAT-inclusive. */
  deliveryFeeMinor: number;
  serviceFeeRateBps: number;
  /** Service fee, VAT-inclusive. */
  serviceFeeMinor: number;
  discountMinor: number;
  securityDepositMinor: number;
  /** The VAT contained in `totalMinor`. Reported, never added again. */
  taxMinor: number;
  taxRateBps: number;
  /** `totalMinor` less the VAT inside it. */
  netTotalMinor: number;
  /** What the customer owes for the goods and services, VAT included. Excludes deposit. */
  totalMinor: number;
  /** `totalMinor` plus the refundable deposit — what the customer actually transfers. */
  amountDueMinor: number;
  commissionRateBps: number;
  /** Eskista's commission on the rental, before VAT. */
  commissionMinor: number;
  /** Exactly the supplier's asked price × periods × quantity. */
  supplierEarningsMinor: number;
}

/**
 * The single place a booking is priced, so the quote, the booking and the invoice agree.
 *
 * **Markup model**, per the client (September 2026): the supplier sets the price they want
 * to *earn*; Eskista adds its commission on top; VAT is added on top of that. The customer
 * sees the resulting all-in figure, which is what "prices are VAT-inclusive" means.
 *
 * Consequences worth stating, because each is easy to break:
 *  - The supplier is paid **exactly** what they listed. Commission never comes out of it.
 *  - Commission is on the supplier's price, before VAT — Eskista never takes a share of
 *    tax. (This is the "commission on the net" answer, in the only form it can take when
 *    the net is what the supplier set.)
 *  - Every line is VAT-inclusive and the lines sum exactly to `totalMinor`. The rental
 *    line is `unitPriceMinor × periods × quantity`, so "3 days × ETB 3,967.50" always
 *    multiplies out to the printed figure.
 *  - VAT is then *extracted* from the total for the invoice. Any sub-cent rounding across
 *    lines lands in Eskista's margin, never in the supplier's pay or the customer's total.
 *  - A discount comes out of Eskista's margin, not the supplier's pay.
 *  - The refundable deposit carries no VAT and sits outside every total.
 */
export function computePriceBreakdown(
  input: PriceBreakdownInput,
  currency = DEFAULT_CURRENCY,
): PriceBreakdown {
  const {
    supplierUnitPriceMinor,
    periods,
    quantity = 1,
    deliveryFeeMinor = 0,
    securityDepositMinor = 0,
    discountMinor = 0,
    taxRateBps = 0,
    serviceFeeRateBps = 0,
    commissionRateBps,
  } = input;

  if (!Number.isInteger(supplierUnitPriceMinor) || supplierUnitPriceMinor < 0) {
    throw new RangeError('supplierUnitPriceMinor must be a non-negative integer');
  }
  if (!Number.isInteger(periods) || periods < 1) {
    throw new RangeError('periods must be a positive integer');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError('quantity must be a positive integer');
  }

  const units = periods * quantity;
  const supplierEarningsMinor = supplierUnitPriceMinor * units;

  // Round per unit, so the printed "N days × price" multiplies out exactly.
  const unitNetMinor = supplierUnitPriceMinor + applyBps(supplierUnitPriceMinor, commissionRateBps);
  const commissionMinor = (unitNetMinor - supplierUnitPriceMinor) * units;
  const unitPriceMinor = grossUp(unitNetMinor, taxRateBps);
  const subtotalMinor = unitPriceMinor * units;

  const deliveryGrossMinor = grossUp(deliveryFeeMinor, taxRateBps);
  const serviceFeeMinor = grossUp(applyBps(unitNetMinor * units, serviceFeeRateBps), taxRateBps);

  const billableMinor = subtotalMinor + deliveryGrossMinor + serviceFeeMinor;
  const cappedDiscount = Math.min(discountMinor, billableMinor);

  const totalMinor = billableMinor - cappedDiscount;
  const taxMinor = extractInclusiveTax(totalMinor, taxRateBps);

  return {
    currency,
    unitPriceMinor,
    supplierUnitPriceMinor,
    periods,
    quantity,
    subtotalMinor,
    deliveryFeeMinor: deliveryGrossMinor,
    serviceFeeRateBps,
    serviceFeeMinor,
    discountMinor: cappedDiscount,
    securityDepositMinor,
    taxMinor,
    taxRateBps,
    netTotalMinor: totalMinor - taxMinor,
    totalMinor,
    amountDueMinor: totalMinor + securityDepositMinor,
    commissionRateBps,
    commissionMinor,
    supplierEarningsMinor,
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

/**
 * Calendar days worked, counting both ends: Nov 23 → Nov 24 is **2**.
 *
 * Deliberately different from `billablePeriods`. A rental is charged by the night —
 * collected on the 18th, back on the 21st, three days — but a talent works on each date
 * they are booked for, so a two-date engagement is two days of work.
 */
export function workingDays(startDate: Date, endDate: Date): number {
  const ms =
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) -
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  return Math.max(Math.round(ms / 86_400_000) + 1, 1);
}

/** Formats for display/PDFs, e.g. "ETB 3,200.00". */
export function formatMoney(amountMinor: number, currency = DEFAULT_CURRENCY): string {
  const major = (amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${major}`;
}
