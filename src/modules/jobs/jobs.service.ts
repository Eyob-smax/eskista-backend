import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ESKISTA_QUEUE,
  JOB_NAMES,
  type JobName,
  type JobPayloads,
  jobIdFor,
} from './jobs.constants';

/**
 * Scheduling for work that has to happen later.
 *
 * The designs require **time-triggered** notifications, not just event-triggered ones: a
 * return reminder the day before the deadline, and a feedback request after completion.
 *
 * BullMQ on the existing Redis rather than in-process cron. `@nestjs/schedule` fires on
 * every replica, so two API instances send two reminders, and anything pending is lost on
 * restart. A reminder that silently stops firing is worse than one that never existed.
 *
 * Jobs are scheduled **per booking** rather than swept by a nightly cron, so the delay is
 * exact. The sweep exists as a safety net, not as the mechanism.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(@InjectQueue(ESKISTA_QUEUE) private readonly queue: Queue) {}

  /**
   * Enqueues a job to run at a specific moment.
   *
   * A time already past runs immediately rather than being dropped — for a booking
   * confirmed less than a day before its return deadline, "remind them now" is right and
   * "never remind them" is not.
   *
   * Failures are logged, never thrown: a booking must not fail to confirm because Redis
   * hiccuped while scheduling a reminder about it.
   */
  async scheduleAt<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    runAt: Date,
    jobId?: string,
  ): Promise<void> {
    const delay = Math.max(runAt.getTime() - Date.now(), 0);

    try {
      await this.queue.add(name, payload, {
        delay,
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 86_400, count: 1000 },
        // Keep failures around long enough to be noticed and diagnosed.
        removeOnFail: { age: 7 * 86_400 },
      });
    } catch (error) {
      this.logger.error(`Could not schedule ${name} for ${runAt.toISOString()}: ${String(error)}`);
    }
  }

  /** Schedules the return reminder, replacing any pending one for the same booking. */
  async scheduleReturnReminder(bookingId: string, dueAt: Date): Promise<void> {
    const runAt = new Date(dueAt.getTime() - 24 * 60 * 60 * 1000);
    const jobId = jobIdFor(JOB_NAMES.returnReminder, bookingId);

    // Replace rather than add: re-confirming a booking must not double the reminders.
    await this.cancel(jobId);
    await this.scheduleAt(JOB_NAMES.returnReminder, { bookingId }, runAt, jobId);
  }

  async scheduleFeedbackRequest(bookingId: string, runAt: Date): Promise<void> {
    const jobId = jobIdFor(JOB_NAMES.feedbackRequest, bookingId);
    await this.cancel(jobId);
    await this.scheduleAt(JOB_NAMES.feedbackRequest, { bookingId }, runAt, jobId);
  }

  /** Removes a pending job. Called when a booking is cancelled or ends early. */
  async cancel(jobId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);
      // Only a job that has not started can be withdrawn; removing a running one would
      // race the worker.
      if (job && !(await job.isActive())) {
        await job.remove();
      }
    } catch (error) {
      this.logger.warn(`Could not cancel job ${jobId}: ${String(error)}`);
    }
  }

  async cancelBookingJobs(bookingId: string): Promise<void> {
    await Promise.all([
      this.cancel(jobIdFor(JOB_NAMES.returnReminder, bookingId)),
      this.cancel(jobIdFor(JOB_NAMES.feedbackRequest, bookingId)),
    ]);
  }

  /**
   * Installs the nightly reconciliation sweep, at 02:00.
   *
   * A job scheduler keyed by name, so every replica upserts the same schedule and
   * restarting the API re-registers it rather than accumulating duplicates. (BullMQ 6
   * replaced the old `repeat` option on `add` with this.)
   */
  async installSweep(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        JOB_NAMES.reminderSweep,
        { pattern: '0 2 * * *' },
        {
          name: JOB_NAMES.reminderSweep,
          data: {},
          opts: { removeOnComplete: { count: 30 }, removeOnFail: { age: 7 * 86_400 } },
        },
      );
    } catch (error) {
      // A missing sweep degrades the safety net, not the product. The per-booking delayed
      // jobs are the mechanism; this only catches ones they lost.
      this.logger.error(`Could not install the reminder sweep: ${String(error)}`);
    }
  }

  /** Queue depth, for the health endpoint. */
  async health(): Promise<{ waiting: number; delayed: number; failed: number }> {
    const [waiting, delayed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getDelayedCount(),
      this.queue.getFailedCount(),
    ]);
    return { waiting, delayed, failed };
  }
}
