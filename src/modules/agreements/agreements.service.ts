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

export interface SignAgreementInput {
  signerName: string;
  signerPhone?: string;
  ipAddress?: string;
  signatureImageKey?: string;
}

/**
 * Generation and signing of the two contracts the client described:
 *
 *   • Eskista ↔ Supplier — signed once at onboarding. The text differs by vendor kind,
 *     because an individual has no business registration to warrant.
 *   • Eskista ↔ Customer — generated per booking.
 *
 * A signature is only meaningful if you can prove *what* was signed, so the rendered
 * body is frozen to storage and hashed at issue time. `contentHash` covers the exact
 * bytes; re-rendering later from a mutated template cannot change what was agreed.
 *
 * PDF rendering is deliberately not implemented yet — see `renderDocument`. The signed
 * artefact is currently stored as Markdown, which hashes and archives identically; a PDF
 * renderer can be layered on without invalidating anything already signed.
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
        status: AgreementStatus.SENT,
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
        status: AgreementStatus.SENT,
        sentAt: new Date(),
        documentKey,
        contentHash,
      },
    });
  }

  /**
   * Records a signature.
   *
   * Only the counterparty may sign, and only once. The IP address is captured because a
   * signature with no provenance is not worth much in a dispute.
   */
  async sign(agreementId: string, userId: string, input: SignAgreementInput): Promise<Agreement> {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found');

    if (agreement.counterpartyId !== userId) {
      // 404 rather than 403 — do not confirm the id exists to someone not party to it.
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.status === AgreementStatus.SIGNED) {
      throw new ConflictException('This agreement is already signed');
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
        status: AgreementStatus.SIGNED,
        signedAt: new Date(),
        signedById: userId,
        signerName: input.signerName,
        signerPhone: input.signerPhone,
        signerIpAddress: input.ipAddress,
        signatureImageKey: input.signatureImageKey,
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
    if (agreement.status === AgreementStatus.SIGNED) {
      throw new ConflictException('A signed agreement cannot be declined');
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
