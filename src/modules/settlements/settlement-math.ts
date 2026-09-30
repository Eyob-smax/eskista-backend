import { SettlementStatus } from '@prisma/client';

/**
 * "Rental Revenue − Commission ± Adjustments = Vendor Settlement".
 *
 * Under Eskista's markup model the supplier's price already excludes commission, so the
 * payout is that price plus the signed adjustments. Deductions are the negative part, as a
 * positive figure, for the payee's "Deductions" line. A payout never goes below zero:
 * whatever a supplier owes beyond it is settled outside the payout.
 */
export function settlementTotals(
  supplierEarningsMinor: number,
  adjustments: { amountMinor: number }[],
): { adjustmentMinor: number; deductionMinor: number; netMinor: number } {
  const adjustmentMinor = adjustments.reduce((sum, a) => sum + a.amountMinor, 0);
  const deductionMinor = adjustments
    .filter((a) => a.amountMinor < 0)
    .reduce((sum, a) => sum - a.amountMinor, 0);
  return {
    adjustmentMinor,
    deductionMinor,
    netMinor: Math.max(0, supplierEarningsMinor + adjustmentMinor),
  };
}

export type SettlementDisplayStatus = 'PAID' | 'PENDING' | 'OVERDUE' | 'ON_HOLD';

/** Paid, Pending or Overdue on Vendor Payouts: overdue is unpaid past its expected date. */
export function settlementDisplayStatus(
  status: SettlementStatus,
  expectedAt: Date | null,
  now: Date = new Date(),
): SettlementDisplayStatus {
  if (status === SettlementStatus.PAID) return 'PAID';
  if (status === SettlementStatus.ON_HOLD) return 'ON_HOLD';
  if (expectedAt && expectedAt.getTime() < now.getTime()) return 'OVERDUE';
  return 'PENDING';
}
