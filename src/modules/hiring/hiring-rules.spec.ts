import { InvitationStatus, PricingModel } from '@prisma/client';
import {
  effectiveStatus,
  formatDateRange,
  hoursLeft,
  hoursPerDay,
  isLapsed,
  judgeRequest,
  talentPeriods,
} from './hiring-rules';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const LATER = new Date('2026-09-27T12:00:00.000Z');
const EARLIER = new Date('2026-09-24T12:00:00.000Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const inv = (status: InvitationStatus, expiresAt: Date = LATER) => ({ status, expiresAt });

describe('invitation clocks', () => {
  it('treats an unanswered invitation past its 48 hours as expired', () => {
    expect(isLapsed(inv(InvitationStatus.INVITED, EARLIER), NOW)).toBe(true);
    expect(effectiveStatus(inv(InvitationStatus.INVITED, EARLIER), NOW)).toBe(
      InvitationStatus.EXPIRED,
    );
  });

  it('never lapses an answer that was already given', () => {
    // The clock is only for replying; an acceptance does not expire with it.
    expect(isLapsed(inv(InvitationStatus.ACCEPTED, EARLIER), NOW)).toBe(false);
    expect(effectiveStatus(inv(InvitationStatus.ACCEPTED, EARLIER), NOW)).toBe(
      InvitationStatus.ACCEPTED,
    );
  });

  it('keeps a live invitation as it is', () => {
    expect(effectiveStatus(inv(InvitationStatus.INVITED), NOW)).toBe(InvitationStatus.INVITED);
  });
});

describe('judgeRequest', () => {
  it('stays open while anyone could still say yes', () => {
    expect(
      judgeRequest([inv(InvitationStatus.INVITED), inv(InvitationStatus.DECLINED)], null, NOW),
    ).toEqual({ kind: 'OPEN' });
  });

  it('stays open while someone accepted and the customer is still in time', () => {
    expect(judgeRequest([inv(InvitationStatus.ACCEPTED)], LATER, NOW)).toEqual({ kind: 'OPEN' });
  });

  it('expires when every talent declined or ran out of time', () => {
    const verdict = judgeRequest(
      [inv(InvitationStatus.DECLINED), inv(InvitationStatus.INVITED, EARLIER)],
      null,
      NOW,
    );
    expect(verdict.kind).toBe('EXPIRE');
  });

  it('expires when the customer did not choose within 72 hours', () => {
    const verdict = judgeRequest([inv(InvitationStatus.ACCEPTED)], EARLIER, NOW);
    expect(verdict.kind).toBe('SELECTION_LAPSED');
  });

  it('never closes a request that already hired someone', () => {
    expect(
      judgeRequest([inv(InvitationStatus.HIRED), inv(InvitationStatus.REJECTED)], EARLIER, NOW),
    ).toEqual({ kind: 'OPEN' });
  });

  it('expires after a withdrawal leaves nobody', () => {
    expect(judgeRequest([inv(InvitationStatus.WITHDRAWN)], LATER, NOW).kind).toBe('EXPIRE');
  });
});

describe('talentPeriods — what a talent rate is multiplied by', () => {
  it('counts each booked date as a working day, inclusive', () => {
    expect(
      talentPeriods(PricingModel.PER_DAY, day('2026-10-02'), day('2026-10-02'), null, null),
    ).toBe(1);
    expect(
      talentPeriods(PricingModel.PER_DAY, day('2026-10-02'), day('2026-10-04'), null, null),
    ).toBe(3);
  });

  it('charges a project rate once, however many days', () => {
    expect(
      talentPeriods(PricingModel.PER_PROJECT, day('2026-10-02'), day('2026-10-06'), null, null),
    ).toBe(1);
  });

  it('charges an hourly rate by the hours each day, times the days', () => {
    expect(
      talentPeriods(PricingModel.PER_HOUR, day('2026-10-02'), day('2026-10-03'), '08:00', '18:00'),
    ).toBe(20);
  });

  it('charges at least one hour a day when the times are missing', () => {
    expect(
      talentPeriods(PricingModel.PER_HOUR, day('2026-10-02'), day('2026-10-02'), null, null),
    ).toBe(1);
  });

  it('rounds part hours up', () => {
    expect(hoursPerDay('09:00', '12:30')).toBe(4);
    expect(hoursPerDay('18:00', '08:00')).toBe(0);
  });
});

describe('labels', () => {
  it('counts hours left, never negative', () => {
    expect(hoursLeft(LATER, NOW)).toBe(48);
    expect(hoursLeft(EARLIER, NOW)).toBe(0);
    expect(hoursLeft(null, NOW)).toBeNull();
  });

  it('prints one date, or a range', () => {
    expect(formatDateRange(day('2026-10-02'), day('2026-10-02'))).toBe('Oct 2');
    expect(formatDateRange(day('2026-10-02'), day('2026-10-04'))).toBe('Oct 2 – Oct 4');
  });
});
