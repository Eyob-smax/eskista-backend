import {
  applyBps,
  billablePeriods,
  computePriceBreakdown,
  customerUnitPrice,
  extractInclusiveTax,
  formatMoney,
  grossUp,
  netOfInclusiveTax,
  splitCommission,
  toMajor,
  toMinor,
  workingDays,
} from './money';

/**
 * The client's pricing model (September 2026): the supplier sets what they want to earn,
 * Eskista adds commission on top, VAT is added on top of that, and the customer sees the
 * all-in figure.
 *
 * Worked example: a talent asks ETB 3,000/day for 3 days, 15% commission, 15% VAT.
 *   supplier   9,000.00   (3 × 3,000 — exactly what they asked)
 *   commission 1,350.00   (15% of 9,000)
 *   VAT        1,552.50   (15% of 10,350)
 *   customer  11,902.50   (3 × 3,967.50)
 */
const EXAMPLE = {
  supplierUnitPriceMinor: 300_000,
  periods: 3,
  taxRateBps: 1500,
  commissionRateBps: 1500,
};

describe('applyBps / grossUp / extractInclusiveTax', () => {
  it('applies a rate, rounded half-up', () => {
    expect(applyBps(1_100_000, 1500)).toBe(165_000);
    expect(applyBps(10, 1500)).toBe(2);
  });

  it('rejects a negative amount and an out-of-range rate', () => {
    expect(() => applyBps(-1, 1500)).toThrow(RangeError);
    expect(() => applyBps(100, 10_001)).toThrow(RangeError);
    expect(() => extractInclusiveTax(-1, 1500)).toThrow(RangeError);
  });

  it('grossUp adds VAT on top; extractInclusiveTax takes it back out', () => {
    const gross = grossUp(1_000_000, 1500);
    expect(gross).toBe(1_150_000);
    expect(extractInclusiveTax(gross, 1500)).toBe(150_000);
    expect(netOfInclusiveTax(gross, 1500)).toBe(1_000_000);
  });

  it('the two directions differ, and confusing them overcharges', () => {
    // 15% of the inclusive figure is not the tax inside it.
    expect(applyBps(1_150_000, 1500)).toBe(172_500);
    expect(extractInclusiveTax(1_150_000, 1500)).toBe(150_000);
  });

  it('never loses a cent splitting commission', () => {
    for (const gross of [1, 7, 33, 999, 12_345, 999_999]) {
      const r = splitCommission(gross, 1500);
      expect(r.commissionMinor + r.supplierEarningsMinor).toBe(gross);
    }
  });
});

describe('customerUnitPrice', () => {
  it('is supplier price + commission + VAT: 3,000 -> 3,967.50', () => {
    expect(customerUnitPrice(300_000, 1500, 1500)).toBe(396_750);
  });

  it('is exactly the supplier price with no commission and no VAT', () => {
    expect(customerUnitPrice(300_000, 0, 0)).toBe(300_000);
  });

  it('rises with the commission, so the catalogue moves when an admin changes it', () => {
    expect(customerUnitPrice(300_000, 2000, 1500)).toBeGreaterThan(
      customerUnitPrice(300_000, 1500, 1500),
    );
  });
});

describe('computePriceBreakdown — the client’s worked example', () => {
  const b = computePriceBreakdown(EXAMPLE);

  it('pays the supplier exactly what they asked', () => {
    expect(b.supplierEarningsMinor).toBe(900_000);
  });

  it('adds 15% commission on the supplier price', () => {
    expect(b.commissionMinor).toBe(135_000);
  });

  it('charges the customer 11,902.50, VAT included', () => {
    expect(b.totalMinor).toBe(1_190_250);
  });

  it('reports 1,552.50 of VAT inside that total', () => {
    expect(b.taxMinor).toBe(155_250);
    expect(b.netTotalMinor).toBe(1_035_000);
  });

  it('multiplies out exactly: 3 days × 3,967.50 = the rental line', () => {
    expect(b.unitPriceMinor).toBe(396_750);
    expect(b.subtotalMinor).toBe(b.unitPriceMinor * 3);
  });

  it('reconciles: supplier + commission + VAT = what the customer pays', () => {
    expect(b.supplierEarningsMinor + b.commissionMinor + b.taxMinor).toBe(b.totalMinor);
  });

  it('never takes commission on VAT', () => {
    expect(b.commissionMinor).toBe(applyBps(b.supplierEarningsMinor, 1500));
  });
});

