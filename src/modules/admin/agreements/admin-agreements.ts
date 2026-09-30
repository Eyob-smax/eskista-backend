import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { AdminTier, AgreementStatus, AgreementType, Prisma, type Agreement } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { ApiStandardErrors } from '../../../common/dto/api-docs';
import { AgreementsService } from '../../agreements/agreements.service';
import { renderAgreementPdf } from '../../documents/pdf-renderer';
import { CurrentUser } from '../../auth/auth.decorators';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAccess } from '../core/admin-access';
import { AdminAuditService } from '../core/admin-audit.service';
import { PDF_CONTENT, sendPdf } from '../core/admin-http';
import { humanise } from '../core/admin-format';
import { BookingFlowService } from '../core/booking-flow.service';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminAgreementsQuery {
  @ApiPropertyOptional({ enum: AgreementStatus, default: AgreementStatus.UNDER_REVIEW })
  @IsOptional()
  @IsEnum(AgreementStatus)
  status?: AgreementStatus;

  @ApiPropertyOptional({ enum: AgreementType })
  @IsOptional()
  @IsEnum(AgreementType)
  kind?: AgreementType;
}

export class RejectScanDto {
  @ApiProperty({ example: 'The last page is not signed.' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class AdminAgreementResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AgreementType, example: AgreementType.EQUIPMENT_RENTAL })
  kind!: AgreementType;
  @ApiProperty({ example: 'Equipment Rental' }) kindLabel!: string;
  @ApiProperty({ enum: AgreementStatus, example: AgreementStatus.UNDER_REVIEW })
  status!: AgreementStatus;
  @ApiProperty({ example: 'Under Review' }) statusLabel!: string;
  @ApiProperty({ example: 1 }) version!: number;
  @ApiPropertyOptional({ nullable: true, example: 'ESK-10484' }) bookingReference!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: 'Vendor or talent, for onboarding.',
  })
  supplierName!: string | null;
  @ApiProperty({ example: 'Yoseph Alemu', description: 'Who must sign.' })
  counterpartyName!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Yoseph Alemu' }) signerName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) signerPhone!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '/api/v1/files/bookings/ESK-10484/agreements/rental.md',
    description: 'The generated contract.',
  })
  documentUrl!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '/api/v1/files/bookings/ESK-10484/agreements/signed/scan.pdf',
    description: 'The uploaded, hand-signed scan.',
  })
  signedCopyUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'signed-agreement-scan.pdf' }) signedCopyName!:
    string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '9f2c…e1',
    description: 'SHA-256 of the issued text.',
  })
  contentHash!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-26T10:00:00.000Z' }) sentAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-28T06:00:00.000Z' }) uploadedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) reviewedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) reviewedByName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) declineReason!: string | null;
}

const include = {
  booking: { select: { id: true, reference: true } },
  vendor: { select: { businessName: true } },
  talentProfile: { select: { displayName: true } },
  counterparty: { select: { name: true } },
  reviewedBy: { select: { name: true } },
} satisfies Prisma.AgreementInclude;

type Row = Prisma.AgreementGetPayload<{ include: typeof include }>;

/**
 * Checks the scans counterparties upload: the customer's rental or engagement agreement,
 * the talent's service agreement, a vendor's onboarding agreement. Approving a customer's
 * agreement may be the last thing a paid booking was waiting for.
 */
