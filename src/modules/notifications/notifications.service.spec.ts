import { NotFoundException } from '@nestjs/common';
import { NOTIFICATION_TEMPLATES, NotificationsService } from './notifications.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    notification: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    ...overrides,
  } as never;
}

/** The single argument Prisma was called with, typed loosely for assertions. */
const argOf = (fn: unknown): Record<string, unknown> =>
  (fn as { mock: { calls: [Record<string, unknown>][] } }).mock.calls[0][0];

describe('NotificationsService.send', () => {
  it('fills placeholders from the values passed in', async () => {
    const prisma = makePrisma();
    const service = new NotificationsService(prisma);

    await service.send('user-1', 'PAYMENT_VERIFIED', { reference: 'ESK-10482' });

    const body = argOf(
      (prisma as unknown as { notification: { create: unknown } }).notification.create,
    ).data as Record<string, unknown>;
    expect(body.body).toBe('Your payment for ESK-10482 has been confirmed.');
    expect(body.title).toBe('Payment Verified');
    expect(body.type).toBe('PAYMENT_VERIFIED');
  });

  it('drops an unfilled placeholder rather than printing it raw', async () => {
    // A customer should never be shown "{{reason}}".
    const prisma = makePrisma();
    const service = new NotificationsService(prisma);

    await service.send('user-1', 'PAYMENT_REJECTED', { reference: 'ESK-10482' });

    const body = argOf(
      (prisma as unknown as { notification: { create: unknown } }).notification.create,
    ).data as Record<string, string>;
    expect(body.body).not.toContain('{{');
    expect(body.body).toBe('We could not verify your payment for ESK-10482.');
  });

  it('records the in-app channel, which is what the bell reads', async () => {
    const prisma = makePrisma();
    const service = new NotificationsService(prisma);

    await service.send('user-1', 'RETURN_REMINDER');

    const body = argOf(
      (prisma as unknown as { notification: { create: unknown } }).notification.create,
    ).data as Record<string, unknown>;
    expect(body.channels).toEqual(['IN_APP']);
  });

  it('never throws when the write fails', async () => {
    // A booking must not fail to confirm because a notification could not be written.
    const prisma = makePrisma({
      notification: { create: vi.fn().mockRejectedValue(new Error('db down')) },
    });
    const service = new NotificationsService(prisma);

    await expect(service.send('user-1', 'RETURN_REMINDER')).resolves.toBeUndefined();
  });

  it('every template renders without leaving a placeholder when fully supplied', () => {
    for (const [name, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
      const tokens = [...template.body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
      const values = Object.fromEntries(tokens.map((t) => [t, 'x']));
      const rendered = template.body.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_m, k: string) => values[k] ?? '',
      );
      expect(rendered, `${name} left a placeholder`).not.toContain('{{');
      expect(template.title.length, `${name} has no title`).toBeGreaterThan(0);
    }
  });
});

describe('NotificationsService.markRead', () => {
  it('404s for a notification belonging to someone else', async () => {
    const prisma = makePrisma();
    const service = new NotificationsService(prisma);

    await expect(service.markRead('user-1', 'other-id')).rejects.toThrow(NotFoundException);
  });

  it('is idempotent — marking an already-read one does not write again', async () => {
    const readAt = new Date('2026-08-20T10:00:00Z');
    const existing = {
      id: 'n1',
      type: 'RETURN_REMINDER',
      title: 'Return Reminder',
      body: 'x',
      data: null,
      readAt,
      createdAt: readAt,
    };
    const update = vi.fn();
    const prisma = makePrisma({
      notification: { findFirst: vi.fn().mockResolvedValue(existing), update },
    });
    const service = new NotificationsService(prisma);

    const result = await service.markRead('user-1', 'n1');

    expect(update).not.toHaveBeenCalled();
    expect(result.isRead).toBe(true);
  });
});
