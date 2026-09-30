import { SettlementStatus } from '@prisma/client';
import { settlementDisplayStatus, settlementTotals } from './settlement-math';

describe('settlementTotals', () => {
  it('pays the supplier price when there are no adjustments', () => {
    expect(settlementTotals(1_000_000, [])).toEqual({
      adjustmentMinor: 0,
      deductionMinor: 0,
      netMinor: 1_000_000,
    });
  });

  it('adds damage compensation and takes off penalties', () => {
    expect(
      settlementTotals(1_000_000, [{ amountMinor: 150_000 }, { amountMinor: -50_000 }]),
    ).toEqual({ adjustmentMinor: 100_000, deductionMinor: 50_000, netMinor: 1_100_000 });
  });

  it('never pays out a negative amount', () => {
    expect(settlementTotals(100_000, [{ amountMinor: -250_000 }]).netMinor).toBe(0);
  });
});

describe('settlementDisplayStatus', () => {
  const now = new Date('2026-09-28T12:00:00Z');

  it('is overdue once unpaid past the expected date', () => {
    expect(
      settlementDisplayStatus(SettlementStatus.PENDING, new Date('2026-09-27T00:00:00Z'), now),
    ).toBe('OVERDUE');
  });

  it('is pending before then, and paid once paid', () => {
    expect(
      settlementDisplayStatus(SettlementStatus.PENDING, new Date('2026-10-01T00:00:00Z'), now),
    ).toBe('PENDING');
    expect(
      settlementDisplayStatus(SettlementStatus.PAID, new Date('2026-09-01T00:00:00Z'), now),
    ).toBe('PAID');
  });

  it('keeps a held payout on hold, however late', () => {
    expect(
      settlementDisplayStatus(SettlementStatus.ON_HOLD, new Date('2026-09-01T00:00:00Z'), now),
    ).toBe('ON_HOLD');
  });
});
