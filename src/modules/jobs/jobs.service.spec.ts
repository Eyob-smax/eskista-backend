import { Queue } from 'bullmq';
import { JOB_NAMES, jobIdFor } from './jobs.constants';
import { JobsService } from './jobs.service';

function makeQueue(overrides: Partial<Record<keyof Queue, unknown>> = {}) {
  return {
    add: vi.fn().mockResolvedValue({}),
    getJob: vi.fn().mockResolvedValue(null),
    upsertJobScheduler: vi.fn().mockResolvedValue({}),
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getDelayedCount: vi.fn().mockResolvedValue(0),
    getFailedCount: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as Queue;
}

const addOpts = (queue: Queue): Record<string, unknown> =>
  (queue.add as unknown as { mock: { calls: [string, unknown, Record<string, unknown>][] } }).mock
    .calls[0][2];

describe('jobIdFor', () => {
  it('is stable for a booking and job type, so BullMQ de-duplicates', () => {
    // Without a stable id, confirming a booking twice queues two reminders.
    expect(jobIdFor(JOB_NAMES.returnReminder, 'b1')).toBe(jobIdFor(JOB_NAMES.returnReminder, 'b1'));
  });

  it('differs across bookings and across job types', () => {
    expect(jobIdFor(JOB_NAMES.returnReminder, 'b1')).not.toBe(
      jobIdFor(JOB_NAMES.returnReminder, 'b2'),
    );
    expect(jobIdFor(JOB_NAMES.returnReminder, 'b1')).not.toBe(
      jobIdFor(JOB_NAMES.feedbackRequest, 'b1'),
    );
  });
});

describe('JobsService.scheduleAt', () => {
  it('converts a future time into a delay', async () => {
    const queue = makeQueue();
    const service = new JobsService(queue);
    const runAt = new Date(Date.now() + 60_000);

    await service.scheduleAt(JOB_NAMES.returnReminder, { bookingId: 'b1' }, runAt);

    const delay = addOpts(queue).delay as number;
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it('runs a job whose time has already passed rather than dropping it', async () => {
    // A booking confirmed less than a day before its deadline should still be reminded.
    const queue = makeQueue();
    const service = new JobsService(queue);

    await service.scheduleAt(
      JOB_NAMES.returnReminder,
      { bookingId: 'b1' },
      new Date(Date.now() - 86_400_000),
    );

    expect(addOpts(queue).delay).toBe(0);
  });

  it('retries with backoff, so a transient failure is not final', async () => {
    const queue = makeQueue();
    const service = new JobsService(queue);

    await service.scheduleAt(JOB_NAMES.returnReminder, { bookingId: 'b1' }, new Date());

    const opts = addOpts(queue);
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 30_000 });
  });

  it('keeps failures long enough to be noticed', async () => {
    const queue = makeQueue();
    const service = new JobsService(queue);

    await service.scheduleAt(JOB_NAMES.returnReminder, { bookingId: 'b1' }, new Date());

    expect(addOpts(queue).removeOnFail).toEqual({ age: 7 * 86_400 });
  });

  it('swallows a queue failure rather than failing the caller', async () => {
    // A booking must not fail to confirm because Redis hiccuped scheduling a reminder.
    const queue = makeQueue({ add: vi.fn().mockRejectedValue(new Error('redis down')) });
    const service = new JobsService(queue);

    await expect(
      service.scheduleAt(JOB_NAMES.returnReminder, { bookingId: 'b1' }, new Date()),
    ).resolves.toBeUndefined();
  });
});

describe('JobsService.scheduleReturnReminder', () => {
  it('fires 24 hours before the return deadline', async () => {
    const queue = makeQueue();
    const service = new JobsService(queue);
    const dueAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await service.scheduleReturnReminder('b1', dueAt);

    const delay = addOpts(queue).delay as number;
    const expected = 48 * 60 * 60 * 1000;
    expect(Math.abs(delay - expected)).toBeLessThan(5_000);
  });

  it('cancels any pending reminder first, so re-confirming does not double up', async () => {
    const remove = vi.fn();
    const queue = makeQueue({
      getJob: vi.fn().mockResolvedValue({ isActive: vi.fn().mockResolvedValue(false), remove }),
    });
    const service = new JobsService(queue);

    await service.scheduleReturnReminder('b1', new Date(Date.now() + 86_400_000));

    expect(remove).toHaveBeenCalledOnce();
    expect(addOpts(queue).jobId).toBe(jobIdFor(JOB_NAMES.returnReminder, 'b1'));
  });
});

describe('JobsService.cancel', () => {
  it('removes a pending job', async () => {
    const remove = vi.fn();
    const queue = makeQueue({
      getJob: vi.fn().mockResolvedValue({ isActive: vi.fn().mockResolvedValue(false), remove }),
    });

    await new JobsService(queue).cancel('job-1');

    expect(remove).toHaveBeenCalledOnce();
  });

  it('leaves a running job alone rather than racing the worker', async () => {
    const remove = vi.fn();
    const queue = makeQueue({
      getJob: vi.fn().mockResolvedValue({ isActive: vi.fn().mockResolvedValue(true), remove }),
    });

    await new JobsService(queue).cancel('job-1');

    expect(remove).not.toHaveBeenCalled();
  });

  it('is a no-op for a job that does not exist', async () => {
    const queue = makeQueue();
    await expect(new JobsService(queue).cancel('missing')).resolves.toBeUndefined();
  });

  it('cancels both scheduled jobs for a booking', async () => {
    const remove = vi.fn();
    const queue = makeQueue({
      getJob: vi.fn().mockResolvedValue({ isActive: vi.fn().mockResolvedValue(false), remove }),
    });

    await new JobsService(queue).cancelBookingJobs('b1');

    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe('JobsService.installSweep', () => {
  it('upserts a scheduler, so restarts do not accumulate duplicates', async () => {
    const queue = makeQueue();
    const service = new JobsService(queue);

    await service.installSweep();

    const call = (
      queue.upsertJobScheduler as unknown as { mock: { calls: [string, { pattern: string }][] } }
    ).mock.calls[0];
    expect(call[0]).toBe(JOB_NAMES.reminderSweep);
    expect(call[1].pattern).toBe('0 2 * * *');
  });

  it('does not throw when Redis is unavailable', async () => {
    const queue = makeQueue({
      upsertJobScheduler: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    await expect(new JobsService(queue).installSweep()).resolves.toBeUndefined();
  });
});

describe('JobsService.health', () => {
  it('reports the three queue depths', async () => {
    const queue = makeQueue({
      getWaitingCount: vi.fn().mockResolvedValue(2),
      getDelayedCount: vi.fn().mockResolvedValue(5),
      getFailedCount: vi.fn().mockResolvedValue(1),
    });

    expect(await new JobsService(queue).health()).toEqual({ waiting: 2, delayed: 5, failed: 1 });
  });
});
