import { BookingStatus, InspectionGrade, UnitStatus } from '@prisma/client';
import { moveInOrder, slugify } from './admin-categories.service';
import { unitState } from './admin-equipment.service';

describe('unitState', () => {
  const unit = { status: UnitStatus.AVAILABLE, lastGrade: InspectionGrade.GOOD };

  it('is rented while a booking has it out', () => {
    expect(unitState(unit, [{ status: BookingStatus.IN_PROGRESS }])).toBe('RENTED');
  });

  it('is returned while it waits for inspection', () => {
    expect(unitState(unit, [{ status: BookingStatus.RETURN_RECEIVED }])).toBe('RETURNED');
  });

  it('is reserved when only an upcoming booking holds it', () => {
    expect(unitState(unit, [{ status: BookingStatus.AWAITING_PAYMENT }])).toBe('RESERVED');
  });

  it('needs attention in maintenance or after a damaged grade', () => {
    expect(unitState({ ...unit, status: UnitStatus.MAINTENANCE }, [])).toBe('IN_QA');
    expect(unitState({ ...unit, lastGrade: InspectionGrade.DAMAGED }, [])).toBe('IN_QA');
  });

  it('is retired whatever else is true', () => {
    expect(
      unitState({ ...unit, status: UnitStatus.RETIRED }, [{ status: BookingStatus.IN_PROGRESS }]),
    ).toBe('RETIRED');
  });

  it('is available otherwise', () => {
    expect(unitState(unit, [])).toBe('AVAILABLE');
  });
});

describe('categories', () => {
  it('slugifies names', () => {
    expect(slugify('Cinema Cameras & Lenses')).toBe('cinema-cameras-lenses');
  });

  it('moves a category one place, and not past either end', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'UP')).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'DOWN')).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', 'UP')).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'DOWN')).toEqual(['a', 'b', 'c']);
  });
});