describe('computePriceBreakdown — delivery, fee, deposit, discount', () => {
  it('adds VAT to the delivery fee, which is entered before VAT', () => {
    const b = computePriceBreakdown({ ...EXAMPLE, deliveryFeeMinor: 50_000 });
    expect(b.deliveryFeeMinor).toBe(57_500);
    expect(b.totalMinor).toBe(1_190_250 + 57_500);
  });

  it('keeps every line VAT-inclusive, so the lines sum to the total', () => {
    const b = computePriceBreakdown({
      ...EXAMPLE,
      deliveryFeeMinor: 50_000,
      serviceFeeRateBps: 300,
    });
    expect(b.subtotalMinor + b.deliveryFeeMinor + b.serviceFeeMinor).toBe(b.totalMinor);
  });

  it('keeps the deposit out of the total and out of VAT', () => {
    const b = computePriceBreakdown({ ...EXAMPLE, securityDepositMinor: 400_000 });
    expect(b.totalMinor).toBe(1_190_250);
    expect(b.amountDueMinor).toBe(1_190_250 + 400_000);
    expect(b.taxMinor).toBe(155_250);
  });

  it('has no service fee unless one is configured', () => {
    expect(computePriceBreakdown(EXAMPLE).serviceFeeMinor).toBe(0);
  });

  it('takes a discount out of Eskista’s margin, never the supplier’s pay', () => {
    const full = computePriceBreakdown(EXAMPLE);
    const off = computePriceBreakdown({ ...EXAMPLE, discountMinor: 100_000 });
    expect(off.totalMinor).toBe(full.totalMinor - 100_000);
    expect(off.supplierEarningsMinor).toBe(full.supplierEarningsMinor);
  });

  it('caps a discount so the total cannot go negative', () => {
    const b = computePriceBreakdown({
      ...EXAMPLE,
      discountMinor: 99_999_999,
      securityDepositMinor: 400_000,
    });
    expect(b.totalMinor).toBe(0);
    expect(b.taxMinor).toBe(0);
    expect(b.amountDueMinor).toBe(400_000);
  });

  it('charges no VAT for an exempt customer, and pays the supplier the same', () => {
    const b = computePriceBreakdown({ ...EXAMPLE, taxRateBps: 0 });
    expect(b.taxMinor).toBe(0);
    expect(b.totalMinor).toBe(1_035_000);
    expect(b.supplierEarningsMinor).toBe(900_000);
  });

  it('multiplies by quantity', () => {
    const b = computePriceBreakdown({ ...EXAMPLE, quantity: 2 });
    expect(b.supplierEarningsMinor).toBe(1_800_000);
    expect(b.subtotalMinor).toBe(396_750 * 6);
  });

  it('rejects nonsensical inputs', () => {
    expect(() => computePriceBreakdown({ ...EXAMPLE, periods: 0 })).toThrow(RangeError);
    expect(() => computePriceBreakdown({ ...EXAMPLE, quantity: 0 })).toThrow(RangeError);
    expect(() => computePriceBreakdown({ ...EXAMPLE, supplierUnitPriceMinor: -1 })).toThrow(
      RangeError,
    );
    expect(() => computePriceBreakdown({ ...EXAMPLE, periods: 1.5 })).toThrow(RangeError);
  });

  it('reconciles for awkward prices too — no cent goes missing', () => {
    for (const price of [1, 333, 12_345, 99_999, 1_234_567]) {
      const b = computePriceBreakdown({ ...EXAMPLE, supplierUnitPriceMinor: price });
      expect(b.netTotalMinor + b.taxMinor).toBe(b.totalMinor);
      expect(b.supplierEarningsMinor).toBe(price * 3);
    }
  });
});

describe('billablePeriods', () => {
  it('counts Aug 18 -> Aug 21 as 3 days', () => {
    expect(billablePeriods(new Date('2026-08-18'), new Date('2026-08-21'))).toBe(3);
  });

  it('bills a same-day rental as one period', () => {
    expect(billablePeriods(new Date('2026-08-18'), new Date('2026-08-18'))).toBe(1);
  });

  it('ignores the time of day', () => {
    expect(
      billablePeriods(new Date('2026-08-18T23:59:00Z'), new Date('2026-08-21T00:01:00Z')),
    ).toBe(3);
  });
});

describe('workingDays', () => {
  it('counts both ends, so a two-date engagement is two days of work', () => {
    expect(workingDays(new Date('2026-11-23'), new Date('2026-11-24'))).toBe(2);
  });

  it('is one day for a single date', () => {
    expect(workingDays(new Date('2026-09-22'), new Date('2026-09-22'))).toBe(1);
  });

  it('differs from rental nights by exactly one, which is the point', () => {
    const a = new Date('2026-08-18');
    const b = new Date('2026-08-21');
    expect(workingDays(a, b)).toBe(billablePeriods(a, b) + 1);
  });
});

describe('unit conversion and formatting', () => {
  it('round-trips major and minor units', () => {
    expect(toMinor(1200.5)).toBe(120_050);
    expect(toMajor(120_050)).toBe(1200.5);
  });

  it('formats with separators and two decimals', () => {
    expect(formatMoney(1_190_250)).toBe('ETB 11,902.50');
    expect(formatMoney(0)).toBe('ETB 0.00');
  });
});
