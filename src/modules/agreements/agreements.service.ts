import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgreementStatus, AgreementType, Prisma, VendorKind, type Agreement } from '@prisma/client';
import { formatMoney } from '../../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';

export interface UploadSignedCopyInput {
  /** Who physically signed the printed contract. */
  signerName: string;
  signerPhone?: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Generation and signing of the two contracts the client described:
 *
 *   • Eskista ↔ Supplier — signed once at onboarding. The text differs by vendor kind,
 *     because an individual has no business registration to warrant.
 *   • Eskista ↔ Customer — generated per booking.
 *
 * Signing is **offline**: Eskista generates the contract, the counterparty downloads and
 * prints it, signs it by hand, and uploads the scan. There is no in-app signature pad —
 * the client replaced that flow in September 2026. The lifecycle is therefore
 * `AWAITING_UPLOAD → UNDER_REVIEW → APPROVED`, with Eskista checking each scan.
 *
 * A contract is only meaningful if you can prove *what* was agreed, so the rendered body
 * is frozen to storage and hashed at issue time. `contentHash` covers the exact bytes, so
 * the scan can always be checked against the document that was actually issued.
 *
 * PDF rendering is not implemented yet. The frozen artefact is Markdown, which hashes and
 * archives identically; a renderer can be layered on without invalidating anything.
 */
@Injectable()
export class AgreementsService {
  private readonly logger = new Logger(AgreementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /**
   * Issues the Eskista ↔ Vendor onboarding agreement.
   *
   * Idempotent: calling it again returns the existing agreement rather than superseding
   * one the vendor may already have signed.
   */
  async issueVendorOnboarding(vendorId: string): Promise<Agreement> {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const existing = await this.prisma.agreement.findFirst({
      where: { vendorId, kind: AgreementType.VENDOR_ONBOARDING },
    });
    if (existing) return existing;

    const template = await this.resolveTemplate(AgreementType.VENDOR_ONBOARDING, vendor.kind);

    const body = this.interpolate(template.bodyMarkdown, {
      vendorName: vendor.businessName,
      vendorKind: vendor.kind === VendorKind.COMPANY ? 'Company' : 'Individual',
      vendorLocation: vendor.location,
      vendorEmail: vendor.email,
      vendorPhone: vendor.phone ?? '—',
      commissionRate: `${((vendor.commissionRateBps ?? 1500) / 100).toFixed(2)}%`,
      signerName: vendor.user.name,
      issuedAt: new Date().toISOString().slice(0, 10),
    });

    const { documentKey, contentHash } = await this.freeze(body, `vendors/${vendorId}/agreements`);

    return this.prisma.agreement.create({
      data: {
        kind: AgreementType.VENDOR_ONBOARDING,
        templateId: template.id,
        version: template.version,
        vendorId,
        counterpartyId: vendor.user.id,
        status: AgreementStatus.AWAITING_UPLOAD,
        sentAt: new Date(),
        documentKey,
        contentHash,
      },
    });
  }

  /** Issues the Eskista ↔ Customer agreement for a booking. */
  async issueForBooking(bookingId: string): Promise<Agreement> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        listing: { select: { name: true } },
        talentProfile: { select: { displayName: true } },
        equipmentDetail: true,
        talentDetail: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const kind =
      booking.type === 'EQUIPMENT'
        ? AgreementType.EQUIPMENT_RENTAL
        : AgreementType.TALENT_ENGAGEMENT;

    const existing = await this.prisma.agreement.findFirst({ where: { bookingId, kind } });
    if (existing) return existing;

    const template = await this.resolveTemplate(kind, null);

    const body = this.interpolate(template.bodyMarkdown, {
      reference: booking.reference,
      clientName: booking.customer.name,
      itemName: booking.listing?.name ?? booking.talentProfile?.displayName ?? '—',
      talentName: booking.talentProfile?.displayName ?? '—',
      eventLocation: booking.talentDetail?.eventLocation ?? '—',
      startDate: booking.startDate.toISOString().slice(0, 10),
      endDate: booking.endDate.toISOString().slice(0, 10),
      dueAt: booking.dueAt ? booking.dueAt.toISOString().replace('T', ' ').slice(0, 16) : '—',
      subtotal: formatMoney(booking.subtotalMinor, booking.currency),
      deliveryFee: formatMoney(booking.deliveryFeeMinor, booking.currency),
      deposit: formatMoney(booking.securityDepositMinor, booking.currency),
      tax: formatMoney(booking.taxMinor, booking.currency),
      total: formatMoney(booking.totalMinor, booking.currency),
      signerName: booking.customer.name,
      issuedAt: new Date().toISOString().slice(0, 10),
    });

    const { documentKey, contentHash } = await this.freeze(
      body,
      `bookings/${booking.reference}/agreements`,
    );

    return this.prisma.agreement.create({
      data: {
        kind,
        templateId: template.id,
        version: template.version,
        bookingId,
        counterpartyId: booking.customer.id,
        status: AgreementStatus.AWAITING_UPLOAD,
        sentAt: new Date(),
        documentKey,
        contentHash,
      },
    });
  }

