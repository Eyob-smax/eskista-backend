import { allocatePayment, buildInvoice, type BookingFigures } from './invoice-math';

// The markup model's worked example: supplier 9,000, commission 1,350, VAT 1,552.50.
const camera: BookingFigures = {
  bookingId: 'b1',
  description: 'Sony FX3 · Aug 18 – Aug 21',
  currency: 'ETB',
  subtotalMinor: 1_190_250,
  deliveryFeeMinor: 0,
  serviceFeeMinor: 0,
  discountMinor: 0,
  taxMinor: 155_250,
  taxRateBps: 1500,
  securityDepositMinor: 500_000,
  totalMinor: 1_190_250,
};

const lights: BookingFigures = {
  ...camera,
  bookingId: 'b2',
  description: 'Aputure 600d · Aug 18 – Aug 21',
  subtotalMinor: 396_750,
  deliveryFeeMinor: 57_500,
  taxMinor: 59_250,
  securityDepositMinor: 0,
  totalMinor: 454_250,
};

describe('buildInvoice', () => {
  it('adds the bookings up, one line each, deposit kept apart', () => {
    const inv = buildInvoice([camera, lights], false);
    expect(inv.lines.map((l) => l.bookingId)).toEqual(['b1', 'b2']);
    expect(inv.totalMinor).toBe(1_644_500);
    expect(inv.taxMinor).toBe(214_500);
    expect(inv.securityDepositMinor).toBe(500_000);
    expect(inv.amountDueMinor).toBe(2_144_500);
    expect(inv.taxRateBps).toBe(1500);
  });

  it('keeps each line reconciling: the lines always add up to the invoice', () => {
    const inv = buildInvoice([camera, lights], false);
    expect(inv.lines.reduce((a, l) => a + l.totalMinor, 0)).toBe(inv.totalMinor);
  });

  it('takes VAT out of every line on an exempt invoice, and nothing else', () => {
    const inv = buildInvoice([camera, lights], true);
    expect(inv.taxMinor).toBe(0);
    expect(inv.taxRateBps).toBe(0);
    expect(inv.totalMinor).toBe(1_644_500 - 214_500);
    expect(inv.lines[1]?.deliveryFeeMinor).toBe(57_500);
    expect(inv.securityDepositMinor).toBe(500_000);
  });

  it('refuses to mix currencies', () => {
    expect(() => buildInvoice([camera, { ...lights, currency: 'USD' }], false)).toThrow(
      'different currencies',
    );
  });

  it('refuses an empty invoice', () => {
    expect(() => buildInvoice([], false)).toThrow('at least one booking');
  });
});

describe('allocatePayment', () => {
  it('splits a full transfer exactly by what each booking owes', () => {
    expect(allocatePayment(2_144_500, [1_690_250, 454_250])).toEqual([1_690_250, 454_250]);
  });

  it('always adds up to exactly what the customer declared', () => {
    const parts = allocatePayment(1_000_001, [333_333, 333_333, 333_334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_001);
  });

  it('splits a short payment proportionally', () => {
    expect(allocatePayment(1_000, [3_000, 1_000])).toEqual([750, 250]);
  });
});
