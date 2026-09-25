import { BookingStatus, SupplierResponse } from '@prisma/client';

/**
 * What the vendor's booking screens show, derived from the booking and the vendor's own
 * handover record. Pure, so each stage of the design is testable without a database.
 *
 * The booking status belongs to Eskista; the vendor's steps (prepare, hand over, confirm
 * the return, confirm the payout) sit inside those stages. The ten-step tracker on the
 * vendor's Booking Detail combines both.
 */

export type VendorStepKey =
  | 'REQUEST_SUBMITTED'
  | 'BOOKING_CONFIRMATION'
  | 'PAYMENT'
  | 'EQUIPMENT_PREPARATION'
  | 'HANDOVER'
  | 'RENTAL_ACTIVE'
  | 'RETURN_SCHEDULED'
  | 'EQUIPMENT_RETURNED'
  | 'SETTLEMENT'
  | 'RENTAL_CLOSED';

export const VENDOR_STEPS: { key: VendorStepKey; label: string }[] = [
  { key: 'REQUEST_SUBMITTED', label: 'Request Submitted' },
  { key: 'BOOKING_CONFIRMATION', label: 'Booking Confirmation' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'EQUIPMENT_PREPARATION', label: 'Equipment Preparation' },
  { key: 'HANDOVER', label: 'Handover' },
  { key: 'RENTAL_ACTIVE', label: 'Rental Active' },
  { key: 'RETURN_SCHEDULED', label: 'Return Scheduled' },
  { key: 'EQUIPMENT_RETURNED', label: 'Equipment Returned' },
  { key: 'SETTLEMENT', label: 'Settlement' },
  { key: 'RENTAL_CLOSED', label: 'Rental Closed' },
];

export interface HandoverState {
  preparedAt: Date | null;
  methodChosenAt: Date | null;
  handedOverAt: Date | null;
  returnConfirmedAt: Date | null;
  payoutConfirmedAt: Date | null;
}

export interface VendorViewInput {
  status: BookingStatus;
  supplierResponse: SupplierResponse;
  handover: HandoverState | null;
  settlementPaid: boolean;
}

const ENDED: BookingStatus[] = [
  BookingStatus.REJECTED,
  BookingStatus.CANCELLED,
  BookingStatus.EXPIRED,
];

/** Index of the step currently happening; VENDOR_STEPS.length once closed. */
export function currentStep(v: VendorViewInput): number {
  const h = v.handover;
  switch (v.status) {
    case BookingStatus.DRAFT:
    case BookingStatus.REQUEST_SUBMITTED:
    case BookingStatus.ESKISTA_REVIEW:
      // The vendor's accept and Eskista's approval together are "Booking Confirmation".
      return 1;
    case BookingStatus.AWAITING_PAYMENT:
      return 2;
    case BookingStatus.BOOKING_CONFIRMED:
      // Once handed over, the vendor's part is done and the rental is Eskista's to start.
      return h?.handedOverAt ? 5 : h?.preparedAt ? 4 : 3;
    case BookingStatus.DELIVERY_PICKUP:
      // Eskista may already be dispatching; until the vendor confirms the handover the
      // step is still theirs.
      return h?.handedOverAt ? 5 : 4;
    case BookingStatus.IN_PROGRESS:
    case BookingStatus.RENTAL_COMPLETED:
      return 5;
    case BookingStatus.RETURN_SCHEDULED:
      return 6;
    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
      return 7;
    case BookingStatus.SETTLEMENT:
      return 8;
    case BookingStatus.CLOSED:
      return VENDOR_STEPS.length;
    default:
      return 1;
  }
}

export interface VendorTimelineStep {
  key: VendorStepKey;
  label: string;
  state: 'DONE' | 'IN_PROGRESS' | 'PENDING';
}

export function buildVendorTimeline(v: VendorViewInput): VendorTimelineStep[] {
  const reached = currentStep(v);
  const ended = ENDED.includes(v.status);
  return VENDOR_STEPS.map((step, index) => ({
    ...step,
    state: index < reached ? 'DONE' : index === reached && !ended ? 'IN_PROGRESS' : 'PENDING',
  }));
}

