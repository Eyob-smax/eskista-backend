import { InvitationStatus, PricingModel } from '@prisma/client';
import { workingDays } from '../../common/money';

/**
 * The rules of the multi-talent hire, as pure functions.
 *
 * A customer invites up to five talents to one request. Each has 48 hours to accept or
 * decline; the customer then has 72 hours from the first acceptance to choose (or opts in to
 * hiring the first to accept). The chosen are HIRED, everyone else who was still in the
 * running is REJECTED, so each talent always learns the outcome.
 *
 * Kept free of the database so every branch can be tested without Postgres.
 */

/** Still waiting on the talent. */
export const OPEN_INVITATION: InvitationStatus[] = [InvitationStatus.INVITED];

/** Said yes, waiting on the customer. */
export const IN_THE_RUNNING: InvitationStatus[] = [
  InvitationStatus.INVITED,
  InvitationStatus.ACCEPTED,
];

/** The invitation is over, whatever happened. */
export const FINISHED_INVITATION: InvitationStatus[] = [
  InvitationStatus.DECLINED,
  InvitationStatus.EXPIRED,
  InvitationStatus.WITHDRAWN,
  InvitationStatus.HIRED,
  InvitationStatus.REJECTED,
  InvitationStatus.CANCELLED,
];

export interface InvitationLike {
  status: InvitationStatus;
  expiresAt: Date;
}

/** True when an INVITED invitation's answer window has closed, whether or not a job ran. */
export function isLapsed(inv: InvitationLike, now: Date): boolean {
  return inv.status === InvitationStatus.INVITED && inv.expiresAt.getTime() <= now.getTime();
}

/**
 * The status as it should be read right now.
 *
 * The expiry job is the mechanism, but a read must never show "Reply within 0 hours" because
 * Redis was slow; a lapsed invitation reads as EXPIRED the moment its time is up.
 */
export function effectiveStatus(inv: InvitationLike, now: Date): InvitationStatus {
  return isLapsed(inv, now) ? InvitationStatus.EXPIRED : inv.status;
}

export type RequestVerdict =
  /** Nothing to do. */
  | { kind: 'OPEN' }
  /** Nobody is left who could be hired. */
  | { kind: 'EXPIRE'; reason: string }
  /** The customer's time to choose ran out. */
  | { kind: 'SELECTION_LAPSED'; reason: string };

/**
 * Decides whether a request that has hired nobody yet can still go anywhere.
 *
 * Called after every change — an answer, an expiry, a withdrawal — so a request never sits
 * in "Talent Confirmation" with nobody left to confirm.
 */
export function judgeRequest(
  invitations: InvitationLike[],
  selectionDeadlineAt: Date | null,
  now: Date,
): RequestVerdict {
  const statuses = invitations.map((i) => effectiveStatus(i, now));
  if (statuses.includes(InvitationStatus.HIRED)) return { kind: 'OPEN' };

  const accepted = statuses.filter((s) => s === InvitationStatus.ACCEPTED).length;
  const waiting = statuses.filter((s) => s === InvitationStatus.INVITED).length;

  if (accepted > 0 && selectionDeadlineAt && selectionDeadlineAt.getTime() <= now.getTime()) {
    return {
      kind: 'SELECTION_LAPSED',
      reason: 'No talent was chosen in time.',
    };
  }
  if (accepted === 0 && waiting === 0) {
    return {
      kind: 'EXPIRE',
      reason: 'None of the invited talents are available.',
    };
  }
  return { kind: 'OPEN' };
}

/**
 * How many units a talent's rate is multiplied by.
 *
 * Per day: each booked date is a working day (inclusive — a one-day shoot is one day, not
 * zero nights). Per project: once. Per hour: the hours on each day, times the days.
 */
export function talentPeriods(
  model: PricingModel,
  startDate: Date,
  endDate: Date,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): number {
  const days = workingDays(startDate, endDate);
  if (model === PricingModel.PER_PROJECT) return 1;
  if (model === PricingModel.PER_HOUR) return Math.max(hoursPerDay(startTime, endTime), 1) * days;
  return days;
}

/** Whole hours between two HH:mm clock times; 0 if either is missing or reversed. */
export function hoursPerDay(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  if (!start || !end) return 0;
  const [sh = 0, sm = 0] = start.split(':').map(Number);
  const [eh = 0, em = 0] = end.split(':').map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return minutes > 0 ? Math.ceil(minutes / 60) : 0;
}

/** What each invitation status means, in the talent's words. */
export const TALENT_STATUS_LABELS: Record<InvitationStatus, string> = {
  INVITED: 'Request Received',
  ACCEPTED: 'Accepted — waiting for the client',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
  HIRED: 'Hired',
  REJECTED: 'Not selected',
  CANCELLED: 'Cancelled by client',
};

/** What each invitation status means, in the customer's words. */
export const CUSTOMER_STATUS_LABELS: Record<InvitationStatus, string> = {
  INVITED: 'Awaiting reply',
  ACCEPTED: 'Available',
  DECLINED: 'Not available',
  EXPIRED: 'No reply',
  WITHDRAWN: 'Withdrew',
  HIRED: 'Hired',
  REJECTED: 'Not selected',
  CANCELLED: 'Cancelled',
};

/** Whole hours left until `at`, never negative. Null when there is no deadline. */
export function hoursLeft(at: Date | null, now: Date): number | null {
  if (!at) return null;
  return Math.max(Math.ceil((at.getTime() - now.getTime()) / 3_600_000), 0);
}

/** "Sep 22" or "Sep 22 – Sep 24", for notification copy. */
export function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return start.getTime() === end.getTime() ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}
