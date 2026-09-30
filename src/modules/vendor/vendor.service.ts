import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminTier,
  AgreementStatus,
  AgreementType,
  BookingStatus,
  DocumentStatus,
  ListingStatus,
  Prisma,
  SettlementStatus,
  SupplierDocumentType,
  UnitStatus,
  VendorKind,
  VendorType,
  VerificationStatus,
} from '@prisma/client';
import { DEFAULT_CURRENCY } from '../../common/money';
import {
  assertValidFile,
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  type UploadedFile,
} from '../../common/upload';
import { NotificationsService } from '../notifications/notifications.service';
import { AgreementsService } from '../agreements/agreements.service';
import type {
  AgreementBodyResponse,
  AgreementResponse,
  UploadSignedAgreementDto,
} from '../agreements/dto/agreement.dto';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import { vendorBadge } from '../vendor-bookings/vendor-booking-view';
import type {
  CreateVendorProfileDto,
  UpdateVendorProfileDto,
  VendorDashboardResponse,
  VendorDocumentResponse,
  VendorProfileResponse,
} from './dto/vendor.dto';

/** Statuses that mean a booking is live work rather than history. */
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
];

const PENDING_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.REQUEST_SUBMITTED,
  BookingStatus.ESKISTA_REVIEW,
];

const vendorInclude = {
  documents: { orderBy: { createdAt: 'asc' } },
  agreements: true,
  _count: {
    select: {
      listings: { where: { status: { not: ListingStatus.ARCHIVED } } },
      bookings: { where: { status: BookingStatus.CLOSED } },
    },
  },
} satisfies Prisma.VendorProfileInclude;

/** "Upload Your ID" — a Fayda ID or a passport, front and back. */
const ID_TYPES: SupplierDocumentType[] = [
  SupplierDocumentType.FAYDA_ID,
  SupplierDocumentType.PASSPORT,
];
const MAX_ID_FILES = 2;
/** "Business License" — either document proves a registered business. */
const BUSINESS_TYPES: SupplierDocumentType[] = [
  SupplierDocumentType.BUSINESS_LICENSE,
  SupplierDocumentType.BUSINESS_REGISTRATION,
];

/** The design asks for a vendor type only; an individual is the one type that is not a company. */
export function kindForType(vendorType: VendorType): VendorKind {
  return vendorType === VendorType.INDIVIDUAL ? VendorKind.INDIVIDUAL : VendorKind.COMPANY;
}

type VendorWithDocuments = Prisma.VendorProfileGetPayload<{ include: typeof vendorInclude }>;