export type VendorActionKey =
  | 'ACCEPT_BOOKING'
  | 'DECLINE_REQUEST'
  | 'PREPARE_EQUIPMENT'
  | 'CHOOSE_HANDOVER'
  | 'CONFIRM_HANDOVER'
  | 'TRACK_EQUIPMENT'
  | 'VIEW_INSPECTION'
  | 'CONFIRM_RETURN'
  | 'CONFIRM_PAYMENT'
  | 'COMPLETE_BOOKING'
  | 'VIEW_FULL_DETAIL'
  | 'CONTACT_ESKISTA';

export interface VendorAction {
  key: VendorActionKey;
  label: string;
  primary: boolean;
  enabled: boolean;
  disabledReason: string | null;
}

/**
 * The buttons at the bottom of each vendor booking screen, matching the design stage by
 * stage. Rendering only — every endpoint re-checks its own preconditions.
 */
export function buildVendorActions(
  v: VendorViewInput & { hasInspection: boolean },
): VendorAction[] {
  const actions: VendorAction[] = [];
  const add = (
    key: VendorActionKey,
    label: string,
    primary = false,
    enabled = true,
    disabledReason: string | null = null,
  ) => actions.push({ key, label, primary, enabled, disabledReason });
  const h = v.handover;

  switch (v.status) {
    case BookingStatus.REQUEST_SUBMITTED:
    case BookingStatus.ESKISTA_REVIEW:
      if (v.supplierResponse === SupplierResponse.PENDING) {
        add('ACCEPT_BOOKING', 'Accept Booking', true);
        add('DECLINE_REQUEST', 'Decline Request');
      } else {
        add('VIEW_FULL_DETAIL', 'View Full Detail', true);
      }
      break;

    case BookingStatus.AWAITING_PAYMENT:
      // "Your next step: Prepare the equipment" — allowed early, so the vendor can get
      // ready while the customer pays.
      add('PREPARE_EQUIPMENT', 'Prepare Equipment', true);
      break;

    case BookingStatus.BOOKING_CONFIRMED:
    case BookingStatus.DELIVERY_PICKUP:
      if (!h?.preparedAt) {
        add('PREPARE_EQUIPMENT', 'Prepare Equipment', true);
      } else if (!h.methodChosenAt) {
        add('CHOOSE_HANDOVER', 'Choose Handover Options', true);
      } else if (!h.handedOverAt) {
        add('CONFIRM_HANDOVER', 'Confirm Handover', true);
        add('CHOOSE_HANDOVER', 'Change Handover Option');
      } else {
        add('TRACK_EQUIPMENT', 'Track Your Equipment', true);
      }
      break;

    case BookingStatus.IN_PROGRESS:
    case BookingStatus.RENTAL_COMPLETED:
    case BookingStatus.RETURN_SCHEDULED:
      add('TRACK_EQUIPMENT', 'Track Your Equipment', true);
      add('VIEW_FULL_DETAIL', 'View Full Detail');
      break;

    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
      add(
        'VIEW_INSPECTION',
        'View Inspection Results',
        true,
        v.hasInspection,
        v.hasInspection ? null : 'Eskista is inspecting the equipment.',
      );
      break;

    case BookingStatus.SETTLEMENT:
      if (!h?.returnConfirmedAt) {
        add('CONFIRM_RETURN', 'Confirm Return', true);
      } else if (!h.payoutConfirmedAt) {
        add(
          'CONFIRM_PAYMENT',
          'Confirm Payment',
          true,
          v.settlementPaid,
          v.settlementPaid ? null : 'Eskista has not sent your payout yet.',
        );
      } else {
        add('COMPLETE_BOOKING', 'Complete Booking', true);
      }
      add('VIEW_INSPECTION', 'View Inspection Detail', false, v.hasInspection);
      break;

    case BookingStatus.CLOSED:
    case BookingStatus.REJECTED:
    case BookingStatus.CANCELLED:
    case BookingStatus.EXPIRED:
      add('VIEW_FULL_DETAIL', 'View Full Detail', true);
      break;
  }

  add('CONTACT_ESKISTA', 'Contact Eskista Support');
  return actions;
}

