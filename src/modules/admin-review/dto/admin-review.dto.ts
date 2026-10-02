import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingStatus, VerificationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What the admin sees next to the Approve button: the supplier's proposed price, the
 * commission pre-filled from the default, and exactly what the customer will pay.
 */
export class PricingPreviewResponse {
  @ApiProperty({
    description: 'What the supplier proposed, per period. This is what they will be paid.',
    example: 300000,
  })
  supplierPriceMinor!: number;

  @ApiProperty({
    enum: ['HOUR', 'DAY', 'WEEK', 'MONTH', 'PROJECT'],
    description: 'What one price covers.',
    example: 'DAY',
  })
  periodUnit!: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'PROJECT';

  @ApiProperty({
    description: 'The platform default commission — what the review form is pre-filled with.',
    example: 1500,
  })
  defaultCommissionBps!: number;

  @ApiProperty({
    description:
      'The commission this preview is calculated at: the one passed as `commissionBps`, ' +
      'else any rate already on the item, else the default.',
    example: 1500,
  })
  commissionBps!: number;

  @ApiProperty({
    enum: ['REQUESTED', 'ITEM', 'VENDOR', 'PLATFORM_DEFAULT'],
    description: 'Where `commissionBps` came from, so the form can say "default" or "custom".',
    example: 'PLATFORM_DEFAULT',
  })
  commissionSource!: 'REQUESTED' | 'ITEM' | 'VENDOR' | 'PLATFORM_DEFAULT';

  @ApiProperty({ description: 'Eskista’s commission per period.', example: 45000 })
  commissionMinor!: number;

  @ApiProperty({ description: 'VAT rate added automatically.', example: 1500 })
  vatBps!: number;

  @ApiProperty({ description: 'VAT per period.', example: 51750 })
  vatMinor!: number;

  @ApiProperty({
    description: 'What the customer sees on the card: supplier price + commission + VAT.',
    example: 396750,
  })
  customerPriceMinor!: number;
}

export class DossierDocumentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'FAYDA_ID' }) type!: string;
  @ApiProperty({ example: 'PENDING' }) status!: string;
  @ApiProperty({ example: 'fayda-front.jpg' }) fileName!: string;
  @ApiProperty({ example: '/api/v1/files/dossier/fayda-front.jpg' }) url!: string;
}

export class DossierReferenceResponse {
  @ApiProperty({ example: 'Hana Girma' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911556677' }) contact!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Former employer' }) relationship!: string | null;
}

export class DossierPortfolioResponse {
  @ApiProperty({ example: 'Meskel Square Concert' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Dire Dawa Arts Festival' }) client!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Lead Videographer' }) role!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '/api/v1/files/dossier/portfolio/cover1.jpg' })
  coverUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'https://vimeo.com/example' }) workLink!:
    string | null;
}

export class TalentDossierResponse {
  @ApiPropertyOptional({ nullable: true, example: '/api/v1/files/avatars/talent-42.jpg' })
  avatarUrl!: string | null;
  @ApiProperty({ type: [String], example: ['Videographer', 'Photographer'] })
  professions!: string[];
  @ApiPropertyOptional({
    nullable: true,
    example:
      'Award-winning videographer with 8 years of experience in commercial and event coverage.',
  })
  bio!: string | null;
  @ApiProperty({ example: 'Addis Ababa, Bole' }) location!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251912345678' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'talent@example.com' }) email!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '/talent/dawit-kebede' }) profileUrl!:
    string | null;
  @ApiProperty({
    example: { identity: 'IN_PROGRESS', portfolio: 'QUEUED', references: 'QUEUED' },
  })
  checklist!: { identity: string; portfolio: string; references: string };
  @ApiProperty({ type: [DossierDocumentResponse] }) documents!: DossierDocumentResponse[];
  @ApiProperty({ type: [DossierReferenceResponse] }) references!: DossierReferenceResponse[];
  @ApiProperty({ type: [DossierPortfolioResponse] }) portfolio!: DossierPortfolioResponse[];
}

export class ReviewItemResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Sony FX3 Cinema Camera' })
  name!: string;

  @ApiProperty({
    description: 'Vendor business name for a listing; the talent’s display name for a talent.',
    example: 'Afro Studio',
  })
  supplierName!: string;

  @ApiProperty({ example: 'PENDING_REVIEW' })
  status!: ListingStatus | VerificationStatus;

  @ApiPropertyOptional({ nullable: true, example: '2026-09-24T09:00:00.000Z' })
  submittedAt!: string | null;

  @ApiProperty({
    description: 'False when something stops approval — see `blockers`.',
    example: true,
  })
  canApprove!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Why it cannot be approved yet, in words an admin can act on.',
    example: [],
  })
  blockers!: string[];

  @ApiPropertyOptional({
    type: PricingPreviewResponse,
    nullable: true,
    description: 'Null for a talent who proposed no base rate; see `services` instead.',
  })
  pricing!: PricingPreviewResponse | null;

  @ApiPropertyOptional({
    type: () => [ServicePricingResponse],
    description: 'Talent only: every service they offer, previewed at the same commission.',
  })
  services?: ServicePricingResponse[];

  @ApiPropertyOptional({
    type: () => TalentDossierResponse,
    description:
      'Talent only: what Eskista verifies — the ID, the portfolio and the two references — ' +
      'plus the checklist the talent sees on Pending Verification.',
  })
  dossier?: TalentDossierResponse;
}

export class ServicePricingResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Full Day Commercial' })
  title!: string;

  @ApiProperty({ type: PricingPreviewResponse })
  pricing!: PricingPreviewResponse;
}

export class PreviewQuery {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10000,
    description:
      'Preview at this commission instead — for the live customer price as the admin ' +
      'types. Nothing is saved.',
    example: 2000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  commissionBps?: number;
}

export class ApproveDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10000,
    description:
      'Commission agreed at this review, in basis points (1500 = 15%). Omit to accept the ' +
      'pre-filled figure. It is stored on the item, so a later change to the global default ' +
      'does not move an item that has already been reviewed.',
    example: 1500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  commissionRateBps?: number;

  @ApiPropertyOptional({
    description: 'Listings only: put it on the Featured rail.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({
    description: 'Kept in the audit log.',
    maxLength: 500,
    example: 'Approved after verifying serial number.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class RejectDto {
  @ApiProperty({
    description: 'Shown to the supplier so they can fix it and resubmit.',
    example: 'Photos are too dark to show the condition of the sensor.',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}