@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agreements: AgreementsService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /**
   * Creates the vendor profile for the signed-in user and grants them the VENDOR role.
   *
   * A user holds at most one vendor profile. Granting the role here rather than at
   * verification time is deliberate: the vendor experience must be reachable while the
   * profile is still a draft, otherwise they cannot upload the documents that unblock it.
   */
  async createProfile(userId: string, dto: CreateVendorProfileDto): Promise<VendorProfileResponse> {
    const existing = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('This account already has a vendor profile');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, experienceChosenAt: true },
    });

    const vendor = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vendorProfile.create({
        data: {
          userId,
          contactName: dto.contactName ?? user.name,
          businessName: dto.businessName,
          kind: dto.kind ?? kindForType(dto.vendorType),
          termsAcceptedAt: new Date(),
          vendorType: dto.vendorType,
          email: dto.email,
          phone: dto.phone,
          location: dto.location,
          about: dto.about,
          status: VerificationStatus.DRAFT,
        },
        include: vendorInclude,
      });

      await tx.roleMembership.upsert({
        where: { userId_role: { userId, role: 'VENDOR' } },
        create: { userId, role: 'VENDOR' },
        update: {},
      });
      // They chose "list my equipment" to get here; open the vendor app for them.
      await tx.user.update({
        where: { id: userId },
        data: { activeRole: 'VENDOR', experienceChosenAt: user.experienceChosenAt ?? new Date() },
      });

      if (dto.additionalPhone) {
        await tx.user.update({
          where: { id: userId },
          data: { additionalPhone: dto.additionalPhone },
        });
      }

      return created;
    });

    return this.toProfileResponse(vendor);
  }

  async getProfile(userId: string): Promise<VendorProfileResponse> {
    return this.toProfileResponse(await this.requireVendor(userId));
  }

  /**
   * Updates business details.
   *
   * A verified profile can still be edited, but any change to identity-bearing fields
   * sends it back for review — otherwise a vendor could pass verification as an
   * individual and then silently rename themselves into a company.
   */
  async updateProfile(userId: string, dto: UpdateVendorProfileDto): Promise<VendorProfileResponse> {
    const vendor = await this.requireVendor(userId);

    // A new vendor type implies its kind unless the kind is sent explicitly.
    const kind = dto.kind ?? (dto.vendorType ? kindForType(dto.vendorType) : undefined);
    const identityChanged =
      (dto.businessName !== undefined && dto.businessName !== vendor.businessName) ||
      (kind !== undefined && kind !== vendor.kind);

    const requiresRereview = identityChanged && vendor.status === VerificationStatus.VERIFIED;

    const updated = await this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: {
        ...dto,
        kind,
        ...(requiresRereview
          ? { status: VerificationStatus.PENDING_REVIEW, verifiedAt: null }
          : {}),
      },
      include: vendorInclude,
    });

    return this.toProfileResponse(updated);
  }

  async updateLogo(userId: string, file: UploadedFile): Promise<VendorProfileResponse> {
    const vendor = await this.requireVendor(userId);
    assertValidFile(file, {
      allowed: IMAGE_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.image,
      field: 'logo',
    });

    const stored = await this.storage.put({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `vendors/${vendor.id}/logo`,
    });

    const previousKey = vendor.logoKey;
    const updated = await this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: { logoKey: stored.key },
      include: vendorInclude,
    });

    // Remove the old file only after the new key is committed.
    if (previousKey) await this.storage.remove(previousKey);

    return this.toProfileResponse(updated);
  }

  async listDocuments(userId: string): Promise<VendorDocumentResponse[]> {
    const vendor = await this.requireVendor(userId);
    return vendor.documents.map((doc) => this.toDocumentResponse(doc));
  }

  /**
   * Uploads a KYC document. Re-uploading a type replaces the previous file, so a vendor
   * can respond to a rejection without accumulating dead rows.
   */
  async uploadDocument(
    userId: string,
    type: SupplierDocumentType,
    file: UploadedFile,
  ): Promise<VendorDocumentResponse> {
    const vendor = await this.requireVendor(userId);
    assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.document,
      field: 'document',
    });

    if (type === SupplierDocumentType.BUSINESS_REGISTRATION && vendor.kind !== VendorKind.COMPANY) {
      throw new BadRequestException(
        'Business registration applies to company vendors only. Switch the vendor kind to COMPANY first.',
      );
    }

    // An ID has a front and a back: up to two files, kept side by side. Anything else is one
    // file per type, and a new upload replaces the old one.
    const isId = ID_TYPES.includes(type);
    const existingIds = vendor.documents.filter((d) => ID_TYPES.includes(d.type));
    if (isId && existingIds.length >= MAX_ID_FILES) {
      throw new ConflictException(
        `Your ID already has ${MAX_ID_FILES} files (front and back). Remove one to replace it.`,
      );
    }

    const stored = await this.storage.put({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `vendors/${vendor.id}/documents`,
    });

    const superseded = isId ? [] : vendor.documents.filter((d) => d.type === type);

    const doc = await this.prisma.$transaction(async (tx) => {
      if (superseded.length > 0) {
        await tx.supplierDocument.deleteMany({
          where: { id: { in: superseded.map((d) => d.id) } },
        });
      }

      const created = await tx.supplierDocument.create({
        data: {
          vendorId: vendor.id,
          type,
          fileKey: stored.key,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          status: DocumentStatus.PENDING,
        },
      });

      // A new document invalidates a prior rejection.
      if (vendor.status === VerificationStatus.REJECTED) {
        await tx.vendorProfile.update({
          where: { id: vendor.id },
          data: { status: VerificationStatus.DRAFT, rejectionReason: null },
        });
      }

      return created;
    });

    for (const old of superseded) await this.storage.remove(old.fileKey);

    return this.toDocumentResponse(doc);
  }

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const vendor = await this.requireVendor(userId);
    const doc = vendor.documents.find((d) => d.id === documentId);
    if (!doc) throw new NotFoundException('Document not found');

    if (doc.status === DocumentStatus.VERIFIED) {
      throw new BadRequestException('A verified document cannot be removed');
    }

    await this.prisma.supplierDocument.delete({ where: { id: doc.id } });
    await this.storage.remove(doc.fileKey);
  }

  /** Moves a complete draft into the admin verification queue. */
  async submitForVerification(userId: string): Promise<VendorProfileResponse> {
    const vendor = await this.requireVendor(userId);

    if (vendor.status === VerificationStatus.PENDING_REVIEW) {
      throw new ConflictException('This profile is already awaiting review');
    }
    if (vendor.status === VerificationStatus.VERIFIED) {
      throw new ConflictException('This profile is already verified');
    }
    if (vendor.status === VerificationStatus.SUSPENDED) {
      throw new BadRequestException('Suspended profiles cannot be resubmitted; contact support');
    }

    const blocking = this.outstandingRequirements(vendor);
    if (blocking.length > 0) {
      throw new BadRequestException({
        message: 'Profile is not ready for verification',
        outstandingRequirements: blocking,
      });
    }

    await this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: { status: VerificationStatus.PENDING_REVIEW, rejectionReason: null },
    });

    // Issued on submission rather than after approval, so the vendor can read and sign
    // the contract while Eskista reviews their documents instead of waiting twice.
    await this.agreements.issueVendorOnboarding(vendor.id);
    await this.notifications.notifyAdmins(
      'ADMIN_SUPPLIER_SUBMITTED',
      { name: vendor.businessName, kind: 'vendor' },
      { vendorId: vendor.id },
      [AdminTier.ADMIN],
    );

    return this.toProfileResponse(await this.requireVendor(userId));
  }

  /** The Eskista-to-vendor agreement with its frozen text, for display before signing. */
  async getOnboardingAgreement(userId: string): Promise<AgreementBodyResponse> {
    const vendor = await this.requireVendor(userId);
    const agreement = vendor.agreements.find((a) => a.kind === AgreementType.VENDOR_ONBOARDING);
    if (!agreement) {
      throw new NotFoundException(
        'No vendor agreement has been issued yet. Submit your profile for verification first.',
      );
    }

    return {
      ...this.toAgreementResponse(agreement),
      body: await this.agreements.getBody(agreement.id, userId),
    };
  }

  /**
   * Accepts the vendor's scan of the hand-signed onboarding agreement.
   *
   * Contracts are signed on paper and scanned back in — there is no in-app signature pad.
   * The upload puts the agreement into UNDER_REVIEW; Eskista approves it separately.
   */
  async uploadSignedOnboardingAgreement(
    userId: string,
    dto: UploadSignedAgreementDto,
    file: UploadedFile | undefined,
  ): Promise<AgreementResponse> {
    const vendor = await this.requireVendor(userId);
    const agreement = vendor.agreements.find((a) => a.kind === AgreementType.VENDOR_ONBOARDING);
    if (!agreement) throw new NotFoundException('No vendor agreement has been issued yet');

    const valid = assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.receipt,
      field: 'signedAgreement',
    });

    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `vendors/${vendor.id}/agreements/signed`,
    });

    const uploaded = await this.agreements.uploadSignedCopy(agreement.id, userId, {
      signerName: dto.signerName,
      signerPhone: dto.signerPhone ?? vendor.phone ?? undefined,
      fileKey: stored.key,
      fileName: valid.originalname,
      mimeType: valid.mimetype,
      sizeBytes: valid.size,
    });
    await this.notifications.notifyAdmins(
      'ADMIN_AGREEMENT_UPLOADED',
      { reference: vendor.businessName },
      { vendorId: vendor.id, agreementId: agreement.id },
      [AdminTier.ADMIN],
    );
    return this.toAgreementResponse(uploaded);
  }

  /** The vendor home screen: four KPI tiles plus the "Needs Your Attention" feed. */
  async getDashboard(userId: string): Promise<VendorDashboardResponse> {
    const vendor = await this.requireVendor(userId);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      activeRentals,
      availableEquipment,
      pendingRequests,
      monthEarnings,
      returnsDue,
      listingsMissingAvailability,
    ] = await this.prisma.$transaction([
      this.prisma.booking.count({
        where: { vendorId: vendor.id, status: { in: ACTIVE_BOOKING_STATUSES } },
      }),
      this.prisma.equipmentUnit.count({
        where: {
          status: UnitStatus.AVAILABLE,
          listing: { vendorId: vendor.id, status: ListingStatus.PUBLISHED },
        },
      }),
      this.prisma.booking.count({
        where: { vendorId: vendor.id, status: { in: PENDING_BOOKING_STATUSES } },
      }),
      this.prisma.settlement.aggregate({
        where: {
          vendorId: vendor.id,
          status: { in: [SettlementStatus.PAID, SettlementStatus.IN_BATCH] },
          createdAt: { gte: monthStart },
        },
        _sum: { netMinor: true },
      }),
      this.prisma.booking.count({
        where: {
          vendorId: vendor.id,
          status: { in: [BookingStatus.RETURN_SCHEDULED, BookingStatus.RETURN_RECEIVED] },
        },
      }),
      this.prisma.listing.count({
        where: { vendorId: vendor.id, status: ListingStatus.PUBLISHED, units: { none: {} } },
      }),
    ]);

    const listingCard = {
      name: true,
      images: { where: { isPrimary: true }, take: 1, select: { fileKey: true } },
    } as const;
    const [returns, toPrepare, upcoming] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          vendorId: vendor.id,
          status: { in: [BookingStatus.RETURN_SCHEDULED, BookingStatus.RETURN_RECEIVED] },
        },
        select: { listing: { select: { name: true } } },
        take: 1,
      }),
      // Accepted and paid-for or awaiting payment, but not yet marked ready.
      this.prisma.booking.findMany({
        where: {
          vendorId: vendor.id,
          supplierResponse: 'ACCEPTED',
          status: { in: [BookingStatus.AWAITING_PAYMENT, BookingStatus.BOOKING_CONFIRMED] },
          OR: [{ handover: null }, { handover: { preparedAt: null } }],
        },
        select: { reference: true, listing: { select: { name: true } } },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: {
          vendorId: vendor.id,
          status: {
            in: [
              BookingStatus.ESKISTA_REVIEW,
              BookingStatus.AWAITING_PAYMENT,
              BookingStatus.BOOKING_CONFIRMED,
            ],
          },
          supplierResponse: 'ACCEPTED',
        },
        include: {
          listing: { select: listingCard },
          customer: { select: { customer: { select: { organisationName: true } } } },
        },
        orderBy: { startDate: 'asc' },
        take: 5,
      }),
    ]);

    const needsAttention: VendorDashboardResponse['needsAttention'] = [];
    if (pendingRequests > 0) {
      needsAttention.push({
        kind: 'RENTAL_REQUESTS',
        count: pendingRequests,
        title: `${pendingRequests} Rental Request${pendingRequests === 1 ? '' : 's'}`,
        subtitle: 'Confirm equipment availability',
        actionPath: '/api/v1/vendor/bookings?tab=pending',
      });
    }
    if (toPrepare.length > 0) {
      needsAttention.push({
        kind: 'PREPARE_EQUIPMENT',
        count: toPrepare.length,
        title: `${toPrepare.length} Booking${toPrepare.length === 1 ? '' : 's'} to Prepare`,
        subtitle:
          toPrepare.length === 1
            ? `Prepare ${toPrepare[0].listing?.name ?? 'the equipment'} for handover`
            : 'Prepare the equipment for handover',
        actionPath: `/api/v1/vendor/bookings/${toPrepare[0].reference}/preparation`,
      });
    }
    if (returnsDue > 0) {
      needsAttention.push({
        kind: 'EQUIPMENT_RETURNS',
        count: returnsDue,
        title: `${returnsDue} Equipment Return${returnsDue === 1 ? '' : 's'}`,
        subtitle:
          returnsDue === 1
            ? `${returns[0].listing?.name ?? 'Equipment'} return scheduled`
            : 'Returns scheduled or awaiting inspection',
        actionPath: '/api/v1/vendor/bookings?tab=active',
      });
    }
    if (listingsMissingAvailability > 0) {
      needsAttention.push({
        kind: 'LISTINGS_INCOMPLETE',
        count: listingsMissingAvailability,
        title: `${listingsMissingAvailability} Equipment Listing${listingsMissingAvailability === 1 ? '' : 's'}`,
        subtitle: 'Missing availability information',
        actionPath: '/api/v1/vendor/equipment',
      });
    }

    // Greeting in Addis Ababa time (UTC+3, no daylight saving).
    const hour = (new Date().getUTCHours() + 3) % 24;
    const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

    return {
      greeting,
      businessName: vendor.businessName,
      isVerified: vendor.status === VerificationStatus.VERIFIED,
      logoUrl: vendor.logoKey ? this.storage.urlFor(vendor.logoKey) : null,
      activeRentals,
      availableEquipment,
      pendingRequests,
      monthEarningsMinor: monthEarnings._sum.netMinor ?? 0,
      currency: DEFAULT_CURRENCY,
      needsAttention,
      upcomingRentals: upcoming.map((b) => {
        const image = b.listing?.images[0];
        return {
          reference: b.reference,
          productName: b.listing?.name ?? '—',
          productImageUrl: image ? this.storage.urlFor(image.fileKey) : null,
          customerOrganisation: b.customer.customer?.organisationName ?? null,
          startDate: b.startDate.toISOString().slice(0, 10),
          endDate: b.endDate.toISOString().slice(0, 10),
          badge: vendorBadge(b.status, b.supplierResponse),
        };
      }),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Loads the caller's vendor profile, or 404s. Every vendor route funnels through this. */
  private async requireVendor(userId: string): Promise<VendorWithDocuments> {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      include: vendorInclude,
    });
    if (!vendor) {
      throw new NotFoundException('No vendor profile for this account. Complete onboarding first.');
    }
    return vendor;
  }

  /**
   * What still blocks submission.
   *
   * Client, confirmed: a COMPANY must supply a business registration; for an INDIVIDUAL
   * the Fayda ID alone is enough. The rental agreement is deliberately absent here — it
   * is no longer an uploaded document but a generated Eskista-to-vendor agreement the
   * vendor signs, tracked in postSubmissionRequirements below.
   */
  private outstandingRequirements(vendor: VendorWithDocuments): string[] {
    const usable = vendor.documents.filter((d) => d.status !== DocumentStatus.REJECTED);
    const missing: string[] = [];
    if (!usable.some((d) => ID_TYPES.includes(d.type))) missing.push('Upload your ID');
    if (
      vendor.kind === VendorKind.COMPANY &&
      !usable.some((d) => BUSINESS_TYPES.includes(d.type))
    ) {
      missing.push('Upload your business license');
    }
    if (!vendor.contactName) missing.push('Add your full name');

    if (!vendor.logoKey) missing.push('Add a profile picture or logo');
    if (!vendor.phone) missing.push('Add a phone number');

    return missing;
  }

  /**
   * Requirements that only apply once the profile has been submitted — currently the
   * Eskista-to-vendor agreement, which is issued at submission and must be signed before
   * Eskista can verify the profile.
   */
  private postSubmissionRequirements(vendor: VendorWithDocuments): string[] {
    const onboarding = vendor.agreements.find((a) => a.kind === AgreementType.VENDOR_ONBOARDING);
    if (!onboarding) return [];
    if (onboarding.status === AgreementStatus.APPROVED) return [];
    if (onboarding.status === AgreementStatus.UNDER_REVIEW) {
      return ['Eskista is checking your signed agreement'];
    }
    if (onboarding.status === AgreementStatus.REJECTED) {
      return ['Your signed agreement was not accepted - upload a clearer scan'];
    }
    if (onboarding.status === AgreementStatus.DECLINED) {
      return ['You declined the Eskista vendor agreement - contact support to continue'];
    }
    return ['Download, sign and upload the Eskista vendor agreement'];
  }

  private toAgreementResponse(agreement: {
    id: string;
    kind: AgreementType;
    status: AgreementStatus;
    version: number;
    contentHash: string | null;
    documentKey: string | null;
    sentAt: Date | null;
    uploadedAt: Date | null;
    reviewedAt: Date | null;
    scannedCopyKey: string | null;
    rejectionReason: string | null;
    signerName: string | null;
    declinedAt: Date | null;
    declineReason: string | null;
    createdAt: Date;
  }): AgreementResponse {
    return {
      id: agreement.id,
      kind: agreement.kind,
      status: agreement.status,
      version: agreement.version,
      contentHash: agreement.contentHash,
      documentUrl: agreement.documentKey ? this.storage.urlFor(agreement.documentKey) : null,
      sentAt: agreement.sentAt,
      uploadedAt: agreement.uploadedAt,
      reviewedAt: agreement.reviewedAt,
      signedCopyUrl: agreement.scannedCopyKey
        ? this.storage.urlFor(agreement.scannedCopyKey)
        : null,
      rejectionReason: agreement.rejectionReason,
      signerName: agreement.signerName,
      declinedAt: agreement.declinedAt,
      declineReason: agreement.declineReason,
      createdAt: agreement.createdAt,
    };
  }

  private toProfileResponse(vendor: VendorWithDocuments): VendorProfileResponse {
    const outstanding = [
      ...this.outstandingRequirements(vendor),
      ...this.postSubmissionRequirements(vendor),
    ];
    const group = (types: SupplierDocumentType[], required: boolean) => {
      const files = vendor.documents.filter((d) => types.includes(d.type));
      return {
        files: files.map((d) => this.toDocumentResponse(d)),
        verified: files.length > 0 && files.every((d) => d.status === DocumentStatus.VERIFIED),
        required,
      };
    };
    return {
      id: vendor.id,
      contactName: vendor.contactName,
      businessName: vendor.businessName,
      kind: vendor.kind,
      vendorType: vendor.vendorType,
      email: vendor.email,
      phone: vendor.phone,
      location: vendor.location,
      about: vendor.about,
      logoUrl: vendor.logoKey ? this.storage.urlFor(vendor.logoKey) : null,
      status: vendor.status,
      rejectionReason: vendor.rejectionReason,
      verifiedAt: vendor.verifiedAt,
      ratingAvg: Number(vendor.ratingAvg),
      ratingCount: vendor.ratingCount,
      createdAt: vendor.createdAt,
      joinedLabel: `Joined Since ${vendor.createdAt.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })}`,
      isVerified: vendor.status === VerificationStatus.VERIFIED,
      termsAcceptedAt: vendor.termsAcceptedAt,
      stats: {
        rentals: vendor._count.bookings,
        equipment: vendor._count.listings,
        rating: vendor.ratingCount > 0 ? Number(vendor.ratingAvg) : null,
      },
      documents: vendor.documents.map((d) => this.toDocumentResponse(d)),
      verification: {
        id: group(ID_TYPES, true),
        businessLicense: group(BUSINESS_TYPES, vendor.kind === VendorKind.COMPANY),
      },
      outstandingRequirements: outstanding,
      canSubmitForVerification:
        outstanding.length === 0 &&
        (vendor.status === VerificationStatus.DRAFT ||
          vendor.status === VerificationStatus.REJECTED),
    };
  }

  private toDocumentResponse(doc: {
    id: string;
    type: SupplierDocumentType;
    fileKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    status: DocumentStatus;
    rejectionReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
  }): VendorDocumentResponse {
    return {
      id: doc.id,
      type: doc.type,
      fileName: doc.fileName,
      fileUrl: this.storage.urlFor(doc.fileKey),
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      reviewedAt: doc.reviewedAt,
      createdAt: doc.createdAt,
    };
  }
}
