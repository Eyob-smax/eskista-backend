import { ConditionGrade, InspectionGrade, UnitStatus } from '@prisma/client';
import {
  canDispatch,
  conditionForGrade,
  depositAfterDeduction,
  unitStatusAfter,
} from './inspection-rules';

describe('inspection rules', () => {
  it('maps the staff grade onto the customer-facing condition', () => {
    expect(conditionForGrade(InspectionGrade.PRISTINE)).toBe(ConditionGrade.LIKE_NEW);
    expect(conditionForGrade(InspectionGrade.GOOD)).toBe(ConditionGrade.GOOD);
    expect(conditionForGrade(InspectionGrade.DAMAGED)).toBe(ConditionGrade.FAIR);
  });

  it('takes a damaged unit out of rotation and brings a repaired one back', () => {
    expect(unitStatusAfter(InspectionGrade.DAMAGED, UnitStatus.AVAILABLE)).toBe(
      UnitStatus.MAINTENANCE,
    );
    expect(unitStatusAfter(InspectionGrade.EXCELLENT, UnitStatus.MAINTENANCE)).toBe(
      UnitStatus.AVAILABLE,
    );
    expect(unitStatusAfter(InspectionGrade.NEEDS_ATTENTION, UnitStatus.MAINTENANCE)).toBe(
      UnitStatus.MAINTENANCE,
    );
  });

  it('never brings a retired unit back', () => {
    expect(unitStatusAfter(InspectionGrade.PRISTINE, UnitStatus.RETIRED)).toBe(UnitStatus.RETIRED);
  });

  it('only dispatches inspected gear that is not damaged', () => {
    expect(canDispatch(null)).toBe(false);
    expect(canDispatch(InspectionGrade.DAMAGED)).toBe(false);
    expect(canDispatch(InspectionGrade.NEEDS_ATTENTION)).toBe(true);
  });

  it('releases the deposit less the deduction, never more than was held', () => {
    expect(depositAfterDeduction(500_000, 150_000)).toBe(350_000);
    expect(() => depositAfterDeduction(100_000, 150_000)).toThrow(RangeError);
    expect(() => depositAfterDeduction(100_000, -1)).toThrow(RangeError);
  });
});
