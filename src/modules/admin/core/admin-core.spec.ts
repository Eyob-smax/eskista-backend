import { AdminTier } from '@prisma/client';
import { tierAllows } from './admin-access';
import { greeting, minorToDecimal, toCsv, trendPercent } from './admin-format';

describe('tierAllows', () => {
  it('lets a Super Admin use every route', () => {
    expect(tierAllows(AdminTier.SUPER_ADMIN, [AdminTier.FINANCE])).toBe(true);
  });

  it('lets any admin use a route with no tiers', () => {
    expect(tierAllows(AdminTier.SUPPORT, [])).toBe(true);
  });

  it('keeps other tiers out of a restricted route', () => {
    expect(tierAllows(AdminTier.SUPPORT, [AdminTier.FINANCE])).toBe(false);
    expect(tierAllows(AdminTier.FINANCE, [AdminTier.FINANCE, AdminTier.ADMIN])).toBe(true);
  });
});

describe('toCsv', () => {
  it('quotes fields with commas, quotes and new lines', () => {
    expect(toCsv(['a', 'b'], [['x, y', 'say "hi"']])).toBe('a,b\r\n"x, y","say ""hi"""\r\n');
  });

  it('defuses spreadsheet formulas but keeps negative numbers', () => {
    expect(toCsv(['v'], [['=SUM(A1)'], [-5]])).toBe("v\r\n'=SUM(A1)\r\n-5\r\n");
  });

  it('leaves empty values empty', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,\r\n');
  });
});

describe('minorToDecimal', () => {
  it('prints two decimals', () => {
    expect(minorToDecimal(1_250_050)).toBe('12500.50');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(-150)).toBe('-1.50');
  });
});

describe('greeting', () => {
  it('follows Addis Ababa time', () => {
    expect(greeting(new Date('2026-09-28T05:00:00Z'))).toBe('Good Morning'); // 08:00
    expect(greeting(new Date('2026-09-28T11:00:00Z'))).toBe('Good Afternoon'); // 14:00
    expect(greeting(new Date('2026-09-28T16:00:00Z'))).toBe('Good Evening'); // 19:00
  });
});

describe('trendPercent', () => {
  it('compares against the previous period', () => {
    expect(trendPercent(12, 10)).toBe(20);
    expect(trendPercent(0, 0)).toBe(0);
    expect(trendPercent(4, 0)).toBeNull();
  });
});
