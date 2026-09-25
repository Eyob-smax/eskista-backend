import { previewPricing } from './admin-review.service';

const RATES = { defaultBps: 1500, vatBps: 1500 };

describe('previewPricing — what the admin sees before approving', () => {
  it('pre-fills the platform default and shows the resulting customer price', () => {
    const p = previewPricing(300_000, 'DAY', RATES, {});

    expect(p.commissionBps).toBe(1500);
    expect(p.commissionSource).toBe('PLATFORM_DEFAULT');
    expect(p.commissionMinor).toBe(45_000); // 15% of 3,000
    expect(p.vatMinor).toBe(51_750); // 15% of 3,450
    expect(p.customerPriceMinor).toBe(396_750); // 3,967.50
  });

  it('reconciles: supplier + commission + VAT = customer price', () => {
    for (const price of [1, 999, 300_000, 1_234_567]) {
      const p = previewPricing(price, 'DAY', RATES, {});
      expect(p.supplierPriceMinor + p.commissionMinor + p.vatMinor).toBe(p.customerPriceMinor);
    }
  });

  it('previews the figure the admin is typing, without saving anything', () => {
    const p = previewPricing(300_000, 'DAY', RATES, { requested: 2000, item: 1000 });
    expect(p.commissionBps).toBe(2000);
    expect(p.commissionSource).toBe('REQUESTED');
    expect(p.defaultCommissionBps).toBe(1500); // still shown, for "reset to default"
  });

  it('shows a rate already agreed on the item ahead of the vendor and the default', () => {
    const p = previewPricing(300_000, 'DAY', RATES, { item: 1000, vendor: 1200 });
    expect(p.commissionBps).toBe(1000);
    expect(p.commissionSource).toBe('ITEM');
  });

  it('falls back to the vendor’s rate before the default', () => {
    const p = previewPricing(300_000, 'DAY', RATES, { vendor: 1200 });
    expect(p.commissionSource).toBe('VENDOR');
  });

  it('honours an explicit zero commission rather than treating it as unset', () => {
    const p = previewPricing(300_000, 'DAY', RATES, { requested: 0 });
    expect(p.commissionMinor).toBe(0);
    expect(p.customerPriceMinor).toBe(345_000); // VAT only
  });

  it('adds no VAT when VAT is disabled', () => {
    const p = previewPricing(300_000, 'DAY', { defaultBps: 1500, vatBps: 0 }, {});
    expect(p.vatMinor).toBe(0);
    expect(p.customerPriceMinor).toBe(345_000);
  });
});
