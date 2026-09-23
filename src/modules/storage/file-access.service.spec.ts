import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FileAccessService, isPubliclyReadableKey } from './file-access.service';
import type { SessionUser } from '../auth/auth.types';

const user = (id: string, roles: Role[] = [Role.CUSTOMER]): SessionUser => ({
  id,
  name: 'Test User',
  email: `${id}@example.test`,
  image: null,
  activeRole: roles[0],
  isBlocked: false,
  telegramUserId: null,
  roles,
});

const CUSTOMER = user('user-customer');
const VENDOR_OWNER = user('user-vendor', [Role.VENDOR]);
const STRANGER = user('user-stranger');
const ADMIN = user('user-admin', [Role.ADMIN]);

/** Minimal Prisma stand-in — only the lookups the service actually performs. */
function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    vendorProfile: {
      findUnique: vi.fn().mockResolvedValue({ userId: VENDOR_OWNER.id }),
    },
    talentProfile: {
      findUnique: vi.fn().mockResolvedValue({ userId: 'user-talent' }),
    },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        customerId: CUSTOMER.id,
        vendor: { userId: VENDOR_OWNER.id },
        talentProfile: null,
      }),
    },
    ...overrides,
  } as never;
}

describe('FileAccessService', () => {
  let service: FileAccessService;

  beforeEach(() => {
    service = new FileAccessService(makePrisma());
  });

  describe('path safety', () => {
    it.each([
      '../../../etc/passwd',
      'vendors/../../secrets/key.pem',
      '/etc/passwd',
      'C:/Windows/System32/config',
      '',
    ])('refuses unsafe key %p', async (key) => {
      await expect(service.assertCanRead(CUSTOMER, key)).rejects.toThrow(NotFoundException);
    });

    it('refuses an unsafe key even for an admin', async () => {
      // Traversal is rejected before the role is considered — otherwise an admin session
      // becomes an arbitrary filesystem read.
      await expect(service.assertCanRead(ADMIN, '../../.env')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deny by default', () => {
    it('refuses an unrecognised key prefix', async () => {
      await expect(service.assertCanRead(CUSTOMER, 'backups/db.sql')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a bare filename with no scope', async () => {
      await expect(service.assertCanRead(CUSTOMER, 'secret.pdf')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('admins', () => {
    it('may read any well-formed key', async () => {
      await expect(
        service.assertCanRead(ADMIN, 'vendors/vendor-1/documents/fayda.pdf'),
      ).resolves.toBeUndefined();
      await expect(
        service.assertCanRead(ADMIN, 'bookings/ESK-10482/receipt.jpg'),
      ).resolves.toBeUndefined();
    });
  });

  describe('listing photos', () => {
    it('are readable by any signed-in user, being public catalogue content', async () => {
      await expect(
        service.assertCanRead(STRANGER, 'listings/listing-1/1.jpg'),
      ).resolves.toBeUndefined();
    });
  });

  describe('vendor documents', () => {
    it('are readable by the owning vendor', async () => {
      await expect(
        service.assertCanRead(VENDOR_OWNER, 'vendors/vendor-1/documents/fayda.pdf'),
      ).resolves.toBeUndefined();
    });

    it('are NOT readable by another user', async () => {
      await expect(
        service.assertCanRead(STRANGER, 'vendors/vendor-1/documents/fayda.pdf'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404 when the vendor does not exist, rather than revealing absence differently', async () => {
      service = new FileAccessService(
        makePrisma({ vendorProfile: { findUnique: vi.fn().mockResolvedValue(null) } }),
      );
      await expect(
        service.assertCanRead(VENDOR_OWNER, 'vendors/missing/documents/x.pdf'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('customer documents', () => {
    it('are readable by that customer', async () => {
      await expect(
        service.assertCanRead(CUSTOMER, `customers/${CUSTOMER.id}/id.jpg`),
      ).resolves.toBeUndefined();
    });

    it('are NOT readable by a different customer', async () => {
      await expect(
        service.assertCanRead(STRANGER, `customers/${CUSTOMER.id}/id.jpg`),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('booking documents', () => {
    it('are readable by the customer on the booking', async () => {
      await expect(
        service.assertCanRead(CUSTOMER, 'bookings/ESK-10482/agreement.md'),
      ).resolves.toBeUndefined();
    });

    it('are readable by the supplying vendor, who needs the damage evidence', async () => {
      await expect(
        service.assertCanRead(VENDOR_OWNER, 'bookings/ESK-10482/agreement.md'),
      ).resolves.toBeUndefined();
    });

    it('are NOT readable by an unrelated user', async () => {
      await expect(
        service.assertCanRead(STRANGER, 'bookings/ESK-10482/agreement.md'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s for a booking that does not exist', async () => {
      service = new FileAccessService(
        makePrisma({ booking: { findUnique: vi.fn().mockResolvedValue(null) } }),
      );
      await expect(service.assertCanRead(CUSTOMER, 'bookings/ESK-00000/x.pdf')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('includes the talent as a party on a talent booking', async () => {
      service = new FileAccessService(
        makePrisma({
          booking: {
            findUnique: vi.fn().mockResolvedValue({
              customerId: CUSTOMER.id,
              vendor: null,
              talentProfile: { userId: 'user-talent' },
            }),
          },
        }),
      );
      await expect(
        service.assertCanRead(user('user-talent', [Role.TALENT]), 'bookings/ESK-TLT-1/brief.pdf'),
      ).resolves.toBeUndefined();
    });
  });

  describe('isPubliclyReadableKey', () => {
    it.each([
      ['listings/a/1.jpg', true],
      ['categories/cameras.jpg', true],
      ['vendors/v1/fayda.pdf', false],
      ['bookings/ESK-1/receipt.jpg', false],
      ['customers/u1/id.jpg', false],
    ])('%p -> %p', (key, expected) => {
      expect(isPubliclyReadableKey(key)).toBe(expected);
    });
  });
});
