import { ConditionGrade, InspectionGrade, UnitStatus } from '@prisma/client';

/** The design's six grades, as the forms and chips print them. */
export const GRADE_LABELS: Record<InspectionGrade, string> = {
  PRISTINE: 'Pristine',
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
  NEEDS_ATTENTION: 'Needs Attention',
  DAMAGED: 'Damaged',
};

/**
 * The staff grade mapped onto the condition customers see on a unit. The two scales differ
 * because staff grade what is in front of them, while customers are told what to expect.
 */
export function conditionForGrade(grade: InspectionGrade): ConditionGrade {
  switch (grade) {
    case InspectionGrade.PRISTINE:
      return ConditionGrade.LIKE_NEW;
    case InspectionGrade.EXCELLENT:
      return ConditionGrade.EXCELLENT;
    case InspectionGrade.GOOD:
      return ConditionGrade.GOOD;
    default:
      return ConditionGrade.FAIR;
  }
}

/**
 * A damaged unit is taken out of rotation until someone looks at it; "needs attention" is
 * flagged but still rentable. Anything better puts a unit in maintenance back into service.
 */
export function unitStatusAfter(grade: InspectionGrade, current: UnitStatus): UnitStatus {
  if (current === UnitStatus.RETIRED) return current;
  if (grade === InspectionGrade.DAMAGED) return UnitStatus.MAINTENANCE;
  if (grade === InspectionGrade.NEEDS_ATTENTION) return current;
  return UnitStatus.AVAILABLE;
}

/** Whether gear in this state may leave the hub for a rental. */
export function canDispatch(grade: InspectionGrade | null): boolean {
  return grade !== null && grade !== InspectionGrade.DAMAGED;
}

/**
 * What the return inspection releases from the deposit. The deduction can never exceed the
 * deposit: a claim larger than that is raised as an incident and settled separately.
 */
export function depositAfterDeduction(depositMinor: number, deductionMinor: number): number {
  if (deductionMinor < 0) throw new RangeError('A deduction cannot be negative');
  if (deductionMinor > depositMinor) {
    throw new RangeError('The deduction is larger than the deposit held');
  }
  return depositMinor - deductionMinor;
}
