import { BookingStatus, BookingType } from '@prisma/client';

/**
 * Timelines and available actions, derived from a booking's state.
 *
 * Pure functions over plain data — no database, no injection — so every branch is
 * exercisable in a unit test without a running Postgres.
 *
 * Both live here rather than in the client because the same rules already govern what the
 * endpoints permit. Written twice, in two languages, they would drift, and the UI would
 * start offering buttons the API rejects.
 */

export type StepState = 'DONE' | 'IN_PROGRESS' | 'PENDING';

export interface TimelineStep {
  key: string;
  label: string;
  state: StepState;
  occurredAt: string | null;
}

interface StepDefinition {
  key: string;
  label: string;
  /** Statuses that mean this step is the one currently happening. */
  active: BookingStatus[];
}

/**
 * The eight steps on the equipment booking screens.
 *
 * `IN_PROGRESS` sits under "Return Pending" rather than "Delivery / Pickup": once the
 * equipment is with the customer, the design ticks Delivery off and highlights the return.
 */
const EQUIPMENT_STEPS: StepDefinition[] = [
  {
    key: 'REQUEST_SUBMITTED',
    label: 'Request Submitted',
    active: [BookingStatus.REQUEST_SUBMITTED],
  },
  { key: 'UNDER_REVIEW', label: 'Under Review', active: [BookingStatus.ESKISTA_REVIEW] },
  { key: 'PAYMENT', label: 'Payment', active: [BookingStatus.AWAITING_PAYMENT] },
  {
    key: 'BOOKING_CONFIRMED',
    label: 'Booking Confirmed',
    active: [BookingStatus.BOOKING_CONFIRMED],
  },
  { key: 'DELIVERY_PICKUP', label: 'Delivery / Pickup', active: [BookingStatus.DELIVERY_PICKUP] },
  {
    key: 'RETURN_PENDING',
    label: 'Return Pending',
    active: [
      BookingStatus.IN_PROGRESS,
      BookingStatus.RENTAL_COMPLETED,
      BookingStatus.RETURN_SCHEDULED,
    ],
  },
  {
    key: 'INSPECTION',
    label: 'Inspection',
    active: [BookingStatus.RETURN_RECEIVED, BookingStatus.INSPECTION],
  },
  {
    key: 'COMPLETED',
    label: 'Completed',
    active: [BookingStatus.SETTLEMENT, BookingStatus.CLOSED],
  },
];

/**
 * The six steps on the talent screens.
 *
 * Shorter than the equipment path because there is nothing to deliver, return or inspect:
 * "Talent Confirmation" replaces Eskista's availability check, and "Project / Hire" covers
 * the engagement itself.
 */
const TALENT_STEPS: StepDefinition[] = [
  {
    key: 'REQUEST_SUBMITTED',
    label: 'Request Submitted',
    active: [BookingStatus.REQUEST_SUBMITTED],
  },
  {
    key: 'TALENT_CONFIRMATION',
    label: 'Talent Confirmation',
    active: [BookingStatus.ESKISTA_REVIEW],
  },
  { key: 'PAYMENT', label: 'Payment', active: [BookingStatus.AWAITING_PAYMENT] },
  {
    key: 'BOOKING_CONFIRMED',
    label: 'Booking Confirmed',
    active: [BookingStatus.BOOKING_CONFIRMED],
  },
  {
    key: 'PROJECT_HIRE',
    label: 'Project / Hire',
    active: [
      BookingStatus.DELIVERY_PICKUP,
      BookingStatus.IN_PROGRESS,
      BookingStatus.RENTAL_COMPLETED,
      BookingStatus.RETURN_SCHEDULED,
      BookingStatus.RETURN_RECEIVED,
      BookingStatus.INSPECTION,
    ],
  },
  {
    key: 'COMPLETED',
    label: 'Completed',
    active: [BookingStatus.SETTLEMENT, BookingStatus.CLOSED],
  },
];

