import { Inject, Injectable, Logger } from '@nestjs/common';
import { BookingStatus, CustomerKind, Prisma, type CustomerProfile } from '@prisma/client';
import { DOCUMENT_MIME_TYPES, UPLOAD_LIMITS, assertValidFile } from '../../common/upload';
import type { UploadedFile } from '../../common/upload';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import {
  CustomerProfileResponse,
  CustomerStatsResponse,
  UpdateCustomerProfileDto,
} from './dto/customer.dto';

/**
 * Fields a booking request cannot be submitted without.
 *
 * Exported so the booking service enforces the same list rather than keeping its own copy
 * that drifts. The ID document is included because the request wizard marks it required.
 */
export const BOOKING_REQUIRED_FIELDS = ['contactPerson', 'phone', 'idDocument'] as const;

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /**
   * Returns the caller's customer profile, creating an empty one on first access.
   *
   * Created on demand rather than at sign-up because a user may browse the catalogue for
   * weeks before booking anything, and an empty row per visitor is noise. Seeded from the
   * `User` record so the form opens pre-filled with what Telegram already told us.
   */
  async getOrCreateProfile(userId: string): Promise<CustomerProfile> {
    const existing = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (existing) return existing;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, phone: true, additionalPhone: true },
    });

    try {
      return await this.prisma.customerProfile.create({
        data: {
          userId,
          contactPerson: user.name,
          email: user.email,
          phone: user.phone,
          additionalPhone: user.additionalPhone,
        },
      });
    } catch (error) {
      // Two concurrent first requests race on the unique userId. The loser re-reads
      // rather than failing, which is what the caller wanted anyway.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.customerProfile.findUniqueOrThrow({ where: { userId } });
      }
      throw error;
    }
  }

  async getProfile(userId: string): Promise<CustomerProfileResponse> {
    return this.toResponse(await this.getOrCreateProfile(userId));
  }

  /**
   * Updates the commercial details.
   *
   * Deliberately cannot touch `verificationStatus`: that is Eskista's decision, and a
   * customer editing their own name should not silently re-verify them. Editing after
   * verification is allowed — the details on file are what the invoice needs to be
   * current, and re-running KYC over a corrected phone number would be theatre.
   */
  async updateProfile(
    userId: string,
    dto: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileResponse> {
    await this.getOrCreateProfile(userId);

    const updated = await this.prisma.customerProfile.update({
      where: { userId },
      data: {
        organisationName: dto.organisationName,
        kind: dto.kind,
        contactPerson: dto.contactPerson,
        email: dto.email,
        phone: dto.phone,
        additionalPhone: dto.additionalPhone,
        city: dto.city,
        address: dto.address,
      },
    });

    return this.toResponse(updated);
  }

  /**
   * Stores the customer's ID document.
   *
   * Replacing an existing document resets verification to PENDING_REVIEW — a verified
   * customer who swaps their ID must be looked at again, or the check means nothing.
   */
  async uploadIdDocument(
    userId: string,
    file: UploadedFile | undefined,
  ): Promise<CustomerProfileResponse> {
    const valid = assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.document,
      field: 'idDocument',
    });

    const profile = await this.getOrCreateProfile(userId);

    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      // Owner-scoped so FileAccessService can authorise it from the key alone.
      folder: `customers/${userId}/id-document`,
    });

    const previousKey = profile.idDocumentKey;

    const updated = await this.prisma.customerProfile.update({
      where: { userId },
      data: {
        idDocumentKey: stored.key,
        idDocumentName: valid.originalname,
        idDocumentMimeType: valid.mimetype,
        idDocumentSizeBytes: valid.size,
        idDocumentUploadedAt: new Date(),
        verificationStatus: 'PENDING_REVIEW',
        rejectionReason: null,
      },
    });

    if (previousKey && previousKey !== stored.key) {
      // Best-effort: the row already points at the new file, so a failed cleanup leaves
      // an orphan rather than a broken profile.
      await this.storage.remove(previousKey).catch((error: unknown) => {
        this.logger.warn(
          `Could not remove superseded ID document ${previousKey}: ${String(error)}`,
        );
      });
    }

    return this.toResponse(updated);
  }

  /**
   * The three counters on the Profile screen.
   *
   * "Vendors" counts distinct vendors across closed bookings — the designs label it as a
   * relationship count, not a booking count, so two rentals from one vendor count once.
   */
  async getStats(userId: string): Promise<CustomerStatsResponse> {
    const profile = await this.getOrCreateProfile(userId);

    const [bookings, vendorGroups] = await Promise.all([
      this.prisma.booking.count({
        where: { customerId: userId, status: BookingStatus.CLOSED },
      }),
      this.prisma.booking.groupBy({
        by: ['vendorId'],
        where: {
          customerId: userId,
          status: BookingStatus.CLOSED,
          vendorId: { not: null },
        },
      }),
    ]);

    return {
      bookings,
      rating: profile.ratingCount > 0 ? Number(profile.ratingAvg) : null,
      ratingCount: profile.ratingCount,
      vendors: vendorGroups.length,
    };
  }

  // ── mapping ────────────────────────────────────────────────────────────────

  private toResponse(profile: CustomerProfile): CustomerProfileResponse {
    const outstanding = this.outstandingRequirements(profile);

    return {
      id: profile.id,
      organisationName: profile.organisationName,
      kind: profile.kind,
      contactPerson: profile.contactPerson,
      email: profile.email,
      phone: profile.phone,
      additionalPhone: profile.additionalPhone,
      city: profile.city,
      address: profile.address,
      verificationStatus: profile.verificationStatus,
      rejectionReason: profile.rejectionReason,
      idDocument:
        profile.idDocumentKey && profile.idDocumentUploadedAt
          ? {
              fileName: profile.idDocumentName ?? 'id-document',
              url: this.storage.urlFor(profile.idDocumentKey),
              mimeType: profile.idDocumentMimeType ?? 'application/octet-stream',
              sizeBytes: profile.idDocumentSizeBytes ?? 0,
              uploadedAt: profile.idDocumentUploadedAt.toISOString(),
            }
          : null,
      isBookingReady: outstanding.length === 0,
      outstandingRequirements: outstanding,
      createdAt: profile.createdAt.toISOString(),
    };
  }

  /**
   * What is still missing before a booking request can be submitted.
   *
   * Returned to the client so the wizard can show the gaps, and re-checked server-side at
   * submission — this list is for rendering, never for authorisation.
   */
  private outstandingRequirements(profile: CustomerProfile): string[] {
    const missing: string[] = [];

    if (!profile.contactPerson.trim()) missing.push('contactPerson');
    if (!profile.phone) missing.push('phone');
    if (!profile.idDocumentKey) missing.push('idDocument');

    // A company that cannot be named cannot be invoiced correctly.
    if (profile.kind === CustomerKind.COMPANY && !profile.organisationName) {
      missing.push('organisationName');
    }

    return missing;
  }
}
