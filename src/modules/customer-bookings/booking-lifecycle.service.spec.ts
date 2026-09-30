import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AgreementStatus,
  BookingStatus,
  DeliveryStage,
  FulfilmentDirection,
  PaymentStatus,
} from '@prisma/client';
import { BookingLifecycleService } from './booking-lifecycle.service';

const USER = 'user-1';

/**
 * Builds the service over a hand-rolled Prisma stub.
 *
 * Only the lookups each test exercises are stubbed; anything else throws if touched, so a
 * test cannot pass by accident through a path it did not mean to take.
 */
function build(booking: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const prisma = {
    booking: { findFirst: vi.fn().mockResolvedValue(booking) },
    ...extra,
  };
  const settings = {
    paymentAccounts: vi.fn().mockResolvedValue({
      telebirr: { number: '0911234567', accountName: 'Eskista Equipment Rentals' },
      bank: { bank: 'CBE', accountName: 'Eskista Marketplace PLC', accountNumber: '1000 1' },
    }),
    collectionAccounts: vi.fn().mockResolvedValue([]),
    returnSlotTimes: vi.fn().mockResolvedValue(['09:00', '14:00']),
    returnInstructions: vi.fn().mockResolvedValue([]),
  };
  const service = new BookingLifecycleService(
    prisma as never,
    settings as never,
    {} as never,
    {} as never,
    { send: vi.fn(), notifyAdmins: vi.fn() } as never,
    { cancel: vi.fn() } as never,
    { ensureBookingInvoice: vi.fn().mockResolvedValue(null) } as never,
    { ensureForBooking: vi.fn().mockResolvedValue({}) } as never,
    { put: vi.fn(), urlFor: (k: string) => `/files/${k}` } as never,
  );
  return { service, prisma, settings };
}

const leg = (
  stage: DeliveryStage,
  direction: FulfilmentDirection = FulfilmentDirection.OUTBOUND,
) => ({
  direction,
  stage,
  etaAt: new Date('2026-08-18T15:45:00Z'),
  courierName: 'Dawit Bekele',
  courierPhone: '+251911223344',
  vehicleDescription: 'Motorbike',
  vehiclePlate: 'AA 3-1024',
  address: 'Bole, Addis Ababa',
});

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  reference: 'ESK-10482',
  status: BookingStatus.DELIVERY_PICKUP,
  currency: 'ETB',
  totalMinor: 1_100_000,
  securityDepositMinor: 400_000,
  startDate: new Date('2026-08-18'),
  endDate: new Date('2026-08-21'),
  dueAt: new Date('2026-08-21T15:00:00Z'),
  listing: { name: 'Sony FX3 Cinema Camera' },
  talentProfile: null,
  fulfilments: [],
  payments: [],
  equipmentDetail: null,
  ...over,
});

describe('getTracking', () => {
  it('404s for a booking that is not yours', async () => {
    const { service } = build(null);
    await expect(service.getTracking(USER, 'ESK-X')).rejects.toThrow(NotFoundException);
  });

  it('says delivery is not arranged, rather than rendering an empty card', async () => {
    const { service } = build(booking());
    const t = await service.getTracking(USER, 'ESK-10482');

    expect(t.headline).toBe('Delivery has not been arranged yet.');
    expect(t.courierName).toBeNull();
    expect(t.isLive).toBe(false);
  });

  it('joins the vehicle and plate the way the courier card prints them', async () => {
    const { service } = build(booking({ fulfilments: [leg(DeliveryStage.OUT_FOR_DELIVERY)] }));
    const t = await service.getTracking(USER, 'ESK-10482');

    expect(t.vehicle).toBe('Motorbike · AA 3-1024');
    expect(t.statusLabel).toBe('Out for Delivery');
    expect(t.headline).toBe('Your equipment is on the way.');
  });

  it('marks earlier stages done and the current one in progress', async () => {
    const { service } = build(booking({ fulfilments: [leg(DeliveryStage.OUT_FOR_DELIVERY)] }));
    const t = await service.getTracking(USER, 'ESK-10482');

    expect(t.timeline.map((s) => s.state)).toEqual(['DONE', 'DONE', 'IN_PROGRESS', 'PENDING']);
  });

  it('is live only while a courier is actually moving', async () => {
    // The client polls while isLive is true. Polling a delivered booking forever wastes
    // the customer's data and our capacity.
    for (const [stage, live] of [
      [DeliveryStage.PREPARED, false],
      [DeliveryStage.PICKED_UP, true],
      [DeliveryStage.OUT_FOR_DELIVERY, true],
      [DeliveryStage.DELIVERED, false],
    ] as const) {
      const { service } = build(booking({ fulfilments: [leg(stage)] }));
      expect((await service.getTracking(USER, 'ESK-10482')).isLive, stage).toBe(live);
    }
  });

  it('follows the return leg once there is one', async () => {
    const { service } = build(
      booking({
        fulfilments: [
          leg(DeliveryStage.DELIVERED),
          leg(DeliveryStage.PICKED_UP, FulfilmentDirection.RETURN),
        ],
      }),
    );
    const t = await service.getTracking(USER, 'ESK-10482');

    expect(t.direction).toBe('RETURN');
    expect(t.statusLabel).toBe('Collected');
    expect(t.headline).toBe('Your return is on its way to Eskista.');
  });
});