  /**
   * Issues the Eskista ↔ Talent agreement for one engagement.
   *
   * The talent contracts with Eskista, never with the client, so the text names the project
   * and what the talent is paid — not who the client is. Issued when the talent is hired,
   * alongside the customer's own agreement for the same booking. Idempotent.
   */
  async issueTalentService(bookingId: string): Promise<Agreement> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        talentProfile: { select: { displayName: true, userId: true } },
        talentDetail: true,
      },
    });
    if (!booking?.talentProfile) throw new NotFoundException('Engagement not found');

    const kind = AgreementType.TALENT_SERVICE;
    const existing = await this.prisma.agreement.findFirst({ where: { bookingId, kind } });
    if (existing) return existing;

    const template = await this.resolveTemplate(kind, null);

    const body = this.interpolate(template.bodyMarkdown, {
      reference: booking.reference,
      talentName: booking.talentProfile.displayName,
      projectType: booking.projectType?.replace(/_/g, ' ').toLowerCase() ?? 'project',
      projectDescription: booking.projectDescription ?? '—',
      eventLocation: booking.talentDetail?.eventLocation || booking.talentDetail?.city || '—',
      startDate: booking.startDate.toISOString().slice(0, 10),
      endDate: booking.endDate.toISOString().slice(0, 10),
      startTime: booking.talentDetail?.startTime ?? '—',
      endTime: booking.talentDetail?.endTime ?? '—',
      earnings: formatMoney(booking.supplierEarningsMinor, booking.currency),
      signerName: booking.talentProfile.displayName,
      issuedAt: new Date().toISOString().slice(0, 10),
    });

    const { documentKey, contentHash } = await this.freeze(
      body,
      `bookings/${booking.reference}/agreements`,
    );

    return this.prisma.agreement.create({
      data: {
        kind,
        templateId: template.id,
        version: template.version,
        // Tied to the booking, not the profile: a talent signs one per engagement, and the
        // profile-level unique constraint allows only one of each kind.
        bookingId,
        counterpartyId: booking.talentProfile.userId,
        status: AgreementStatus.AWAITING_UPLOAD,
        sentAt: new Date(),
        documentKey,
        contentHash,
      },
    });
  }

  /**
   * Accepts the counterparty's scan of the hand-signed contract.
   *
   * Moves the agreement to UNDER_REVIEW rather than straight to APPROVED: a scan is a
   * claim that the document was signed, and only Eskista can confirm it is the right
   * document, legible, and actually signed.
   *
   * Re-uploading over a rejected scan is allowed and expected — that is how a customer
   * fixes a blurred photo. Re-uploading over an approved one is not.
   */
  async uploadSignedCopy(
    agreementId: string,
    userId: string,
    input: UploadSignedCopyInput,
  ): Promise<Agreement> {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found');

    if (agreement.counterpartyId !== userId) {
      // 404 rather than 403 — do not confirm the id exists to someone not party to it.
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.status === AgreementStatus.APPROVED) {
      throw new ConflictException('This agreement has already been approved');
    }
    if (agreement.status === AgreementStatus.UNDER_REVIEW) {
      throw new ConflictException('Your uploaded copy is already being reviewed');
    }
    if (agreement.status === AgreementStatus.VOID) {
      throw new ConflictException('This agreement has been voided');
    }
    if (!agreement.contentHash) {
      throw new BadRequestException('This agreement has no frozen content and cannot be signed');
    }

    return this.prisma.agreement.update({
      where: { id: agreementId },
      data: {
        status: AgreementStatus.UNDER_REVIEW,
        scannedCopyKey: input.fileKey,
        scannedCopyName: input.fileName,
        scannedCopyMimeType: input.mimeType,
        scannedCopySizeBytes: input.sizeBytes,
        uploadedAt: new Date(),
        uploadedById: userId,
        signerName: input.signerName,
        signerPhone: input.signerPhone,
        // A fresh upload clears the previous verdict, so the customer is not shown a stale
        // rejection reason beside a scan they have already replaced.
        rejectionReason: null,
        reviewedAt: null,
        reviewedById: null,
        declinedAt: null,
        declineReason: null,
      },
    });
  }

  async decline(agreementId: string, userId: string, reason: string): Promise<Agreement> {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement || agreement.counterpartyId !== userId) {
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.status === AgreementStatus.APPROVED) {
      throw new ConflictException('An approved agreement cannot be declined');
    }

    return this.prisma.agreement.update({
      where: { id: agreementId },
      data: { status: AgreementStatus.DECLINED, declinedAt: new Date(), declineReason: reason },
    });
  }

  /** The rendered text that was frozen at issue time, for display before signing. */
  async getBody(agreementId: string, userId: string): Promise<string> {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement || agreement.counterpartyId !== userId) {
      throw new NotFoundException('Agreement not found');
    }
    if (!agreement.documentKey) return '';

    try {
      const buffer = await this.storage.read(agreement.documentKey);
      return buffer.toString('utf8');
    } catch (error) {
      // The row promises a frozen document that storage does not have. That is an
      // operational fault worth surfacing as a 404 with a clear cause, not a 500 — and
      // it must never be papered over with empty text, because the signer would then be
      // shown a blank contract.
      this.logger.error(
        `Agreement ${agreement.id} references a missing document: ${agreement.documentKey}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new NotFoundException('The agreement document is unavailable. Contact support.');
    }
  }

  // ── Eskista's review of a scan ─────────────────────────────────────────────

  /**
   * Eskista accepts the uploaded scan: the right document, legible, signed. The agreement
   * is then in force. Only a scan under review can be approved.
   */
  async approveScan(agreementId: string, adminId: string): Promise<Agreement> {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (agreement.status === AgreementStatus.APPROVED) return agreement;
    if (agreement.status !== AgreementStatus.UNDER_REVIEW || !agreement.scannedCopyKey) {
      throw new ConflictException('There is no uploaded scan waiting for review');
    }
    return this.prisma.agreement.update({
      where: { id: agreementId },
      data: {
        status: AgreementStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedById: adminId,
        rejectionReason: null,
      },
    });
  }

  /** Eskista rejects the scan — wrong document, unsigned, illegible. The signer re-uploads. */
  async rejectScan(agreementId: string, adminId: string, reason: string): Promise<Agreement> {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (agreement.status !== AgreementStatus.UNDER_REVIEW) {
      throw new ConflictException('There is no uploaded scan waiting for review');
    }
    return this.prisma.agreement.update({
      where: { id: agreementId },
      data: {
        status: AgreementStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedById: adminId,
        rejectionReason: reason,
      },
    });
  }

  /** Voids an agreement whose booking will not go ahead. Idempotent. */
  async voidForBooking(bookingId: string): Promise<void> {
    await this.prisma.agreement.updateMany({
      where: { bookingId, status: { notIn: [AgreementStatus.APPROVED, AgreementStatus.VOID] } },
      data: { status: AgreementStatus.VOID },
    });
  }

  /** The frozen text for an admin, who is not a party but may read every agreement. */
  async getBodyForAdmin(agreementId: string): Promise<string> {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    return this.getBody(agreementId, agreement.counterpartyId);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Picks the active template, preferring one specific to the vendor kind over a
   * generic one — so a company sees company wording without needing a fallback chain
   * at every call site.
   */
  private async resolveTemplate(kind: AgreementType, vendorKind: VendorKind | null) {
    const where: Prisma.AgreementTemplateWhereInput = {
      kind,
      isActive: true,
      ...(vendorKind ? { OR: [{ vendorKind }, { vendorKind: null }] } : {}),
    };

    const candidates = await this.prisma.agreementTemplate.findMany({
      where,
      orderBy: [{ version: 'desc' }],
    });

    const exact = candidates.find((t) => t.vendorKind === vendorKind);
    const generic = candidates.find((t) => t.vendorKind === null);
    const template = exact ?? generic;

    if (!template) {
      throw new BadRequestException(
        `No active agreement template for ${kind}${vendorKind ? ` (${vendorKind})` : ''}. ` +
          'Seed or publish one before issuing agreements.',
      );
    }
    return template;
  }

  /**
   * Freezes the rendered body to storage and hashes it.
   *
   * Stored as Markdown for now. A PDF renderer can be added later and will hash the same
   * way; nothing already signed is invalidated, because the hash covers the stored bytes
   * rather than a particular format.
   */
  private async freeze(
    body: string,
    folder: string,
  ): Promise<{ documentKey: string; contentHash: string }> {
    const buffer = Buffer.from(body, 'utf8');
    const contentHash = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;

    const stored = await this.storage.put({
      buffer,
      originalName: 'agreement.md',
      mimeType: 'text/markdown',
      folder,
    });

    return { documentKey: stored.key, contentHash };
  }

  /** Replaces `{{token}}` placeholders. Unknown tokens are left visible, not blanked. */
  private interpolate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
      const value = values[key];
      if (value === undefined) {
        this.logger.warn(`Agreement template references unknown placeholder: ${key}`);
        return match;
      }
      return value;
    });
  }
}
