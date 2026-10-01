import { AgreementStatus, BookingStatus, BookingType } from '@prisma/client';

/**
 * Pure rules behind Eskista's own moves on a booking. The services around them do the
 * writing; these decide, so each rule is testable without a database.
 */

/** What still stands between an approved booking and Booking Confirmed. */
export function confirmationBlockers(input: {
  paidMinor: number;
  dueMinor: number;
  /** The customer's own agreements on the booking. */
  customerAgreements: { status: AgreementStatus }[];
}): string[] {
  const blockers: string[] = [];
  if (input.paidMinor < input.dueMinor) {
    blockers.push(
      input.paidMinor === 0
        ? 'No payment has been verified yet'
        : 'The booking is only partly paid',
    );
  }
  const live = input.customerAgreements.filter(
    (a) => a.status !== AgreementStatus.VOID && a.status !== AgreementStatus.DRAFT,
  );
  if (live.some((a) => a.status !== AgreementStatus.APPROVED)) {
    blockers.push("The customer's signed agreement has not been approved yet");
  }
  return blockers;
}

/**
 * The thirteen steps of the admin Booking Detail for an equipment rental:
 * Request Submitted · Payment · Booking Confirmed · Equipment Preparation · Outgoing
 * Inspection · Handover · Rental Active · Return Scheduled · Incoming Inspection ·
 * Completed · Settlement · Closed — with Eskista's approval between request and payment.
 */
export const ADMIN_EQUIPMENT_STEPS = [
  { key: 'REQUEST_SUBMITTED', label: 'Request Submitted' },
  { key: 'ESKISTA_APPROVAL', label: 'Eskista Approval' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'BOOKING_CONFIRMED', label: 'Booking Confirmed' },
  { key: 'EQUIPMENT_PREPARATION', label: 'Equipment Preparation' },
  { key: 'OUTGOING_INSPECTION', label: 'Outgoing Inspection' },
  { key: 'HANDOVER', label: 'Handover' },
  { key: 'RENTAL_ACTIVE', label: 'Rental Active' },
  { key: 'RETURN_SCHEDULED', label: 'Return Scheduled' },
  { key: 'INCOMING_INSPECTION', label: 'Incoming Inspection' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'SETTLEMENT', label: 'Settlement' },
  { key: 'CLOSED', label: 'Closed' },
] as const;

