import {
  applyBps,
  billablePeriods,
  commissionOf,
  computePriceBreakdown,
  formatMoney,
  splitCommission,
  toMajor,
  toMinor,
} from './money';

/**
 * The worked example printed on the Finalize Booking and Complete Payment screens.
 * If these numbers ever change, a customer is being shown a different price from the one
 * the designs agreed, so they are pinned here rather than left to inspection.
 */
const DESIGN_EXAMPLE = {
  unitPriceMinor: 350_000, // ETB 3,500/day
  periods: 3,
  deliveryFeeMinor: 50_000, // ETB 500
  securityDepositMinor: 400_000, // ETB 4,000
  taxRateBps: 1500, // 15%
  commissionRateBps: 1500,
};

describe('applyBps', () => {
  it('converts basis points to an amount, rounded half-up', () => {
    expect(applyBps(1_100_000, 1500)).toBe(165_000);
    expect(applyBps(100, 1500)).toBe(15);
    // 0.5 minor units rounds up, not toward even.
    expect(applyBps(10, 1500)).toBe(2);
  });

  it('treats 0 bps as free and 10,000 bps as the whole amount', () => {
    expect(applyBps(1234, 0)).toBe(0);
    expect(applyBps(1234, 10_000)).toBe(1234);
  });

  it('rejects a negative amount and an out-of-range rate', () => {
    expect(() => applyBps(-1, 1500)).toThrow(RangeError);
    expect(() => applyBps(100, -1)).toThrow(RangeError);
    expect(() => applyBps(100, 10_001)).toThrow(RangeError);
  });
});

describe('splitCommission', () => {
  it('splits so the two halves always reconstruct the gross exactly', () => {
    const r = splitCommission(1_050_000, 1500);
    expect(r.commissionMinor).toBe(157_500);
    expect(r.supplierEarningsMinor).toBe(892_500);
    expect(r.commissionMinor + r.supplierEarningsMinor).toBe(r.grossMinor);
  });

  it('never loses a cent to rounding, whatever the gross', () => {
    for (const gross of [1, 7, 33, 101, 999, 12_345, 999_999]) {
      const r = splitCommission(gross, 1500);
      expect(r.commissionMinor + r.supplierEarningsMinor).toBe(gross);
    }
  });

  it('commissionOf and splitCommission agree', () => {
    expect(commissionOf(500_000, 1250)).toBe(splitCommission(500_000, 1250).commissionMinor);
  });
});

describe('computePriceBreakdown — the design’s worked example', () => {
  const b = computePriceBreakdown(DESIGN_EXAMPLE);

  it('bills 3 days × ETB 3,500 as ETB 10,500', () => {
    expect(b.subtotalMinor).toBe(1_050_000);
  });

  it('charges 15% VAT on the rental subtotal alone = ETB 1,575', () => {
    // 10,500 × 15%. Taxing delivery too would give 1,650 and the printed total of
    // 12,575 would not reconcile.
    expect(b.taxMinor).toBe(157_500);
  });

  it('leaves the delivery fee out of the VAT base', () => {
    const noDelivery = computePriceBreakdown({ ...DESIGN_EXAMPLE, deliveryFeeMinor: 0 });
    expect(noDelivery.taxMinor).toBe(b.taxMinor);
  });

  it('totals ETB 12,575 — goods and services, excluding the deposit', () => {
    expect(b.totalMinor).toBe(1_257_500);
  });

  it('puts the amount due at ETB 16,575 — the total plus the ETB 4,000 deposit', () => {
    expect(b.amountDueMinor).toBe(1_657_500);
    expect(b.amountDueMinor).toBe(b.totalMinor + b.securityDepositMinor);
  });

  it('keeps the deposit out of the tax base entirely', () => {
    const withoutDeposit = computePriceBreakdown({
      ...DESIGN_EXAMPLE,
      securityDepositMinor: 0,
    });
    expect(withoutDeposit.taxMinor).toBe(b.taxMinor);
    expect(withoutDeposit.totalMinor).toBe(b.totalMinor);
  });

  it('takes commission on the rental subtotal only, not delivery or deposit', () => {
    expect(b.commissionMinor).toBe(157_500); // 15% of 10,500, not of 11,000
    expect(b.supplierEarningsMinor).toBe(892_500);
  });
});

