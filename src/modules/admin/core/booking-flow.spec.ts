import { AgreementStatus, BookingStatus, BookingType } from '@prisma/client';
import {
  ADMIN_EQUIPMENT_STEPS,
  buildAdminActions,
  buildAdminTimeline,
  confirmationBlockers,
  defaultDueAt,
  type AdminActionContext,
  type AdminFlowState,
} from './booking-flow';

const equipment = (over: Partial<AdminFlowState> = {}): AdminFlowState => ({
  type: BookingType.EQUIPMENT,
  status: BookingStatus.REQUEST_SUBMITTED,
  preparedAt: null,
  handedOverAt: null,
  receivedAtHubAt: null,
  hasOutgoingInspection: false,
  hasReturnInspection: false,
  settlementPaid: false,
  talentAssigned: false,
  contractsApproved: false,
  ...over,
});

const context = (over: Partial<AdminActionContext> = {}): AdminActionContext => ({
  ...equipment(),
  supplierAccepted: false,
  supplierDeclined: false,
  agreementUnderReview: false,
  paymentPending: false,
  unitAssigned: false,
  outboundStage: null,
  depositRefundDue: false,
  outgoingDamaged: false,
  settlementExists: false,
  returnedToVendor: false,
  ...over,
});

const current = (s: AdminFlowState) =>
  buildAdminTimeline(s).find((t) => t.state === 'IN_PROGRESS')?.key;
const keys = (c: AdminActionContext) => buildAdminActions(c).map((a) => a.key);

describe('confirmationBlockers', () => {
  const approved = [{ status: AgreementStatus.APPROVED }];

  it('confirms once paid in full and the agreement is approved', () => {
    expect(
      confirmationBlockers({ paidMinor: 1000, dueMinor: 1000, customerAgreements: approved }),
    ).toEqual([]);
  });

  it('waits for the rest of a partial payment', () => {
    expect(
      confirmationBlockers({ paidMinor: 400, dueMinor: 1000, customerAgreements: approved }),
    ).toEqual(['The booking is only partly paid']);
  });

  it('waits for the signed scan to be approved, even when paid', () => {
    expect(
      confirmationBlockers({
        paidMinor: 1000,
        dueMinor: 1000,
        customerAgreements: [{ status: AgreementStatus.UNDER_REVIEW }],
      }),
    ).toEqual(["The customer's signed agreement has not been approved yet"]);
  });

  it('ignores voided agreements', () => {
    expect(
      confirmationBlockers({
        paidMinor: 1000,
        dueMinor: 1000,
        customerAgreements: [{ status: AgreementStatus.VOID }, ...approved],
      }),
    ).toEqual([]);
  });
});

describe('the thirteen-step equipment timeline', () => {
  it('has the design’s steps, with Eskista approval between request and payment', () => {
    expect(ADMIN_EQUIPMENT_STEPS.map((s) => s.label)).toEqual([
      'Request Submitted',
      'Eskista Approval',
      'Payment',
      'Booking Confirmed',
      'Equipment Preparation',
      'Outgoing Inspection',
      'Handover',
      'Rental Active',
      'Return Scheduled',
      'Incoming Inspection',
      'Completed',
      'Settlement',
      'Closed',
    ]);
  });

  it('follows the gear through the hub', () => {
    expect(current(equipment({ status: BookingStatus.BOOKING_CONFIRMED }))).toBe(
      'EQUIPMENT_PREPARATION',
    );
    expect(
      current(equipment({ status: BookingStatus.BOOKING_CONFIRMED, receivedAtHubAt: new Date() })),
    ).toBe('OUTGOING_INSPECTION');
    expect(
      current(
        equipment({
          status: BookingStatus.BOOKING_CONFIRMED,
          receivedAtHubAt: new Date(),
          hasOutgoingInspection: true,
        }),
      ),
    ).toBe('HANDOVER');
    expect(current(equipment({ status: BookingStatus.IN_PROGRESS }))).toBe('RENTAL_ACTIVE');
    expect(current(equipment({ status: BookingStatus.RETURN_RECEIVED }))).toBe(
      'INCOMING_INSPECTION',
    );
    expect(
      current(equipment({ status: BookingStatus.INSPECTION, hasReturnInspection: true })),
    ).toBe('COMPLETED');
    expect(current(equipment({ status: BookingStatus.SETTLEMENT }))).toBe('SETTLEMENT');
  });

  it('marks everything done once closed', () => {
    expect(
      buildAdminTimeline(equipment({ status: BookingStatus.CLOSED })).every(
        (s) => s.state === 'DONE',
      ),
    ).toBe(true);
  });

  it('shows nothing in progress for a cancelled booking', () => {
    expect(current(equipment({ status: BookingStatus.CANCELLED }))).toBeUndefined();
  });
});

describe('the six-step talent timeline', () => {
  const talent = (over: Partial<AdminFlowState>) =>
    equipment({ type: BookingType.TALENT, ...over });

  it('runs Pending Review → Talent Assigned → Contract Active → In Progress → Completed', () => {
    expect(current(talent({ status: BookingStatus.ESKISTA_REVIEW }))).toBe('PENDING_REVIEW');
    expect(current(talent({ status: BookingStatus.AWAITING_PAYMENT, talentAssigned: true }))).toBe(
      'CONTRACT_ACTIVE',
    );
    expect(
      current(talent({ status: BookingStatus.BOOKING_CONFIRMED, contractsApproved: true })),
    ).toBe('IN_PROGRESS');
    expect(current(talent({ status: BookingStatus.RENTAL_COMPLETED }))).toBe('COMPLETED');
  });
});

describe('admin actions', () => {
  it('waits for the vendor before Approve is enabled', () => {
    const approve = buildAdminActions(context({ status: BookingStatus.ESKISTA_REVIEW })).find(
      (a) => a.key === 'APPROVE',
    );
    expect(approve?.enabled).toBe(false);
    expect(approve?.disabledReason).toBe('Waiting for the vendor to accept.');
  });

  it('leads with the agreement review while payment is pending', () => {
    const actions = buildAdminActions(
      context({
        status: BookingStatus.AWAITING_PAYMENT,
        agreementUnderReview: true,
        paymentPending: true,
      }),
    );
    expect(actions[0].key).toBe('REVIEW_AGREEMENT');
    expect(actions.map((a) => a.key)).toContain('VERIFY_PAYMENT');
  });

  it('receives, inspects, then packs the gear', () => {
    const base = { status: BookingStatus.BOOKING_CONFIRMED, unitAssigned: true };
    expect(keys(context(base))).toContain('RECEIVE_AT_HUB');
    expect(keys(context({ ...base, receivedAtHubAt: new Date() }))).toContain(
      'OUTGOING_INSPECTION',
    );
    expect(
      keys(context({ ...base, receivedAtHubAt: new Date(), hasOutgoingInspection: true })),
    ).toContain('DISPATCH');
  });

  it('only closes once the supplier is paid', () => {
    const close = (paid: boolean) =>
      buildAdminActions(
        context({ status: BookingStatus.SETTLEMENT, settlementPaid: paid, settlementExists: true }),
      ).find((a) => a.key === 'CLOSE');
    expect(close(false)?.enabled).toBe(false);
    expect(close(true)?.enabled).toBe(true);
  });
});

describe('defaultDueAt', () => {
  it('is 5:00 PM Addis Ababa on the last day', () => {
    expect(defaultDueAt(new Date('2026-10-03T00:00:00Z')).toISOString()).toBe(
      '2026-10-03T14:00:00.000Z',
    );
  });
});