/** The six steps of the admin Talent Booking Detail. */
export const ADMIN_TALENT_STEPS = [
  { key: 'PENDING_REVIEW', label: 'Pending Review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'TALENT_ASSIGNED', label: 'Talent Assigned' },
  { key: 'CONTRACT_ACTIVE', label: 'Contract Active' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'COMPLETED', label: 'Completed' },
] as const;

export interface AdminFlowState {
  type: BookingType;
  status: BookingStatus;
  /** Vendor's own steps. */
  preparedAt: Date | null;
  handedOverAt: Date | null;
  receivedAtHubAt: Date | null;
  hasOutgoingInspection: boolean;
  hasReturnInspection: boolean;
  settlementPaid: boolean;
  /** Talent: a talent is on the booking (hired). */
  talentAssigned: boolean;
  /** Talent: both the customer's and the talent's agreements approved. */
  contractsApproved: boolean;
}

const ENDED: BookingStatus[] = [
  BookingStatus.REJECTED,
  BookingStatus.CANCELLED,
  BookingStatus.EXPIRED,
];

/** Index of the step happening now; the step count once closed. */
export function adminCurrentStep(s: AdminFlowState): number {
  if (s.type === BookingType.TALENT) return talentStep(s);
  switch (s.status) {
    case BookingStatus.DRAFT:
    case BookingStatus.REQUEST_SUBMITTED:
      return 0;
    case BookingStatus.ESKISTA_REVIEW:
      return 1;
    case BookingStatus.AWAITING_PAYMENT:
      return 2;
    case BookingStatus.BOOKING_CONFIRMED:
      // Confirmed is done the moment it is reached; then the gear is prepared, received at
      // the hub, and checked before it leaves.
      if (s.hasOutgoingInspection) return 6;
      if (s.receivedAtHubAt || s.handedOverAt) return 5;
      return 4;
    case BookingStatus.DELIVERY_PICKUP:
      return s.hasOutgoingInspection ? 6 : 5;
    case BookingStatus.IN_PROGRESS:
    case BookingStatus.RENTAL_COMPLETED:
      return 7;
    case BookingStatus.RETURN_SCHEDULED:
      return 8;
    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
      return s.hasReturnInspection ? 10 : 9;
    case BookingStatus.SETTLEMENT:
      return 11;
    case BookingStatus.CLOSED:
      return ADMIN_EQUIPMENT_STEPS.length;
    default:
      return 0;
  }
}

function talentStep(s: AdminFlowState): number {
  switch (s.status) {
    case BookingStatus.DRAFT:
    case BookingStatus.REQUEST_SUBMITTED:
    case BookingStatus.ESKISTA_REVIEW:
      return 0;
    case BookingStatus.AWAITING_PAYMENT:
      // Hired: approved and assigned; the contract is next.
      return s.talentAssigned ? 3 : 1;
    case BookingStatus.BOOKING_CONFIRMED:
      // Contract Active until Start Engagement is pressed — approved contracts only make
      // starting possible.
      return 3;
    case BookingStatus.DELIVERY_PICKUP:
    case BookingStatus.IN_PROGRESS:
      return 4;
    case BookingStatus.RENTAL_COMPLETED:
    case BookingStatus.RETURN_SCHEDULED:
    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
    case BookingStatus.SETTLEMENT:
      return 5;
    case BookingStatus.CLOSED:
      return ADMIN_TALENT_STEPS.length;
    default:
      return 0;
  }
}

export interface AdminStep {
  key: string;
  label: string;
  state: 'DONE' | 'IN_PROGRESS' | 'PENDING';
}

export function buildAdminTimeline(s: AdminFlowState): AdminStep[] {
  const steps = s.type === BookingType.TALENT ? ADMIN_TALENT_STEPS : ADMIN_EQUIPMENT_STEPS;
  const reached = adminCurrentStep(s);
  const ended = ENDED.includes(s.status);
  return steps.map((step, index) => ({
    key: step.key,
    label: step.label,
    state: index < reached ? 'DONE' : index === reached && !ended ? 'IN_PROGRESS' : 'PENDING',
  }));
}

export type AdminActionKey =
  | 'APPROVE'
  | 'REJECT'
  | 'ASSIGN_UNIT'
  | 'REVIEW_AGREEMENT'
  | 'VERIFY_PAYMENT'
  | 'RECEIVE_AT_HUB'
  | 'OUTGOING_INSPECTION'
  | 'DISPATCH'
  | 'ADVANCE_DELIVERY'
  | 'MARK_RETURN_RECEIVED'
  | 'RETURN_INSPECTION'
  | 'REFUND_DEPOSIT'
  | 'SETTLE'
  | 'MARK_PAYOUT_PAID'
  | 'RETURN_TO_VENDOR'
  | 'CLOSE'
  | 'START_ENGAGEMENT'
  | 'COMPLETE_ENGAGEMENT'
  | 'CANCEL';

export interface AdminAction {
  key: AdminActionKey;
  label: string;
  primary: boolean;
  enabled: boolean;
  disabledReason: string | null;
}

export interface AdminActionContext extends AdminFlowState {
  supplierAccepted: boolean;
  supplierDeclined: boolean;
  agreementUnderReview: boolean;
  paymentPending: boolean;
  unitAssigned: boolean;
  outboundStage: 'PREPARED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | null;
  depositRefundDue: boolean;
  /** The outgoing check graded the gear Damaged, so it cannot go out. */
  outgoingDamaged: boolean;
  settlementExists: boolean;
  returnedToVendor: boolean;
}

/**
 * The buttons on the admin Booking Detail, in the design's order. Rendering only — each
 * endpoint re-checks its own preconditions.
 */
export function buildAdminActions(c: AdminActionContext): AdminAction[] {
  const out: AdminAction[] = [];
  const add = (
    key: AdminActionKey,
    label: string,
    primary = false,
    enabled = true,
    disabledReason: string | null = null,
  ) => out.push({ key, label, primary, enabled, disabledReason });

  const talent = c.type === BookingType.TALENT;

  switch (c.status) {
    case BookingStatus.REQUEST_SUBMITTED:
    case BookingStatus.ESKISTA_REVIEW:
      if (!talent) {
        add(
          'APPROVE',
          'Approve Booking',
          true,
          c.supplierAccepted,
          c.supplierAccepted
            ? null
            : c.supplierDeclined
              ? 'The vendor declined this request.'
              : 'Waiting for the vendor to accept.',
        );
        add('ASSIGN_UNIT', c.unitAssigned ? 'Change Unit' : 'Assign Unit');
        add('REJECT', 'Reject Request');
      } else {
        add('REJECT', 'Close Request');
      }
      break;

    case BookingStatus.AWAITING_PAYMENT:
      if (c.agreementUnderReview) add('REVIEW_AGREEMENT', 'Review Signed Agreement', true);
      if (c.paymentPending) add('VERIFY_PAYMENT', 'Verify Payment', !c.agreementUnderReview);
      if (!talent) add('ASSIGN_UNIT', c.unitAssigned ? 'Change Unit' : 'Assign Unit');
      add('CANCEL', 'Cancel Booking');
      break;

    case BookingStatus.BOOKING_CONFIRMED:
      if (talent) {
        add(
          'START_ENGAGEMENT',
          'Start Engagement',
          true,
          c.contractsApproved,
          c.contractsApproved ? null : 'Both agreements must be approved first.',
        );
        if (c.agreementUnderReview) add('REVIEW_AGREEMENT', 'Review Signed Agreement');
        add('CANCEL', 'Cancel Booking');
        break;
      }
      if (!c.unitAssigned) add('ASSIGN_UNIT', 'Assign Unit', true);
      if (!c.receivedAtHubAt) {
        add(
          'RECEIVE_AT_HUB',
          c.handedOverAt ? 'Receive at Hub' : 'Receive at Hub (vendor has not confirmed handover)',
          c.unitAssigned,
          c.unitAssigned,
          c.unitAssigned ? null : 'Assign a unit first.',
        );
      } else if (!c.hasOutgoingInspection) {
        add('OUTGOING_INSPECTION', 'Update Outgoing Inspection', true);
      } else {
        add(
          'DISPATCH',
          'Start Packing Gear',
          true,
          !c.outgoingDamaged,
          c.outgoingDamaged
            ? 'The outgoing inspection found damage; update it once the gear is fixed.'
            : null,
        );
      }
      add('CANCEL', 'Cancel Booking');
      break;

    case BookingStatus.DELIVERY_PICKUP:
      if (talent) {
        add('COMPLETE_ENGAGEMENT', 'Mark Completed', true);
        break;
      }
      add('ADVANCE_DELIVERY', deliveryLabel(c.outboundStage), true);
      break;

    case BookingStatus.IN_PROGRESS:
    case BookingStatus.RENTAL_COMPLETED:
    case BookingStatus.RETURN_SCHEDULED:
      if (talent) {
        // Talent have no return leg: it is under way, or complete and ready to settle.
        if (c.status === BookingStatus.IN_PROGRESS) {
          add('COMPLETE_ENGAGEMENT', 'Mark Completed', true);
        } else if (c.status === BookingStatus.RENTAL_COMPLETED) {
          add('SETTLE', 'Move to Settlement', true);
        }
        break;
      }
      add('MARK_RETURN_RECEIVED', 'Mark Returned to Hub', true);
      break;

    case BookingStatus.RETURN_RECEIVED:
    case BookingStatus.INSPECTION:
      if (!c.hasReturnInspection) {
        add('RETURN_INSPECTION', 'Post-Shoot Return Inspection', true);
      } else {
        if (c.depositRefundDue) add('REFUND_DEPOSIT', 'Record Deposit Refund');
        add('SETTLE', 'Move to Settlement', !c.depositRefundDue);
      }
      break;

    case BookingStatus.SETTLEMENT:
      if (!c.settlementPaid) {
        add('MARK_PAYOUT_PAID', talent ? 'Pay Talent' : 'Pay Vendor', true, c.settlementExists);
      }
      if (!talent && !c.returnedToVendor) add('RETURN_TO_VENDOR', 'Return Gear to Vendor');
      if (!talent && c.depositRefundDue) add('REFUND_DEPOSIT', 'Record Deposit Refund');
      add(
        'CLOSE',
        'Close Booking',
        c.settlementPaid,
        c.settlementPaid,
        c.settlementPaid ? null : 'Pay the supplier first.',
      );
      break;

    default:
      break;
  }
  return out;
}

function deliveryLabel(stage: AdminActionContext['outboundStage']): string {
  switch (stage) {
    case 'PREPARED':
      return 'Mark Picked Up';
    case 'PICKED_UP':
      return 'Mark Out for Delivery';
    case 'OUT_FOR_DELIVERY':
      return 'Handover Complete';
    default:
      return 'Update Delivery';
  }
}

/** The 5:00 PM return deadline on the last rental day, in Addis Ababa (UTC+3). */
export function defaultDueAt(endDate: Date): Date {
  const day = endDate.toISOString().slice(0, 10);
  return new Date(`${day}T14:00:00.000Z`);
}
