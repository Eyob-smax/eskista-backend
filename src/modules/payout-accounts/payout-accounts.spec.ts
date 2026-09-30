import { AccountChannel } from '@prisma/client';
import { maskAccount, toPayoutAccountResponse } from './payout-accounts';

describe('payout accounts', () => {
  it('masks all but the last four digits', () => {
    expect(maskAccount('1000 1234 56789')).toBe('•••• 6789');
    expect(maskAccount('0911')).toBe('0911');
  });

  it('shapes an account for the apps', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    expect(
      toPayoutAccountResponse({
        id: 'a1',
        vendorId: 'v1',
        talentProfileId: null,
        channel: AccountChannel.TELEBIRR,
        provider: 'Telebirr',
        accountName: 'Afro Studio',
        accountNumber: '0911223344',
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({ maskedNumber: '•••• 3344', isPrimary: true, provider: 'Telebirr' });
  });
});
