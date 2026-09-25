import { BookingStatus, SupplierResponse } from '@prisma/client';
import {
  VENDOR_STEPS,
  buildChecklist,
  buildVendorActions,
  buildVendorTimeline,
  currentStep,
  gradeForRating,
  listingReviewSteps,
  parseChecklist,
  vendorBadge,
  type HandoverState,
  type VendorViewInput,
} from './vendor-booking-view';

const noHandover: HandoverState = {
  preparedAt: null,
  methodChosenAt: null,
  handedOverAt: null,
  returnConfirmedAt: null,
  payoutConfirmedAt: null,
};
const at = new Date('2026-08-17T09:00:00Z');

const view = (
  status: BookingStatus,
  handover: Partial<HandoverState> | null = null,
  extra: Partial<VendorViewInput> = {},
): VendorViewInput => ({
  status,
  supplierResponse: SupplierResponse.ACCEPTED,
  handover: handover ? { ...noHandover, ...handover } : null,
  settlementPaid: false,
  ...extra,
});

const keys = (v: VendorViewInput, hasInspection = false) =>
  buildVendorActions({ ...v, hasInspection }).map((a) => a.key);
const primary = (v: VendorViewInput, hasInspection = false) =>
  buildVendorActions({ ...v, hasInspection }).find((a) => a.primary)?.key;

describe('vendor timeline — the ten steps', () => {
  it('has the ten steps of the design, in order', () => {
    expect(VENDOR_STEPS.map((s) => s.label)).toEqual([
      'Request Submitted',
      'Booking Confirmation',
      'Payment',
      'Equipment Preparation',
      'Handover',
      'Rental Active',
      'Return Scheduled',
      'Equipment Returned',
      'Settlement',
      'Rental Closed',
    ]);
  });

  it('waits on Booking Confirmation while the request is pending', () => {
    const t = buildVendorTimeline(view(BookingStatus.REQUEST_SUBMITTED));
    expect(t[0]?.state).toBe('DONE');
    expect(t[1]?.state).toBe('IN_PROGRESS');
  });

  it('moves from preparation to handover once the vendor marks it ready', () => {
    expect(currentStep(view(BookingStatus.BOOKING_CONFIRMED))).toBe(3);
    expect(currentStep(view(BookingStatus.BOOKING_CONFIRMED, { preparedAt: at }))).toBe(4);
  });

  it('moves on to Rental Active as soon as the vendor has handed over', () => {
    expect(
      currentStep(view(BookingStatus.BOOKING_CONFIRMED, { preparedAt: at, handedOverAt: at })),
    ).toBe(5);
  });

  it('keeps Handover open under delivery until the vendor confirms it', () => {
    expect(currentStep(view(BookingStatus.DELIVERY_PICKUP, { preparedAt: at }))).toBe(4);
    expect(
      currentStep(view(BookingStatus.DELIVERY_PICKUP, { preparedAt: at, handedOverAt: at })),
    ).toBe(5);
  });

  it('marks everything done once closed', () => {
    expect(buildVendorTimeline(view(BookingStatus.CLOSED)).every((s) => s.state === 'DONE')).toBe(
      true,
    );
  });

  it('shows nothing in progress on a cancelled booking', () => {
    const t = buildVendorTimeline(view(BookingStatus.CANCELLED));
    expect(t.some((s) => s.state === 'IN_PROGRESS')).toBe(false);
  });
});