/** The status chip on the vendor's booking screens: Pending, In-Progress, Complete... */
export function vendorBadge(
  status: BookingStatus,
  supplierResponse: SupplierResponse,
): { label: string; tone: 'WARNING' | 'INFO' | 'SUCCESS' | 'DANGER' | 'NEUTRAL' } {
  switch (status) {
    case BookingStatus.REQUEST_SUBMITTED:
    case BookingStatus.ESKISTA_REVIEW:
      return supplierResponse === SupplierResponse.DECLINED
        ? { label: 'Declined', tone: 'DANGER' }
        : supplierResponse === SupplierResponse.ACCEPTED
          ? { label: 'Pending Confirmation', tone: 'WARNING' }
          : { label: 'Pending', tone: 'WARNING' };
    case BookingStatus.AWAITING_PAYMENT:
      return { label: 'Accepted', tone: 'INFO' };
    case BookingStatus.BOOKING_CONFIRMED:
      return { label: 'Confirmed', tone: 'SUCCESS' };
    case BookingStatus.DELIVERY_PICKUP:
    case BookingStatus.IN_PROGRESS:
    case BookingStatus.RENTAL_COMPLETED:
    case BookingStatus.RETURN_SCHEDULED:
      return { label: 'Active Rental', tone: 'SUCCESS' };
    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
    case BookingStatus.SETTLEMENT:
      return { label: 'In-Progress', tone: 'WARNING' };
    case BookingStatus.CLOSED:
      return { label: 'Completed', tone: 'SUCCESS' };
    case BookingStatus.REJECTED:
      return { label: 'Rejected', tone: 'DANGER' };
    case BookingStatus.CANCELLED:
      return { label: 'Cancelled', tone: 'DANGER' };
    default:
      return { label: 'Expired', tone: 'NEUTRAL' };
  }
}

// ── Preparation checklist ────────────────────────────────────────────────────

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

/**
 * The Preparation checklist: the equipment itself, each included item, then the checks
 * every rental gets. "Camera body, Battery x2, Charger, Memory card, Original accessories,
 * Equipment tested, Equipment cleaned" in the design.
 */
export function buildChecklist(
  mainItem: string,
  included: { name: string; quantity: number }[],
): ChecklistItem[] {
  const items: ChecklistItem[] = [{ key: 'main', label: mainItem, done: false }];
  included.forEach((item, index) =>
    items.push({
      key: `included-${index}`,
      label: item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name,
      done: false,
    }),
  );
  items.push(
    { key: 'original-accessories', label: 'Original accessories', done: false },
    { key: 'tested', label: 'Equipment tested', done: false },
    { key: 'cleaned', label: 'Equipment cleaned', done: false },
  );
  return items;
}

/** Reads a stored checklist defensively; the column is JSON written by older versions too. */
export function parseChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is ChecklistItem =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as ChecklistItem).key === 'string' &&
        typeof (v as ChecklistItem).label === 'string',
    )
    .map((v) => ({ key: v.key, label: v.label, done: v.done === true }));
}

// ── Condition ────────────────────────────────────────────────────────────────

/**
 * The ten-star Condition picker, mapped to the advertised grade customers see.
 * 10 New · 9 Like new · 7–8 Excellent · 5–6 Good · 1–4 Fair.
 */
export function gradeForRating(rating: number): 'NEW' | 'LIKE_NEW' | 'EXCELLENT' | 'GOOD' | 'FAIR' {
  if (rating >= 10) return 'NEW';
  if (rating === 9) return 'LIKE_NEW';
  if (rating >= 7) return 'EXCELLENT';
  if (rating >= 5) return 'GOOD';
  return 'FAIR';
}

// ── Listing review tracker ───────────────────────────────────────────────────

/**
 * "Equipment Added → Eskista Review → Published → Available for Booking" on the
 * Equipment Submitted screen.
 */
export function listingReviewSteps(
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'SUSPENDED' | 'ARCHIVED',
  hasUnits: boolean,
): VendorTimelineStep[] {
  const steps = [
    { key: 'EQUIPMENT_ADDED', label: 'Equipment Added' },
    { key: 'ESKISTA_REVIEW', label: 'Eskista Review' },
    { key: 'PUBLISHED', label: 'Published' },
    { key: 'AVAILABLE_FOR_BOOKING', label: 'Available for Booking' },
  ];
  const reached =
    status === 'DRAFT'
      ? 0
      : status === 'PENDING_REVIEW' || status === 'REJECTED'
        ? 1
        : status === 'PUBLISHED'
          ? hasUnits
            ? 4
            : 3
          : 1;
  return steps.map((s, i) => ({
    key: s.key as VendorStepKey,
    label: s.label,
    state: i < reached ? 'DONE' : i === reached ? 'IN_PROGRESS' : 'PENDING',
  }));
}