describe('getPaymentInstructions', () => {
  it('asks for the total plus the deposit, not the goods-only total', async () => {
    // Showing 11,000 here would have the customer transfer 4,000 too little.
    const { service } = build(booking({ status: BookingStatus.AWAITING_PAYMENT }));
    const p = await service.getPaymentInstructions(USER, 'ESK-10482');

    expect(p.amountDueMinor).toBe(1_500_000);
  });

  it('blocks submission while the request is still under review', async () => {
    const { service } = build(booking({ status: BookingStatus.ESKISTA_REVIEW }));
    const p = await service.getPaymentInstructions(USER, 'ESK-10482');

    expect(p.canSubmit).toBe(false);
    expect(p.blockedReason).toContain('reviewing');
  });

  it('blocks a second submission while one is pending', async () => {
    const { service } = build(
      booking({
        status: BookingStatus.AWAITING_PAYMENT,
        payments: [{ status: PaymentStatus.SUBMITTED, amountMinor: 1_500_000 }],
      }),
    );
    const p = await service.getPaymentInstructions(USER, 'ESK-10482');

    expect(p.canSubmit).toBe(false);
    expect(p.blockedReason).toContain('verifying');
  });

  it('counts only verified payments as paid', async () => {
    const { service } = build(
      booking({
        status: BookingStatus.AWAITING_PAYMENT,
        payments: [
          { status: PaymentStatus.VERIFIED, amountMinor: 500_000 },
          { status: PaymentStatus.REJECTED, amountMinor: 999_999 },
        ],
      }),
    );
    const p = await service.getPaymentInstructions(USER, 'ESK-10482');

    expect(p.amountPaidMinor).toBe(500_000);
  });

  it('returns null for an account Eskista has not configured, rather than a broken one', async () => {
    const { service, settings } = build(booking({ status: BookingStatus.AWAITING_PAYMENT }));
    settings.paymentAccounts.mockResolvedValue({ telebirr: { number: '0911' } });

    const p = await service.getPaymentInstructions(USER, 'ESK-10482');

    expect(p.telebirr).toBeNull(); // accountName missing
    expect(p.bank).toBeNull();
  });
});

describe('agreement before payment', () => {
  // The booking's actions say "sign first"; the endpoint must enforce the same, or a client
  // that ignores a disabled button can pay against an unsigned contract.
  it('blocks payment while the agreement is awaiting the customer’s signed copy', async () => {
    const { service } = build(
      booking({
        status: BookingStatus.AWAITING_PAYMENT,
        agreements: [{ status: AgreementStatus.AWAITING_UPLOAD }],
      }),
    );
    const p = await service.getPaymentInstructions(USER, 'ESK-10482');
    expect(p.canSubmit).toBe(false);
    expect(p.blockedReason).toContain('agreement');
  });

  it('blocks it again when the scan was rejected', async () => {
    const { service } = build(
      booking({
        status: BookingStatus.AWAITING_PAYMENT,
        agreements: [{ status: AgreementStatus.REJECTED }],
      }),
    );
    expect((await service.getPaymentInstructions(USER, 'ESK-10482')).canSubmit).toBe(false);
  });

  it('opens payment once the scan is uploaded, without waiting for Eskista’s review', async () => {
    const { service } = build(
      booking({
        status: BookingStatus.AWAITING_PAYMENT,
        agreements: [{ status: AgreementStatus.UNDER_REVIEW }],
      }),
    );
    expect((await service.getPaymentInstructions(USER, 'ESK-10482')).canSubmit).toBe(true);
  });

  it('enforces the gate on submission too, not just in the instructions', async () => {
    const { service } = build(
      booking({
        status: BookingStatus.AWAITING_PAYMENT,
        agreements: [{ status: AgreementStatus.AWAITING_UPLOAD }],
      }),
    );
    await expect(
      service.submitPayment(
        USER,
        'ESK-10482',
        { method: 'TELEBIRR', transactionReference: 'TBR1', amountMinor: 1 },
        undefined,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('getReturnOptions', () => {
  it('shows a slot past the deadline as unavailable rather than hiding it', async () => {
    // A customer who has missed the deadline should see why, not wonder where it went.
    const { service } = build(booking({ dueAt: new Date('2026-08-21T12:00:00Z') }));
    const r = await service.getReturnOptions(USER, 'ESK-10482');

    const byTime = new Map(r.slots.map((s) => [s.startsAt.slice(11, 16), s.available]));
    expect(byTime.get('09:00')).toBe(true);
    expect(byTime.get('14:00')).toBe(false);
  });

  it('falls back to default instructions when none are configured', async () => {
    const { service } = build(booking());
    const r = await service.getReturnOptions(USER, 'ESK-10482');

    expect(r.instructions.length).toBeGreaterThan(0);
  });
});

describe('scheduleReturn', () => {
  it('refuses before the customer actually has the equipment', async () => {
    const { service } = build(booking({ status: BookingStatus.AWAITING_PAYMENT }));

    await expect(
      service.scheduleReturn(USER, 'ESK-10482', {
        method: 'DROP_OFF',
        scheduledAt: '2026-08-21T09:00:00.000Z',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('requires an address when Eskista is collecting', async () => {
    const { service } = build(booking({ status: BookingStatus.IN_PROGRESS }));

    await expect(
      service.scheduleReturn(USER, 'ESK-10482', {
        method: 'SCHEDULED_PICKUP',
        scheduledAt: '2026-08-21T09:00:00.000Z',
      }),
    ).rejects.toThrow('address is required');
  });
});