describe('vendor actions — the buttons at each stage', () => {
  it('offers Accept and Decline on a new request', () => {
    const v = view(BookingStatus.REQUEST_SUBMITTED, null, {
      supplierResponse: SupplierResponse.PENDING,
    });
    expect(keys(v)).toEqual(['ACCEPT_BOOKING', 'DECLINE_REQUEST', 'CONTACT_ESKISTA']);
  });

  it('points to Prepare Equipment after accepting, even before payment', () => {
    expect(primary(view(BookingStatus.AWAITING_PAYMENT))).toBe('PREPARE_EQUIPMENT');
  });

  it('walks prepare → choose handover → confirm handover → track', () => {
    const s = BookingStatus.BOOKING_CONFIRMED;
    expect(primary(view(s, {}))).toBe('PREPARE_EQUIPMENT');
    expect(primary(view(s, { preparedAt: at }))).toBe('CHOOSE_HANDOVER');
    expect(primary(view(s, { preparedAt: at, methodChosenAt: at }))).toBe('CONFIRM_HANDOVER');
    expect(primary(view(s, { preparedAt: at, methodChosenAt: at, handedOverAt: at }))).toBe(
      'TRACK_EQUIPMENT',
    );
  });

  it('greys out inspection results until Eskista has inspected', () => {
    const actions = buildVendorActions({
      ...view(BookingStatus.INSPECTION),
      hasInspection: false,
    });
    expect(actions.find((a) => a.key === 'VIEW_INSPECTION')?.enabled).toBe(false);
  });

  it('asks to confirm the return, then the payment, then to complete', () => {
    const s = BookingStatus.SETTLEMENT;
    expect(primary(view(s, {}), true)).toBe('CONFIRM_RETURN');
    expect(primary(view(s, { returnConfirmedAt: at }), true)).toBe('CONFIRM_PAYMENT');
    expect(primary(view(s, { returnConfirmedAt: at, payoutConfirmedAt: at }), true)).toBe(
      'COMPLETE_BOOKING',
    );
  });

  it('keeps Confirm Payment disabled until Eskista has paid out', () => {
    const unpaid = buildVendorActions({
      ...view(BookingStatus.SETTLEMENT, { returnConfirmedAt: at }),
      hasInspection: true,
    }).find((a) => a.key === 'CONFIRM_PAYMENT');
    expect(unpaid?.enabled).toBe(false);

    const paid = buildVendorActions({
      ...view(BookingStatus.SETTLEMENT, { returnConfirmedAt: at }, { settlementPaid: true }),
      hasInspection: true,
    }).find((a) => a.key === 'CONFIRM_PAYMENT');
    expect(paid?.enabled).toBe(true);
  });

  it('always offers Contact Eskista Support', () => {
    for (const status of Object.values(BookingStatus)) {
      expect(keys(view(status))).toContain('CONTACT_ESKISTA');
    }
  });
});

describe('badges', () => {
  it('reads Pending, then Pending Confirmation once the vendor accepted', () => {
    expect(vendorBadge(BookingStatus.REQUEST_SUBMITTED, SupplierResponse.PENDING).label).toBe(
      'Pending',
    );
    expect(vendorBadge(BookingStatus.ESKISTA_REVIEW, SupplierResponse.ACCEPTED).label).toBe(
      'Pending Confirmation',
    );
  });

  it('matches the design chips for live, inspecting and finished bookings', () => {
    expect(vendorBadge(BookingStatus.IN_PROGRESS, SupplierResponse.ACCEPTED).label).toBe(
      'Active Rental',
    );
    expect(vendorBadge(BookingStatus.INSPECTION, SupplierResponse.ACCEPTED).label).toBe(
      'In-Progress',
    );
    expect(vendorBadge(BookingStatus.CLOSED, SupplierResponse.ACCEPTED).label).toBe('Completed');
    expect(vendorBadge(BookingStatus.REJECTED, SupplierResponse.ACCEPTED).label).toBe('Rejected');
  });
});

describe('preparation checklist', () => {
  it('lists the equipment, each included item, then the standard checks', () => {
    const list = buildChecklist('Sony FX3 Camera Body', [
      { name: 'Battery', quantity: 2 },
      { name: 'Charger', quantity: 1 },
    ]);
    expect(list.map((i) => i.label)).toEqual([
      'Sony FX3 Camera Body',
      'Battery x2',
      'Charger',
      'Original accessories',
      'Equipment tested',
      'Equipment cleaned',
    ]);
    expect(list.every((i) => !i.done)).toBe(true);
  });

  it('reads stored JSON defensively', () => {
    expect(parseChecklist(null)).toEqual([]);
    expect(parseChecklist([{ key: 'a', label: 'A', done: true }, { junk: 1 }])).toEqual([
      { key: 'a', label: 'A', done: true },
    ]);
  });
});

describe('condition rating', () => {
  it('maps the ten stars onto the advertised grade', () => {
    expect([10, 9, 8, 7, 6, 5, 4, 1].map(gradeForRating)).toEqual([
      'NEW',
      'LIKE_NEW',
      'EXCELLENT',
      'EXCELLENT',
      'GOOD',
      'GOOD',
      'FAIR',
      'FAIR',
    ]);
  });
});

describe('listing review tracker', () => {
  it('shows Eskista Review in progress after submission', () => {
    const steps = listingReviewSteps('PENDING_REVIEW', false);
    expect(steps.map((s) => s.state)).toEqual(['DONE', 'IN_PROGRESS', 'PENDING', 'PENDING']);
  });

  it('is complete once published with a unit to rent', () => {
    expect(listingReviewSteps('PUBLISHED', true).every((s) => s.state === 'DONE')).toBe(true);
  });
});
