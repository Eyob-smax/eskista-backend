import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../auth/auth.types';
import { isPublicMediaKey, isUnsafeKey } from './storage-keys';

/**
 * Decides who may read a stored file.
 *
 * Storage keys are structured by owner — `vendors/<vendorId>/…`,
 * `bookings/<reference>/…`, `customers/<customerId>/…`, `listings/<listingId>/…` — so
 * entitlement is derived from the key rather than kept in a second table that could drift
 * out of step with the object it describes.
 *
 * Two rules throughout:
 *
 *  - **Deny by default.** An unrecognised key prefix is refused, not allowed. New upload
 *    folders must be granted access here deliberately.
 *  - **404, never 403.** Telling an unentitled caller that a key exists leaks the fact that
 *    a particular vendor, booking or customer exists. The only exception is a caller with
 *    no session at all, which is a plain 401 from the guard.
 */
@Injectable()
export class FileAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Throws unless `user` may read `key`.
   *
   * Admins may read anything — they arbitrate disputes and verify payments, which means
   * reading both sides' evidence.
   */
  async assertCanRead(user: SessionUser, key: string): Promise<void> {
    if (isUnsafeKey(key)) {
      throw new NotFoundException('File not found');
    }

    if (user.roles.includes(Role.ADMIN)) return;

    // Catalogue photos, category art, vendor logos and talent profile media — the same rule
    // that lets the Cloudinary driver put them on the public CDN.
    if (isPublicMediaKey(key)) return;

    const [scope, id, area] = key.split('/');

    switch (scope) {
      case 'listings':
        // Listing photos are public marketing content, shown on the catalogue.
        return;

      case 'categories':
        return;

      case 'vendors':
        // The logo is shown on every listing's vendor card, so customers must be able to
        // read it. Everything else under a vendor — KYC, agreements — stays the owner's.
        if (area === 'logo') return;
        return this.assertOwnsVendor(user, id);

      case 'talent':
        // A talent's photo and portfolio covers are their public profile. ID scans and
        // signed agreements live outside `public/` and stay the owner's.
        if (area === 'public') return;
        return this.assertOwnsTalent(user, id);

      case 'customers':
        this.assertOwnsCustomer(user, id);
        return;

      case 'bookings':
        return this.assertPartyToBooking(user, id);

      default:
        // Deny by default: an unknown prefix is a bug or an attack, never a grant.
        throw new NotFoundException('File not found');
    }
  }

  private async assertOwnsVendor(user: SessionUser, vendorId: string): Promise<void> {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { userId: true },
    });
    if (!vendor || vendor.userId !== user.id) {
      throw new NotFoundException('File not found');
    }
  }

  private async assertOwnsTalent(user: SessionUser, talentProfileId: string): Promise<void> {
    const talent = await this.prisma.talentProfile.findUnique({
      where: { id: talentProfileId },
      select: { userId: true },
    });
    if (!talent || talent.userId !== user.id) {
      throw new NotFoundException('File not found');
    }
  }

  /** Synchronous: a customer's own id is already on the session, so there is nothing to look up. */
  private assertOwnsCustomer(user: SessionUser, customerUserId: string): void {
    if (customerUserId !== user.id) {
      throw new NotFoundException('File not found');
    }
  }

  /**
   * A booking's files are visible to its customer, to the supplying vendor or talent, and
   * to admins. The vendor is included because handover and inspection evidence is exactly
   * what they need in a damage dispute.
   */
  private async assertPartyToBooking(user: SessionUser, reference: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { reference },
      select: {
        customerId: true,
        vendor: { select: { userId: true } },
        talentProfile: { select: { userId: true } },
        // A talent hired on this request can read its brief. Merely invited is not
        // enough: reference files often identify the client, who stays anonymous until
        // a hire is made.
        invitations: {
          where: { status: 'HIRED' },
          select: { talentProfile: { select: { userId: true } } },
        },
      },
    });

    if (!booking) throw new NotFoundException('File not found');

    const parties = [
      booking.customerId,
      booking.vendor?.userId,
      booking.talentProfile?.userId,
      ...(booking.invitations ?? []).map((i) => i.talentProfile.userId),
    ].filter((v): v is string => typeof v === 'string');

    if (!parties.includes(user.id)) {
      throw new NotFoundException('File not found');
    }
  }
}

/**
 * Exported for tests and for anywhere that needs the same reasoning without a request
 * context. Kept alongside the service so the two cannot drift apart.
 */
export const PUBLIC_KEY_SCOPES = ['listings', 'categories'] as const;

export function isPubliclyReadableKey(key: string): boolean {
  const scope = key.split('/')[0];
  return (PUBLIC_KEY_SCOPES as readonly string[]).includes(scope);
}

export { ForbiddenException };