describe('computePriceBreakdown — service fee', () => {
  it('is absent by default, so no existing total moves', () => {
    const b = computePriceBreakdown(DESIGN_EXAMPLE);
    expect(b.serviceFeeMinor).toBe(0);
    expect(b.serviceFeeRateBps).toBe(0);
  });

  it('adds a line without disturbing the VAT base', () => {
    // The Booking Details screen shows 10,500 + 500 + 1,575 VAT + 300 fee = 12,875,
    // so the fee sits outside the VAT base.
    const withFee = computePriceBreakdown({
      ...DESIGN_EXAMPLE,
      serviceFeeRateBps: 286, // ≈ ETB 300 on a 10,500 subtotal
    });
    const withoutFee = computePriceBreakdown(DESIGN_EXAMPLE);

    expect(withFee.taxMinor).toBe(withoutFee.taxMinor);
    expect(withFee.totalMinor).toBe(withoutFee.totalMinor + withFee.serviceFeeMinor);
    expect(withFee.amountDueMinor).toBe(withFee.totalMinor + withFee.securityDepositMinor);
  });
});

describe('computePriceBreakdown — quantity, discount and tax-free', () => {
  it('multiplies by quantity', () => {
    const b = computePriceBreakdown({ ...DESIGN_EXAMPLE, quantity: 2 });
    expect(b.subtotalMinor).toBe(2_100_000);
  });

  it('reduces the VAT base by a discount', () => {
    const b = computePriceBreakdown({ ...DESIGN_EXAMPLE, discountMinor: 50_000 });
    // (10,500 - 500) × 15%
    expect(b.taxMinor).toBe(150_000);
    expect(b.totalMinor).toBe(1_050_000 + 50_000 - 50_000 + 150_000);
  });

  it('caps a discount at the billable amount, so a total can never go negative', () => {
    const b = computePriceBreakdown({
      ...DESIGN_EXAMPLE,
      discountMinor: 99_999_999,
    });
    expect(b.discountMinor).toBe(1_100_000);
    expect(b.taxMinor).toBe(0);
    expect(b.totalMinor).toBe(0);
    expect(b.amountDueMinor).toBe(b.securityDepositMinor);
  });

  it('charges no tax for a VAT-exempt customer', () => {
    const b = computePriceBreakdown({ ...DESIGN_EXAMPLE, taxRateBps: 0 });
    expect(b.taxMinor).toBe(0);
    expect(b.totalMinor).toBe(1_100_000);
  });

  it('rejects nonsensical inputs rather than silently pricing them', () => {
    expect(() => computePriceBreakdown({ ...DESIGN_EXAMPLE, periods: 0 })).toThrow(RangeError);
    expect(() => computePriceBreakdown({ ...DESIGN_EXAMPLE, quantity: 0 })).toThrow(RangeError);
    expect(() => computePriceBreakdown({ ...DESIGN_EXAMPLE, unitPriceMinor: -1 })).toThrow(
      RangeError,
    );
    expect(() => computePriceBreakdown({ ...DESIGN_EXAMPLE, periods: 1.5 })).toThrow(RangeError);
  });
});

describe('billablePeriods', () => {
  it('counts Aug 18 → Aug 21 as 3 days, matching the designs', () => {
    expect(billablePeriods(new Date('2026-08-18'), new Date('2026-08-21'))).toBe(3);
  });

  it('bills a same-day rental as one period, never zero', () => {
    expect(billablePeriods(new Date('2026-08-18'), new Date('2026-08-18'))).toBe(1);
  });

  it('is unaffected by the time of day, so a DST shift cannot drop a day', () => {
    expect(
      billablePeriods(new Date('2026-08-18T23:59:00Z'), new Date('2026-08-21T00:01:00Z')),
    ).toBe(3);
  });
});

describe('unit conversion and formatting', () => {
  it('round-trips major and minor units', () => {
    expect(toMinor(1200.5)).toBe(120_050);
    expect(toMajor(120_050)).toBe(1200.5);
  });

  it('rounds fractional cents rather than truncating them', () => {
    expect(toMinor(0.005)).toBe(1);
  });

  it('formats with a thousands separator and two decimals', () => {
    expect(formatMoney(1_257_500)).toBe('ETB 12,575.00');
    expect(formatMoney(0)).toBe('ETB 0.00');
    expect(formatMoney(120_050, 'USD')).toBe('USD 1,200.50');
  });
});
