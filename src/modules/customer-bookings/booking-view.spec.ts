import { BookingStatus, BookingType } from '@prisma/client';
import {
  type ActionContext,
  buildActions,
  buildReturnTimeline,
  buildTimeline,
  statusBadge,
  statusesForTab,
  stepsFor,
} from './booking-view';

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  type: BookingType.EQUIPMENT,
  status: BookingStatus.AWAITING_PAYMENT,
  agreementSigned: false,
  agreementPending: false,
  paymentPending: false,
  hasReview: false,
  ...over,
});

const keys = (c: ActionContext): string[] => buildActions(c).map((a) => a.key);
const primary = (c: ActionContext): string | undefined =>
  buildActions(c).find((a) => a.primary)?.key;

describe('buildTimeline', () => {
  it('gives equipment the eight steps the designs show, in order', () => {
    const steps = buildTimeline(BookingType.EQUIPMENT, BookingStatus.REQUEST_SUBMITTED);
    expect(steps.map((s) => s.label)).toEqual([
      'Request Submitted',
      'Under Review',
      'Payment',
      'Booking Confirmed',
      'Delivery / Pickup',
      'Return Pending',
      'Inspection',
      'Completed',
    ]);
  });

  it('gives talent the six steps the designs show, in order', () => {
    const steps = buildTimeline(BookingType.TALENT, BookingStatus.REQUEST_SUBMITTED);
    expect(steps.map((s) => s.label)).toEqual([
      'Request Submitted',
      'Talent Confirmation',
      'Payment',
      'Booking Confirmed',
      'Project / Hire',
      'Completed',
    ]);
  });

  it('marks everything before the current step DONE and everything after PENDING', () => {
    const steps = buildTimeline(BookingType.EQUIPMENT, BookingStatus.AWAITING_PAYMENT);
    expect(steps.map((s) => s.state)).toEqual([
      'DONE',
      'DONE',
      'IN_PROGRESS',
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
  });

  it('puts an in-flight rental on Return Pending, not Delivery', () => {
    // Once the customer has the equipment, the design ticks Delivery off.
    const steps = buildTimeline(BookingType.EQUIPMENT, BookingStatus.IN_PROGRESS);
    const byKey = new Map(steps.map((s) => [s.key, s.state]));
    expect(byKey.get('DELIVERY_PICKUP')).toBe('DONE');
    expect(byKey.get('RETURN_PENDING')).toBe('IN_PROGRESS');
  });

  it('shows a closed booking as fully done, with no step still in progress', () => {
    const steps = buildTimeline(BookingType.EQUIPMENT, BookingStatus.CLOSED);
    expect(steps.every((s) => s.state === 'DONE')).toBe(true);
  });

  it('leaves a draft entirely pending — it has not entered the timeline', () => {
    const steps = buildTimeline(BookingType.EQUIPMENT, BookingStatus.DRAFT);
    expect(steps.every((s) => s.state === 'PENDING')).toBe(true);
  });

  it('keeps the progress a cancelled booking had reached, and stops there', () => {
    // Cancelled after review. The design has no "cancelled" step, so nothing is
    // in-progress and the history is preserved rather than reset.
    const history = new Map([
      ['REQUEST_SUBMITTED', new Date('2026-08-14T09:05:00Z')],
      ['UNDER_REVIEW', new Date('2026-08-15T11:20:00Z')],
    ]);
    const steps = buildTimeline(BookingType.EQUIPMENT, BookingStatus.CANCELLED, history);

    expect(steps.map((s) => s.state)).toEqual([
      'DONE',
      'DONE',
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    expect(steps.some((s) => s.state === 'IN_PROGRESS')).toBe(false);
  });

  it('fills occurredAt from history and leaves skipped steps null rather than inventing one', () => {
    const history = new Map([['REQUEST_SUBMITTED', new Date('2026-08-14T09:05:00Z')]]);
    const steps = buildTimeline(BookingType.EQUIPMENT, BookingStatus.ESKISTA_REVIEW, history);

    expect(steps[0]?.occurredAt).toBe('2026-08-14T09:05:00.000Z');
    expect(steps[1]?.occurredAt).toBeNull();
  });

  it('covers every non-draft status on the equipment board', () => {
    // A status with no step would silently render an empty tracker.
    const onBoard = new Set(stepsFor(BookingType.EQUIPMENT).flatMap((s) => s.active));
    const unmapped = [
      BookingStatus.REQUEST_SUBMITTED,
      BookingStatus.ESKISTA_REVIEW,
      BookingStatus.AWAITING_PAYMENT,
      BookingStatus.BOOKING_CONFIRMED,
      BookingStatus.DELIVERY_PICKUP,
      BookingStatus.IN_PROGRESS,
      BookingStatus.RENTAL_COMPLETED,
      BookingStatus.RETURN_SCHEDULED,
      BookingStatus.RETURN_RECEIVED,
      BookingStatus.INSPECTION,
      BookingStatus.SETTLEMENT,
      BookingStatus.CLOSED,
    ].filter((s) => !onBoard.has(s));

    expect(unmapped).toEqual([]);
  });
});

describe('buildActions', () => {
  it('offers a draft the three things you can do with a draft', () => {
    expect(keys(ctx({ status: BookingStatus.DRAFT }))).toEqual([
      'EDIT_DRAFT',
      'SUBMIT_REQUEST',
      'DELETE_DRAFT',
    ]);
  });

  it('disables payment while the request is under review, with a reason', () => {
    const actions = buildActions(ctx({ status: BookingStatus.ESKISTA_REVIEW }));
    const pay = actions.find((a) => a.key === 'COMPLETE_PAYMENT');

    expect(pay?.enabled).toBe(false);
    expect(pay?.disabledReason).toContain('vendor');
    expect(primary(ctx({ status: BookingStatus.ESKISTA_REVIEW }))).toBe('TRACK_BOOKING');
  });

  it('names the talent, not a vendor, when a talent request is under review', () => {
    const actions = buildActions(
      ctx({ status: BookingStatus.ESKISTA_REVIEW, type: BookingType.TALENT }),
    );
    expect(actions.find((a) => a.key === 'COMPLETE_PAYMENT')?.disabledReason).toContain('talent');
  });

  it('leads with Choose Talent once an invited talent has accepted', () => {
    const c = ctx({
      status: BookingStatus.ESKISTA_REVIEW,
      type: BookingType.TALENT,
      acceptedInvitations: 2,
    });
    expect(primary(c)).toBe('CHOOSE_TALENT');
    expect(buildActions(c).find((a) => a.key === 'COMPLETE_PAYMENT')?.disabledReason).toBe(
      'Choose who to hire first.',
    );
  });

  it('never offers Choose Talent on an equipment booking', () => {
    const c = ctx({ status: BookingStatus.ESKISTA_REVIEW, acceptedInvitations: 2 });
    expect(keys(c)).not.toContain('CHOOSE_TALENT');
  });

  it('makes payment the primary action once approved', () => {
    expect(primary(ctx({ status: BookingStatus.AWAITING_PAYMENT }))).toBe('COMPLETE_PAYMENT');
  });

  it('gates payment behind an unsigned agreement', () => {
    // Paying for terms you have not accepted is the ambiguity the contract removes.
    const c = ctx({ status: BookingStatus.AWAITING_PAYMENT, agreementPending: true });
    expect(primary(c)).toBe('SIGN_AGREEMENT');

    const pay = buildActions(c).find((a) => a.key === 'COMPLETE_PAYMENT');
    expect(pay?.enabled).toBe(false);
    expect(pay?.disabledReason).toContain('upload the rental agreement');
  });

  it('stops a customer paying twice while verification is pending', () => {
    const c = ctx({ status: BookingStatus.AWAITING_PAYMENT, paymentPending: true });
    const pay = buildActions(c).find((a) => a.key === 'COMPLETE_PAYMENT');

    expect(pay?.enabled).toBe(false);
    expect(pay?.disabledReason).toContain('verifying');
    expect(primary(c)).toBe('TRACK_BOOKING');
  });

  it('offers Arrange Return for equipment and Complete Service for talent', () => {
    expect(primary(ctx({ status: BookingStatus.IN_PROGRESS }))).toBe('ARRANGE_RETURN');
    expect(primary(ctx({ status: BookingStatus.IN_PROGRESS, type: BookingType.TALENT }))).toBe(
      'COMPLETE_SERVICE',
    );
  });

  it('asks for a review on a closed booking, then offers Book Again once given', () => {
    expect(primary(ctx({ status: BookingStatus.CLOSED }))).toBe('LEAVE_REVIEW');
    expect(keys(ctx({ status: BookingStatus.CLOSED, hasReview: true }))).not.toContain(
      'LEAVE_REVIEW',
    );
    expect(primary(ctx({ status: BookingStatus.CLOSED, hasReview: true }))).toBe('BOOK_AGAIN');
  });

  it('never offers to cancel a booking that is already over', () => {
    for (const status of [
      BookingStatus.CLOSED,
      BookingStatus.CANCELLED,
      BookingStatus.REJECTED,
      BookingStatus.EXPIRED,
    ]) {
      expect(keys(ctx({ status }))).not.toContain('CANCEL_REQUEST');
    }
  });

  it('never offers to report an issue before the equipment has moved', () => {
    for (const status of [
      BookingStatus.DRAFT,
      BookingStatus.REQUEST_SUBMITTED,
      BookingStatus.ESKISTA_REVIEW,
      BookingStatus.AWAITING_PAYMENT,
    ]) {
      expect(keys(ctx({ status }))).not.toContain('REPORT_ISSUE');
    }
  });

  it('offers at most one primary action per state, for every status', () => {
    for (const status of Object.values(BookingStatus)) {
      for (const type of [BookingType.EQUIPMENT, BookingType.TALENT]) {
        const actions = buildActions(ctx({ status, type }));
        expect(actions.filter((a) => a.primary).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('always gives every status something to do', () => {
    for (const status of Object.values(BookingStatus)) {
      expect(buildActions(ctx({ status })).length).toBeGreaterThan(0);
    }
  });
});

describe('statusesForTab', () => {
  it('assigns every status to exactly one tab, so nothing disappears from My Bookings', () => {
    const all = Object.values(BookingStatus);
    const assigned = (['active', 'upcoming', 'completed', 'drafts'] as const).flatMap((t) =>
      statusesForTab(t),
    );

    expect([...assigned].sort()).toEqual([...all].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('keeps cancelled and rejected bookings visible under Completed', () => {
    const completed = statusesForTab('completed');
    expect(completed).toContain(BookingStatus.CANCELLED);
    expect(completed).toContain(BookingStatus.REJECTED);
  });

  it('treats a confirmed but not yet delivered booking as upcoming', () => {
    expect(statusesForTab('upcoming')).toContain(BookingStatus.BOOKING_CONFIRMED);
    expect(statusesForTab('active')).not.toContain(BookingStatus.BOOKING_CONFIRMED);
  });
});

describe('statusBadge', () => {
  it('labels every status, so no card renders a blank chip', () => {
    for (const status of Object.values(BookingStatus)) {
      const badge = statusBadge(status);
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.tone.length).toBeGreaterThan(0);
    }
  });

  it('uses the labels the designs print', () => {
    expect(statusBadge(BookingStatus.IN_PROGRESS).label).toBe('Active');
    expect(statusBadge(BookingStatus.AWAITING_PAYMENT).label).toBe('Pending');
    expect(statusBadge(BookingStatus.CLOSED).label).toBe('Completed');
  });
});

describe('buildReturnTimeline', () => {
  const states = (status: BookingStatus) => buildReturnTimeline(status).map((s) => s.state);

  it('uses the five steps the Equipment Return screen shows', () => {
    expect(buildReturnTimeline(BookingStatus.IN_PROGRESS).map((s) => s.label)).toEqual([
      'Rental Completed',
      'Pickup Scheduled',
      'Equipment Received',
      'Inspection',
      'Rental Closed',
    ]);
  });

  it('follows the booking through received and inspected, which a courier cannot report', () => {
    expect(states(BookingStatus.RETURN_SCHEDULED)).toEqual([
      'DONE',
      'IN_PROGRESS',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    expect(states(BookingStatus.INSPECTION)).toEqual([
      'DONE',
      'DONE',
      'DONE',
      'IN_PROGRESS',
      'PENDING',
    ]);
  });

  it('shows a closed rental as fully done', () => {
    expect(states(BookingStatus.CLOSED).every((s) => s === 'DONE')).toBe(true);
  });

  it('has not started for a booking that is not yet out', () => {
    expect(states(BookingStatus.BOOKING_CONFIRMED).every((s) => s === 'PENDING')).toBe(true);
  });
});