/** The four-step delivery sub-tracker on Track Your Equipment. */
export const DELIVERY_STEPS = [
  { key: 'PREPARED', label: 'Equipment Prepared' },
  { key: 'PICKED_UP', label: 'Picked Up' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
] as const;

/** The five-step return sub-tracker on Equipment Return. */
export const RETURN_STEPS = [
  { key: 'RENTAL_COMPLETED', label: 'Rental Completed' },
  { key: 'PICKUP_SCHEDULED', label: 'Pickup Scheduled' },
  { key: 'EQUIPMENT_RECEIVED', label: 'Equipment Received' },
  { key: 'INSPECTION', label: 'Inspection' },
  { key: 'RENTAL_CLOSED', label: 'Rental Closed' },
] as const;

/**
 * The five-step return tracker on the Equipment Return screen.
 *
 * Driven by the **booking's** status, not the courier's stage: "Equipment Received" and
 * "Inspection" are things Eskista does after the courier's job is over, so a courier-stage
 * mapping cannot express them.
 */
export function buildReturnTimeline(status: BookingStatus): TimelineStep[] {
  const reachedByStatus: Partial<Record<BookingStatus, number>> = {
    [BookingStatus.IN_PROGRESS]: 0,
    [BookingStatus.RENTAL_COMPLETED]: 0,
    [BookingStatus.RETURN_SCHEDULED]: 1,
    [BookingStatus.RETURN_RECEIVED]: 2,
    [BookingStatus.INSPECTION]: 3,
    [BookingStatus.SETTLEMENT]: 4,
    [BookingStatus.CLOSED]: 5,
  };
  // Anything earlier than the rental ending has not entered the return at all.
  const reached = reachedByStatus[status] ?? -1;

  return RETURN_STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    state: index < reached ? 'DONE' : index === reached ? 'IN_PROGRESS' : 'PENDING',
    occurredAt: null,
  }));
}

/** Statuses that end a booking without completing it. */
const TERMINAL_UNHAPPY: BookingStatus[] = [
  BookingStatus.REJECTED,
  BookingStatus.CANCELLED,
  BookingStatus.EXPIRED,
];

export function stepsFor(type: BookingType): StepDefinition[] {
  return type === BookingType.TALENT ? TALENT_STEPS : EQUIPMENT_STEPS;
}

/**
 * Builds the progress tracker.
 *
 * A step is DONE once the booking has moved past it, IN_PROGRESS for the current one, and
 * PENDING beyond. `occurredAt` is filled from the recorded status history, so a step the
 * booking skipped still reads as DONE but carries no timestamp rather than a fabricated one.
 *
 * A cancelled or rejected booking keeps whatever it had achieved and marks nothing as
 * in-progress — the design has no "cancelled" step, and inventing one would be a lie about
 * what happened.
 */
export function buildTimeline(
  type: BookingType,
  status: BookingStatus,
  occurredAtByKey: ReadonlyMap<string, Date> = new Map(),
): TimelineStep[] {
  const steps = stepsFor(type);
  const isUnhappy = TERMINAL_UNHAPPY.includes(status);

  // A draft has not entered the timeline at all.
  const currentIndex =
    status === BookingStatus.DRAFT ? -1 : steps.findIndex((s) => s.active.includes(status));

  // A status not on the board (cancelled, rejected, expired) leaves progress where the
  // history says it got to, rather than resetting it to nothing.
  const reached = currentIndex >= 0 ? currentIndex : highestReached(steps, occurredAtByKey);

  return steps.map((step, index) => {
    let state: StepState = 'PENDING';
    if (index < reached) state = 'DONE';
    else if (index === reached) state = isUnhappy || currentIndex < 0 ? 'DONE' : 'IN_PROGRESS';

    // The last step being "in progress" reads oddly; once reached, it is simply done.
    if (index === steps.length - 1 && state === 'IN_PROGRESS' && status === BookingStatus.CLOSED) {
      state = 'DONE';
    }

    return {
      key: step.key,
      label: step.label,
      state,
      occurredAt: occurredAtByKey.get(step.key)?.toISOString() ?? null,
    };
  });
}

