import { SettingsService } from './settings.service';

const withRows = (rows: Record<string, unknown>) =>
  new SettingsService({
    platformSetting: {
      findUnique: vi.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(where.key in rows ? { key: where.key, value: rows[where.key] } : null),
      ),
    },
  } as never);

describe('SettingsService number settings', () => {
  it('uses the default when a setting was never saved', async () => {
    // Number(null) is 0, which once slipped through as a real value: payouts came out
    // "expected today" instead of a week later.
    expect(await withRows({}).payoutDelayDays()).toBe(7);
  });

  it('keeps a saved zero, which is a real choice', async () => {
    expect(await withRows({ 'payout.delay_days': 0 }).payoutDelayDays()).toBe(0);
  });

  it('falls back on a value out of range or not a number', async () => {
    expect(await withRows({ 'payout.delay_days': 500 }).payoutDelayDays()).toBe(7);
    expect(await withRows({ 'payout.delay_days': 'soon' }).payoutDelayDays()).toBe(7);
  });

  it('reads the hiring limits with their defaults', async () => {
    expect(await withRows({ 'hiring.max_invitations': 3 }).hiring()).toEqual({
      maxInvitations: 3,
      invitationTtlHours: 48,
      selectionTtlHours: 72,
    });
  });

  it('fills the company details Eskista prints on invoices', async () => {
    const company = await withRows({
      'company.details': { legalName: 'Eskista PLC', tin: '0001234567' },
      'support.phone': '+251966554411',
    }).company();
    expect(company).toMatchObject({
      legalName: 'Eskista PLC',
      tin: '0001234567',
      phone: '+251966554411',
      address: 'Addis Ababa, Ethiopia',
    });
  });
});
