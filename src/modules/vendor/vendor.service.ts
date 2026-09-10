import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  DocumentStatus,
  ListingStatus,
  Prisma,
  SettlementStatus,
  SupplierDocumentType,
  UnitStatus,
  VendorKind,
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
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
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
  documents: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.VendorProfileInclude;

type VendorWithDocuments = Prisma.VendorProfileGetPayload<{ include: typeof vendorInclude }>;

@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
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

    const vendor = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vendorProfile.create({
        data: {
          userId,
          businessName: dto.businessName,
          kind: dto.kind,
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

    const identityChanged =
      (dto.businessName !== undefined && dto.businessName !== vendor.businessName) ||
      (dto.kind !== undefined && dto.kind !== vendor.kind);

    const requiresRereview = identityChanged && vendor.status === VerificationStatus.VERIFIED;

    const updated = await this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: {
        ...dto,
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

    if (
      type === SupplierDocumentType.BUSINESS_REGISTRATION &&
      vendor.kind !== VendorKind.COMPANY
    ) {
      throw new BadRequestException(
        'Business registration applies to company vendors only. Switch the vendor kind to COMPANY first.',
      );
    }

    const stored = await this.storage.put({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `vendors/${vendor.id}/documents`,
    });

    const superseded = vendor.documents.filter((d) => d.type === type);

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

    const outstanding = this.outstandingRequirements(vendor);
    if (outstanding.length > 0) {
      throw new BadRequestException({
        message: 'Profile is not ready for verification',
        outstandingRequirements: outstanding,
      });
    }

    const updated = await this.prisma.vendorProfile.update({
      where: { id: vendor.id },
      data: { status: VerificationStatus.PENDING_REVIEW, rejectionReason: null },
      include: vendorInclude,
    });

    return this.toProfileResponse(updated);
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

    const needsAttention: VendorDashboardResponse['needsAttention'] = [];
    if (pendingRequests > 0) {
      needsAttention.push({
        kind: 'RENTAL_REQUESTS',
        count: pendingRequests,
        title: `${pendingRequests} Rental Request${pendingRequests === 1 ? '' : 's'}`,
        subtitle: 'Confirm equipment availability',
        actionPath: '/vendor/bookings?status=pending',
      });
    }
    if (returnsDue > 0) {
      needsAttention.push({
        kind: 'EQUIPMENT_RETURNS',
        count: returnsDue,
        title: `${returnsDue} Equipment Return${returnsDue === 1 ? '' : 's'}`,
        subtitle: 'Returns scheduled or awaiting inspection',
        actionPath: '/vendor/bookings?status=returning',
      });
    }
    if (listingsMissingAvailability > 0) {
      needsAttention.push({
        kind: 'LISTINGS_INCOMPLETE',
        count: listingsMissingAvailability,
        title: `${listingsMissingAvailability} Equipment Listing${listingsMissingAvailability === 1 ? '' : 's'}`,
        subtitle: 'Missing availability information',
        actionPath: '/vendor/inventory?filter=incomplete',
      });
    }

    return {
      activeRentals,
      availableEquipment,
      pendingRequests,
      monthEarningsMinor: monthEarnings._sum.netMinor ?? 0,
      currency: DEFAULT_CURRENCY,
      needsAttention,
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
   * What still blocks verification, per the client's requirements: Fayda ID always,
   * business registration for companies, and the signed rental agreement for everyone.
   */
  private outstandingRequirements(vendor: VendorWithDocuments): string[] {
    const present = new Set(
      vendor.documents
        .filter((d) => d.status !== DocumentStatus.REJECTED)
        .map((d) => d.type),
    );

    const required: SupplierDocumentType[] = [
      SupplierDocumentType.FAYDA_ID,
      SupplierDocumentType.RENTAL_AGREEMENT,
    ];
    if (vendor.kind === VendorKind.COMPANY) {
      required.push(SupplierDocumentType.BUSINESS_REGISTRATION);
    }

    const labels: Record<string, string> = {
      FAYDA_ID: 'Upload your Fayda ID',
      BUSINESS_REGISTRATION: 'Upload your business registration',
      RENTAL_AGREEMENT: 'Upload the signed rental agreement',
    };

    const missing = required.filter((type) => !present.has(type)).map((t) => labels[t] ?? t);

    if (!vendor.logoKey) missing.push('Add a profile picture or logo');
    if (!vendor.phone) missing.push('Add a phone number');

    return missing;
  }

  private toProfileResponse(vendor: VendorWithDocuments): VendorProfileResponse {
    const outstanding = this.outstandingRequirements(vendor);
    return {
      id: vendor.id,
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
      documents: vendor.documents.map((d) => this.toDocumentResponse(d)),
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