function highestReached(
  steps: StepDefinition[],
  occurredAtByKey: ReadonlyMap<string, Date>,
): number {
  let highest = -1;
  steps.forEach((step, index) => {
    if (occurredAtByKey.has(step.key)) highest = index;
  });
  return highest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export type ActionKey =
  | 'EDIT_DRAFT'
  | 'SUBMIT_REQUEST'
  | 'DELETE_DRAFT'
  | 'TRACK_BOOKING'
  | 'CANCEL_REQUEST'
  | 'SIGN_AGREEMENT'
  | 'COMPLETE_PAYMENT'
  | 'TRACK_DELIVERY'
  | 'ARRANGE_RETURN'
  | 'TRACK_RETURN'
  | 'COMPLETE_SERVICE'
  | 'REPORT_ISSUE'
  | 'LEAVE_REVIEW'
  | 'BOOK_AGAIN'
  | 'VIEW_DETAILS';

export interface BookingAction {
  key: ActionKey;
  label: string;
  primary: boolean;
  enabled: boolean;
  /** Shown when `enabled` is false, so the button can explain itself. */
  disabledReason: string | null;
}

export interface ActionContext {
  type: BookingType;
  status: BookingStatus;
  /** True once the customer's agreement for this booking is signed. */
  agreementSigned: boolean;
  /** True when an agreement exists and is awaiting this customer's signature. */
  agreementPending: boolean;
  /** True while a submitted payment is waiting for Eskista to verify it. */
  paymentPending: boolean;
  hasReview: boolean;
}

/**
 * Which buttons a booking should offer, and which of them is the primary one.
 *
 * This list is for rendering only. Every endpoint re-checks its own preconditions
 * independently, so a client that ignores `enabled` gets a 4xx rather than a side effect.
 */
export function buildActions(ctx: ActionContext): BookingAction[] {
  const actions: BookingAction[] = [];
  const isTalent = ctx.type === BookingType.TALENT;

  const add = (
    key: ActionKey,
    label: string,
    primary = false,
    enabled = true,
    disabledReason: string | null = null,
  ): void => {
    actions.push({ key, label, primary, enabled, disabledReason });
  };

  switch (ctx.status) {
    case BookingStatus.DRAFT:
      add('EDIT_DRAFT', 'Continue Editing', true);
      add('SUBMIT_REQUEST', 'Submit Request');
      add('DELETE_DRAFT', 'Delete Draft');
      break;

    case BookingStatus.REQUEST_SUBMITTED:
    case BookingStatus.ESKISTA_REVIEW:
      add('TRACK_BOOKING', 'Track Booking', true);
      // The design greys out "Continue To Payment" while under review rather than hiding
      // it, so the customer can see what comes next.
      add(
        'COMPLETE_PAYMENT',
        'Continue To Payment',
        false,
        false,
        isTalent
          ? 'Eskista is confirming availability with the talent.'
          : 'Eskista is confirming availability with the vendor.',
      );
      add('CANCEL_REQUEST', 'Cancel Request');
      break;

    case BookingStatus.AWAITING_PAYMENT:
      if (ctx.agreementPending) {
        // The agreement gates payment: paying for terms you have not accepted is
        // exactly the ambiguity the contract exists to remove.
        add('SIGN_AGREEMENT', 'Download & Sign Agreement', true);
        add(
          'COMPLETE_PAYMENT',
          'Continue To Payment',
          false,
          false,
          'Download, sign and upload the rental agreement first.',
        );
      } else if (ctx.paymentPending) {
        add('TRACK_BOOKING', 'Track Booking', true);
        add(
          'COMPLETE_PAYMENT',
          'Payment Submitted',
          false,
          false,
          'Eskista is verifying your payment.',
        );
      } else {
        add('COMPLETE_PAYMENT', 'Complete Payment', true);
      }
      add('CANCEL_REQUEST', 'Cancel Request');
      break;

    case BookingStatus.BOOKING_CONFIRMED:
      add(
        isTalent ? 'TRACK_BOOKING' : 'TRACK_DELIVERY',
        isTalent ? 'Track Booking' : 'Track Delivery / Confirm Pick Up',
        true,
      );
      add('VIEW_DETAILS', 'View Full Booking Details');
      add('CANCEL_REQUEST', 'Cancel Request');
      break;

    case BookingStatus.DELIVERY_PICKUP:
      add('TRACK_DELIVERY', 'Track Delivery', true);
      add('VIEW_DETAILS', 'View Full Booking Details');
      add('REPORT_ISSUE', 'Report an Issue');
      break;

    case BookingStatus.IN_PROGRESS:
    case BookingStatus.RENTAL_COMPLETED:
      if (isTalent && ctx.status === BookingStatus.RENTAL_COMPLETED) {
        // Already confirmed; waiting on Eskista to settle and close.
        add('VIEW_DETAILS', 'View Full Booking Details', true);
        add('REPORT_ISSUE', 'Report an Issue');
        break;
      }
      if (isTalent) {
        add('COMPLETE_SERVICE', 'Complete Service', true);
      } else {
        add('ARRANGE_RETURN', 'Arrange Return', true);
      }
      add('VIEW_DETAILS', 'View Full Booking Details');
      add('REPORT_ISSUE', 'Report an Issue');
      break;

    case BookingStatus.RETURN_SCHEDULED:
      add('TRACK_RETURN', 'Track Return', true);
      add('REPORT_ISSUE', 'Report an Issue');
      break;

    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
    case BookingStatus.SETTLEMENT:
      add('VIEW_DETAILS', 'View Full Booking Details', true);
      add('REPORT_ISSUE', 'Report an Issue');
      break;

    case BookingStatus.CLOSED:
      if (!ctx.hasReview) add('LEAVE_REVIEW', 'Rate Your Experience', true);
      add('BOOK_AGAIN', 'Book Again', ctx.hasReview);
      add('VIEW_DETAILS', 'View Details');
      break;

    case BookingStatus.REJECTED:
    case BookingStatus.CANCELLED:
    case BookingStatus.EXPIRED:
      add('BOOK_AGAIN', 'Book Again', true);
      add('VIEW_DETAILS', 'View Details');
      break;
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────────

export const BOOKING_TABS = ['active', 'upcoming', 'completed', 'drafts'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

/**
 * Which statuses belong under each tab of My Bookings.
 *
 * - **upcoming** — agreed or still being agreed, but the rental has not started.
 * - **active** — the customer physically has the equipment, or the engagement is running.
 * - **completed** — finished, one way or another. Cancelled and rejected bookings live
 *   here too: they are over, and the alternative is a booking that vanishes from the app.
 * - **drafts** — not in the designs, but "Save Draft" has to lead somewhere retrievable
 *   or the button is a dead end.
 */
export function statusesForTab(tab: BookingTab): BookingStatus[] {
  switch (tab) {
    case 'drafts':
      return [BookingStatus.DRAFT];
    case 'upcoming':
      return [
        BookingStatus.REQUEST_SUBMITTED,
        BookingStatus.ESKISTA_REVIEW,
        BookingStatus.AWAITING_PAYMENT,
        BookingStatus.BOOKING_CONFIRMED,
      ];
    case 'active':
      return [
        BookingStatus.DELIVERY_PICKUP,
        BookingStatus.IN_PROGRESS,
        BookingStatus.RENTAL_COMPLETED,
        BookingStatus.RETURN_SCHEDULED,
        BookingStatus.RETURN_RECEIVED,
        BookingStatus.INSPECTION,
      ];
    case 'completed':
      return [
        BookingStatus.SETTLEMENT,
        BookingStatus.CLOSED,
        BookingStatus.REJECTED,
        BookingStatus.CANCELLED,
        BookingStatus.EXPIRED,
      ];
  }
}

/** The coloured chip on a booking card. */
export function statusBadge(status: BookingStatus): { label: string; tone: string } {
  switch (status) {
    case BookingStatus.DRAFT:
      return { label: 'Draft', tone: 'NEUTRAL' };
    case BookingStatus.REQUEST_SUBMITTED:
    case BookingStatus.ESKISTA_REVIEW:
    case BookingStatus.AWAITING_PAYMENT:
      return { label: 'Pending', tone: 'WARNING' };
    case BookingStatus.BOOKING_CONFIRMED:
      return { label: 'Confirmed', tone: 'SUCCESS' };
    case BookingStatus.DELIVERY_PICKUP:
      return { label: 'Out for Delivery', tone: 'INFO' };
    case BookingStatus.IN_PROGRESS:
      return { label: 'Active', tone: 'SUCCESS' };
    case BookingStatus.RENTAL_COMPLETED:
    case BookingStatus.RETURN_SCHEDULED:
      return { label: 'Return Scheduled', tone: 'WARNING' };
    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
      return { label: 'Inspection', tone: 'INFO' };
    case BookingStatus.SETTLEMENT:
    case BookingStatus.CLOSED:
      return { label: 'Completed', tone: 'SUCCESS' };
    case BookingStatus.REJECTED:
      return { label: 'Declined', tone: 'DANGER' };
    case BookingStatus.CANCELLED:
      return { label: 'Cancelled', tone: 'DANGER' };
    case BookingStatus.EXPIRED:
      return { label: 'Expired', tone: 'NEUTRAL' };
  }
}