@Injectable()
export class AdminAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agreements: AgreementsService,
    private readonly flow: BookingFlowService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminAgreementsQuery): Promise<AdminAgreementResponse[]> {
    const rows = await this.prisma.agreement.findMany({
      where: {
        status: query.status ?? AgreementStatus.UNDER_REVIEW,
        ...(query.kind ? { kind: query.kind } : {}),
      },
      include,
      // Oldest upload first: served in the order people sent them.
      orderBy: [{ uploadedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return rows.map((r) => this.toResponse(r));
  }

  async forBooking(bookingId: string): Promise<AdminAgreementResponse[]> {
    const rows = await this.prisma.agreement.findMany({
      where: { bookingId },
      include,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: string): Promise<AdminAgreementDetailResponse> {
    const row = await this.prisma.agreement.findUniqueOrThrow({ where: { id }, include });
    return { ...this.toResponse(row), body: await this.agreements.getBodyForAdmin(id) };
  }

  /** The generated contract as a PDF, rendered from its frozen text. */
  async pdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const a = await this.get(id);
    const buffer = await renderAgreementPdf({
      title: `${a.kindLabel} Agreement`,
      reference: a.bookingReference ?? a.supplierName ?? a.id,
      meta: [
        { label: 'Ref', value: a.bookingReference ?? '—' },
        { label: 'Issued', value: a.sentAt?.slice(0, 10) ?? '—' },
        { label: 'Version', value: String(a.version) },
        { label: 'Governed by', value: 'Ethiopian Law' },
      ],
      body: a.body,
      contentHash: a.contentHash,
      signerName: a.signerName,
      signedAt: a.uploadedAt ? new Date(a.uploadedAt) : null,
    });
    return {
      buffer,
      filename: `${a.bookingReference ?? 'supplier'}-${a.kind.toLowerCase()}-agreement.pdf`,
    };
  }

  async approve(adminId: string, id: string): Promise<AdminAgreementResponse> {
    const updated = await this.agreements.approveScan(id, adminId);
    await this.after(adminId, updated, 'AGREEMENT_APPROVED', {});
    await this.audit.record(adminId, 'agreement.approve', 'Agreement', id);
    if (updated.bookingId) await this.flow.tryConfirm(updated.bookingId, adminId);
    return this.toResponse(
      await this.prisma.agreement.findUniqueOrThrow({ where: { id }, include }),
    );
  }

  async reject(adminId: string, id: string, reason: string): Promise<AdminAgreementResponse> {
    const updated = await this.agreements.rejectScan(id, adminId, reason);
    await this.after(adminId, updated, 'AGREEMENT_REJECTED', { reason });
    await this.audit.record(
      adminId,
      'agreement.reject',
      'Agreement',
      id,
      undefined,
      undefined,
      reason,
    );
    return this.toResponse(
      await this.prisma.agreement.findUniqueOrThrow({ where: { id }, include }),
    );
  }

  private async after(
    adminId: string,
    a: Agreement,
    type: 'AGREEMENT_APPROVED' | 'AGREEMENT_REJECTED',
    values: Record<string, string>,
  ): Promise<void> {
    const booking = a.bookingId
      ? await this.prisma.booking.findUnique({
          where: { id: a.bookingId },
          select: { id: true, reference: true, status: true },
        })
      : null;
    if (booking) {
      await this.flow.note(
        booking.id,
        adminId,
        type === 'AGREEMENT_APPROVED'
          ? `${humanise(a.kind)} agreement approved`
          : `${humanise(a.kind)} agreement scan rejected`,
      );
    }
    await this.notifications.send(
      a.counterpartyId,
      type,
      { reference: booking?.reference ?? 'your supplier agreement', ...values },
      booking ? { bookingReference: booking.reference, agreementId: a.id } : { agreementId: a.id },
    );
  }

  private toResponse(r: Row): AdminAgreementResponse {
    return {
      id: r.id,
      kind: r.kind,
      kindLabel: humanise(r.kind),
      status: r.status,
      statusLabel: humanise(r.status),
      version: r.version,
      bookingReference: r.booking?.reference ?? null,
      supplierName: r.vendor?.businessName ?? r.talentProfile?.displayName ?? null,
      counterpartyName: r.counterparty.name,
      signerName: r.signerName,
      signerPhone: r.signerPhone,
      documentUrl: r.documentKey ? this.storage.urlFor(r.documentKey) : null,
      signedCopyUrl: r.scannedCopyKey ? this.storage.urlFor(r.scannedCopyKey) : null,
      signedCopyName: r.scannedCopyName,
      contentHash: r.contentHash,
      sentAt: r.sentAt?.toISOString() ?? null,
      uploadedAt: r.uploadedAt?.toISOString() ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedByName: r.reviewedBy?.name ?? null,
      rejectionReason: r.rejectionReason,
      declineReason: r.declineReason,
    };
  }
}

export class AdminAgreementDetailResponse extends AdminAgreementResponse {
  @ApiProperty({
    example: '# Equipment Rental Agreement\n\nReference: ESK-10484…',
    description: 'The frozen contract text (light Markdown), exactly as issued.',
  })
  body!: string;
}

const AGREEMENT_ID = { name: 'id', format: 'uuid', description: 'The agreement id.' };

@ApiTags('admin · agreements')
@AdminAccess()
@Controller({ path: 'admin/agreements', version: '1' })
export class AdminAgreementsController {
  constructor(private readonly agreements: AdminAgreementsService) {}

  @Get()
  @ApiOperation({
    summary: 'Signed agreements waiting for review',
    description:
      'Customer, talent and vendor scans. Defaults to UNDER_REVIEW, oldest upload first.',
  })
  @ApiOkResponse({ type: [AdminAgreementResponse] })
  @ApiStandardErrors({ badRequest: 'Unknown `status` or `kind`.' })
  list(@Query() query: AdminAgreementsQuery): Promise<AdminAgreementResponse[]> {
    return this.agreements.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One agreement, with its frozen text' })
  @ApiParam(AGREEMENT_ID)
  @ApiOkResponse({ type: AdminAgreementDetailResponse })
  @ApiStandardErrors({ notFound: 'Agreement not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminAgreementDetailResponse> {
    return this.agreements.get(id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download the generated agreement as a PDF' })
  @ApiParam(AGREEMENT_ID)
  @ApiOkResponse({ description: 'The PDF.', content: PDF_CONTENT })
  @ApiStandardErrors({ notFound: 'Agreement not found' })
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.agreements.pdf(id);
    return sendPdf(res, buffer, filename);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Approve the signed scan',
    description:
      "A customer's agreement being approved confirms the booking if it is already paid in full.",
  })
  @ApiParam(AGREEMENT_ID)
  @ApiOkResponse({ type: AdminAgreementResponse })
  @ApiStandardErrors({
    notFound: 'Agreement not found',
    conflict: 'There is no uploaded scan waiting for review',
  })
  approve(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminAgreementResponse> {
    return this.agreements.approve(adminId, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Reject the scan — the signer is asked to upload again' })
  @ApiParam(AGREEMENT_ID)
  @ApiOkResponse({ type: AdminAgreementResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Agreement not found',
    conflict: 'There is no uploaded scan waiting for review',
  })
  reject(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectScanDto,
  ): Promise<AdminAgreementResponse> {
    return this.agreements.reject(adminId, id, dto.reason);
  }
}
