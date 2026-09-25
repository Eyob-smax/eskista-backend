/**
 * The one queue, and the jobs that run on it.
 *
 * Typed payloads rather than `Record<string, unknown>`: a scheduled job is written today
 * and read weeks later by a different process, so a mismatch between what was enqueued and
 * what the handler expects surfaces at runtime, in production, long after the mistake.
 */
export const ESKISTA_QUEUE = 'eskista';

export const JOB_NAMES = {
  /** "Your rental ends tomorrow. Arrange your return in the app." */
  returnReminder: 'notification.return-reminder',
  /** "We'd love to hear your thoughts." Sent after a booking closes. */
  feedbackRequest: 'notification.feedback-request',
  /** Safety net: catches reminders whose delayed job was lost. */
  reminderSweep: 'maintenance.reminder-sweep',
  /** An invited talent's 48 hours are up. */
  invitationExpiry: 'hiring.invitation-expiry',
  /** "Choose your talent — 24 hours left." */
  selectionReminder: 'hiring.selection-reminder',
  /** The customer's 72 hours to choose are up. */
  selectionDeadline: 'hiring.selection-deadline',
  /** "It will automatically close in 24 hours" — after the vendor confirms the payout. */
  bookingAutoClose: 'booking.auto-close',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export interface ReturnReminderPayload {
  bookingId: string;
}

export interface FeedbackRequestPayload {
  bookingId: string;
}

export type ReminderSweepPayload = Record<string, never>;

/** Every hiring job acts on one talent request and re-reads it. */
export interface HiringJobPayload {
  bookingId: string;
}

export interface JobPayloads {
  [JOB_NAMES.returnReminder]: ReturnReminderPayload;
  [JOB_NAMES.feedbackRequest]: FeedbackRequestPayload;
  [JOB_NAMES.reminderSweep]: ReminderSweepPayload;
  [JOB_NAMES.invitationExpiry]: HiringJobPayload;
  [JOB_NAMES.selectionReminder]: HiringJobPayload;
  [JOB_NAMES.selectionDeadline]: HiringJobPayload;
  [JOB_NAMES.bookingAutoClose]: HiringJobPayload;
}

/**
 * A handler another module contributes for one job name.
 *
 * The queue has one worker, so every job name is processed by `JobsProcessor`. Modules
 * that sit above the jobs module (hiring needs `JobsService` to schedule, and the
 * processor would need hiring to act) register their handlers at start-up instead of
 * being imported by it, which would be a cycle.
 */
export type JobHandler<N extends JobName = JobName> = (payload: JobPayloads[N]) => Promise<void>;

/**
 * A stable job id per booking and job type.
 *
 * BullMQ de-duplicates on job id, so re-confirming a booking replaces its pending reminder
 * instead of queueing a second one. Without this a customer who is confirmed twice gets
 * reminded twice.
 */
export function jobIdFor(name: JobName, bookingId: string): string {
  return `${name}:${bookingId}`;
}
