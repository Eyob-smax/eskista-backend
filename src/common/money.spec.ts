import {
  applyBps,
  billablePeriods,
  commissionOf,
  computePriceBreakdown,
  extractInclusiveTax,
  formatMoney,
  netOfInclusiveTax,
  splitCommission,
  toMajor,
  toMinor,
} from './money';

/**
 * The worked example from the designs, repriced under the rule the client confirmed in
 * September 2026: every listed price is **VAT-inclusive**.
 *
 * The design sheets print `10,500 + 500 + 1,575 VAT = 12,575`, which is additive. Under
 * VAT-inclusive pricing the same booking totals 11,000, of which 1,434.78 is tax. These
 * tests pin the client's rule, not the mockup's arithmetic — see the note on
 * `computePriceBreakdown`.
 */
const DESIGN_EXAMPLE = {
  unitPriceMinor: 350_000, // ETB 3,500/day, VAT included
  periods: 3,
  deliveryFeeMinor: 50_000, // ETB 500, VAT included
  securityDepositMinor: 400_000, // ETB 4,000, refundable, never taxed
  taxRateBps: 1500, // 15%
  commissionRateBps: 1500,
};

describe('applyBps', () => {
  it('converts basis points to an amount, rounded half-up', () => {
    expect(applyBps(1_100_000, 1500)).toBe(165_000);
    expect(applyBps(100, 1500)).toBe(15);
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

describe('extractInclusiveTax', () => {
  it('takes the tax out of a VAT-inclusive amount, rather than adding it on', () => {
    // 11,000 x 15/115 = 1,434.78 — NOT 11,000 x 15% = 1,650.
    expect(extractInclusiveTax(1_100_000, 1500)).toBe(143_478);
  });

  it('is not the same as applying the rate, and the difference is material', () => {
    const extracted = extractInclusiveTax(1_100_000, 1500);
    const added = applyBps(1_100_000, 1500);
    expect(extracted).toBeLessThan(added);
    expect(added - extracted).toBe(21_522); // ETB 215.22 overcharged per booking if confused
  });

  it('leaves the net and the tax summing back to the original exactly', () => {
    for (const gross of [1, 99, 1234, 1_100_000, 999_999]) {
      expect(netOfInclusiveTax(gross, 1500) + extractInclusiveTax(gross, 1500)).toBe(gross);
    }
  });

  it('extracts nothing at a zero rate', () => {
    expect(extractInclusiveTax(1_100_000, 0)).toBe(0);
    expect(netOfInclusiveTax(1_100_000, 0)).toBe(1_100_000);
  });

  it('rejects a negative amount and an out-of-range rate', () => {
    expect(() => extractInclusiveTax(-1, 1500)).toThrow(RangeError);
    expect(() => extractInclusiveTax(100, 10_001)).toThrow(RangeError);
  });
});

describe('splitCommission', () => {
  it('splits so the two halves always reconstruct the gross exactly', () => {
    const r = splitCommission(913_043, 1500);
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

describe('computePriceBreakdown — VAT-inclusive pricing', () => {
  const b = computePriceBreakdown(DESIGN_EXAMPLE);

  it('bills 3 days x ETB 3,500 as ETB 10,500, VAT already inside', () => {
    expect(b.subtotalMinor).toBe(1_050_000);
  });

  it('totals ETB 11,000 — the listed prices, with nothing added on top', () => {
    expect(b.totalMinor).toBe(1_100_000);
    expect(b.totalMinor).toBe(b.subtotalMinor + b.deliveryFeeMinor);
  });

  it('reports ETB 1,434.78 of VAT as contained in the total, not added to it', () => {
    expect(b.taxMinor).toBe(143_478);
    expect(b.netTotalMinor).toBe(1_100_000 - 143_478);
    expect(b.netTotalMinor + b.taxMinor).toBe(b.totalMinor);
  });

  it('does not inflate the total the way additive VAT would', () => {
    // The mockups print 12,575. Under the confirmed rule the customer pays 11,000.
    expect(b.totalMinor).not.toBe(1_257_500);
  });

  it('puts the amount due at ETB 15,000 — the total plus the ETB 4,000 deposit', () => {
    expect(b.amountDueMinor).toBe(1_500_000);
    expect(b.amountDueMinor).toBe(b.totalMinor + b.securityDepositMinor);
  });

  it('keeps the deposit out of the total and out of the tax entirely', () => {
    const noDeposit = computePriceBreakdown({ ...DESIGN_EXAMPLE, securityDepositMinor: 0 });
    expect(noDeposit.taxMinor).toBe(b.taxMinor);
    expect(noDeposit.totalMinor).toBe(b.totalMinor);
  });

  it('taxes the delivery fee, because it is a supply like any other', () => {
    const noDelivery = computePriceBreakdown({ ...DESIGN_EXAMPLE, deliveryFeeMinor: 0 });
    expect(noDelivery.taxMinor).toBeLessThan(b.taxMinor);
  });
});

describe('computePriceBreakdown — commission', () => {
  const b = computePriceBreakdown(DESIGN_EXAMPLE);

  it('takes commission on the rental net of VAT, not on the inclusive price', () => {
    // 10,500 inclusive -> 9,130.43 net -> 15% = 1,369.56.
    expect(b.netSubtotalMinor).toBe(913_043);
    expect(b.commissionMinor).toBe(136_956);
  });

  it('never takes a share of money owed to the tax authority', () => {
    const onInclusive = applyBps(b.subtotalMinor, 1500);
    expect(b.commissionMinor).toBeLessThan(onInclusive);
  });

  it('leaves the supplier the net rental less commission, reconciling exactly', () => {
    expect(b.supplierEarningsMinor).toBe(776_087);
    expect(b.commissionMinor + b.supplierEarningsMinor).toBe(b.netSubtotalMinor);
  });

  it('ignores the delivery fee and the deposit when computing commission', () => {
    const richer = computePriceBreakdown({
      ...DESIGN_EXAMPLE,
      deliveryFeeMinor: 500_000,
      securityDepositMinor: 900_000,
    });
    expect(richer.commissionMinor).toBe(b.commissionMinor);
  });
});

describe('computePriceBreakdown — service fee', () => {
  it('is absent by default, so no total moves until it is configured', () => {
    const b = computePriceBreakdown(DESIGN_EXAMPLE);
    expect(b.serviceFeeMinor).toBe(0);
    expect(b.serviceFeeRateBps).toBe(0);
  });

  it('is itself VAT-inclusive, and lifts both the total and the tax inside it', () => {
    const withFee = computePriceBreakdown({ ...DESIGN_EXAMPLE, serviceFeeRateBps: 286 });
    const withoutFee = computePriceBreakdown(DESIGN_EXAMPLE);

    expect(withFee.totalMinor).toBe(withoutFee.totalMinor + withFee.serviceFeeMinor);
    expect(withFee.taxMinor).toBeGreaterThan(withoutFee.taxMinor);
    expect(withFee.netTotalMinor + withFee.taxMinor).toBe(withFee.totalMinor);
  });

  it('does not change what the supplier earns — it is Eskista’s fee, not theirs', () => {
    const withFee = computePriceBreakdown({ ...DESIGN_EXAMPLE, serviceFeeRateBps: 286 });
    const withoutFee = computePriceBreakdown(DESIGN_EXAMPLE);
    expect(withFee.supplierEarningsMinor).toBe(withoutFee.supplierEarningsMinor);
  });
});

describe('computePriceBreakdown — quantity, discount and exemption', () => {
  it('multiplies by quantity', () => {
    const b = computePriceBreakdown({ ...DESIGN_EXAMPLE, quantity: 2 });
    expect(b.subtotalMinor).toBe(2_100_000);
  });

  it('reduces the total and the VAT inside it by a discount', () => {
    const b = computePriceBreakdown({ ...DESIGN_EXAMPLE, discountMinor: 100_000 });
    expect(b.totalMinor).toBe(1_000_000);
    expect(b.taxMinor).toBe(extractInclusiveTax(1_000_000, 1500));
  });

  it('does not reduce what the supplier earns — a discount is Eskista’s concession', () => {
    const discounted = computePriceBreakdown({ ...DESIGN_EXAMPLE, discountMinor: 100_000 });
    const full = computePriceBreakdown(DESIGN_EXAMPLE);
    expect(discounted.supplierEarningsMinor).toBe(full.supplierEarningsMinor);
  });

  it('caps a discount at the billable amount, so a total can never go negative', () => {
    const b = computePriceBreakdown({ ...DESIGN_EXAMPLE, discountMinor: 99_999_999 });
    expect(b.discountMinor).toBe(1_100_000);
    expect(b.totalMinor).toBe(0);
    expect(b.taxMinor).toBe(0);
    expect(b.amountDueMinor).toBe(b.securityDepositMinor);
  });

  it('reports no VAT for an exempt customer, and the total is unchanged', () => {
    // Exemption does not make the goods cheaper: the price was always the price.
    const b = computePriceBreakdown({ ...DESIGN_EXAMPLE, taxRateBps: 0 });
    expect(b.taxMinor).toBe(0);
    expect(b.totalMinor).toBe(1_100_000);
    expect(b.netTotalMinor).toBe(1_100_000);
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
  it('counts Aug 18 -> Aug 21 as 3 days, matching the designs', () => {
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
    expect(formatMoney(1_100_000)).toBe('ETB 11,000.00');
    expect(formatMoney(143_478)).toBe('ETB 1,434.78');
    expect(formatMoney(0)).toBe('ETB 0.00');
    expect(formatMoney(120_050, 'USD')).toBe('USD 1,200.50');
  });
});
