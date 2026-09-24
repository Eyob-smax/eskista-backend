import { PricingService } from './pricing.service';

const settings = (commissionBps = 1500, vatBps = 1500) =>
  ({
    commissionBps: vi.fn().mockResolvedValue(commissionBps),
    vatBps: vi.fn().mockResolvedValue(vatBps),
  }) as never;

describe('PricingService.resolveCommissionBps', () => {
  it('uses the platform default when nothing more specific is set', async () => {
    expect(await new PricingService(settings(1500)).resolveCommissionBps()).toBe(1500);
  });

  it('prefers the listing over the vendor', async () => {
    const svc = new PricingService(settings());
    expect(await svc.resolveCommissionBps({ listingBps: 2000, vendorBps: 1000 })).toBe(2000);
  });

  it('falls back to the vendor when the listing has no override', async () => {
    const svc = new PricingService(settings());
    expect(await svc.resolveCommissionBps({ listingBps: null, vendorBps: 1000 })).toBe(1000);
  });

  it('honours an explicit zero commission rather than treating it as unset', async () => {
    // A promotional 0% must not silently become the 15% default.
    const svc = new PricingService(settings(1500));
    expect(await svc.resolveCommissionBps({ talentBps: 0 })).toBe(0);
  });
});

describe('PricingService.pricer', () => {
  it('turns a supplier price into the customer price shown on cards', async () => {
    const price = await new PricingService(settings(1500, 1500)).pricer();
    expect(price(300_000)).toBe(396_750); // 3,000 -> 3,967.50
  });

  it('applies a per-row override on top of the shared default', async () => {
    const price = await new PricingService(settings(1500, 1500)).pricer();
    expect(price(300_000, { talentBps: 0 })).toBe(345_000); // VAT only
  });

  it('reads the default and VAT once for a whole page', async () => {
    const s = settings();
    const price = await new PricingService(s).pricer();
    price(1);
    price(2);
    price(3);
    expect(
      (s as unknown as { commissionBps: ReturnType<typeof vi.fn> }).commissionBps,
    ).toHaveBeenCalledTimes(1);
  });
});
