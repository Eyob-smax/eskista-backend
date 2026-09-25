import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierDocumentType, VendorKind, VendorType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateVendorProfileDto {
  @ApiPropertyOptional({
    description: '"Full name (Check if this is accurate)". Pre-fill it from `GET /me`.',
    example: 'Shebelaw Bogale',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  contactName?: string;

  @ApiProperty({ description: '"Business / Company name".', example: 'Afro Studio' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  businessName!: string;

  @ApiPropertyOptional({
    enum: VendorKind,
    description:
      'Individual or registered company. Optional: the design asks only for the vendor type, ' +
      'so it is derived from it — `INDIVIDUAL` type is an individual, the rest are companies.',
  })
  @IsOptional()
  @IsEnum(VendorKind)
  kind?: VendorKind;

  @ApiProperty({
    enum: VendorType,
    description: 'Individual · Production Company · Rental Company · Creative Studio.',
  })
  @IsEnum(VendorType)
  vendorType!: VendorType;

  @ApiProperty({
    description: '"By using this service, you agree to our terms and conditions." Must be true.',
    example: true,
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the terms and conditions' })
  acceptTerms!: boolean;

  @ApiProperty({ example: 'hello@afrostudio.com' })
  @IsEmail()
  @MaxLength(160)
  @trim()
  email!: string;

  @ApiPropertyOptional({ example: '+251911234567' })
  @IsOptional()
  @IsPhoneNumber('ET')
  phone?: string;

  @ApiProperty({ example: 'Addis Ababa' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  location!: string;

  @ApiPropertyOptional({ description: 'Short public description of the business.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @trim()
  about?: string;

  @ApiPropertyOptional({
    example: '+251911234568',
    description:
      'Second reachable number. Stored on the user, not the vendor, so it is shared ' +
      'across their customer and vendor experiences.',
  })
  @IsOptional()
  @IsPhoneNumber('ET')
  additionalPhone?: string;
}

export class UpdateVendorProfileDto {
  @ApiPropertyOptional({ description: 'Full name.' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  businessName?: string;

  @ApiPropertyOptional({ enum: VendorKind })
  @IsOptional()
  @IsEnum(VendorKind)
  kind?: VendorKind;

  @ApiPropertyOptional({ enum: VendorType })
  @IsOptional()
  @IsEnum(VendorType)
  vendorType?: VendorType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  @trim()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPhoneNumber('ET')
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @trim()
  about?: string;
}

export class UploadVendorDocumentDto {
  @ApiProperty({
    enum: SupplierDocumentType,
    description:
      '"Upload Your ID": `FAYDA_ID` or `PASSPORT`, up to two files (front and back). ' +
      '"Business License": `BUSINESS_LICENSE` (or `BUSINESS_REGISTRATION`), required for ' +
      'companies. Other types replace the previous file of that type.',
  })
  @IsEnum(SupplierDocumentType)
  type!: SupplierDocumentType;
}

// ── Responses ────────────────────────────────────────────────────────────────

export class VendorDocumentResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SupplierDocumentType }) type!: SupplierDocumentType;
  @ApiProperty() fileName!: string;
  @ApiProperty() fileUrl!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) reviewedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class VendorDocumentGroupResponse {
  @ApiProperty({ type: [VendorDocumentResponse] }) files!: VendorDocumentResponse[];
  @ApiProperty({ description: 'The green tick: every file here is verified.' }) verified!: boolean;
  @ApiProperty() required!: boolean;
}

export class VendorVerificationResponse {
  @ApiProperty({ type: VendorDocumentGroupResponse, description: '"ID" — front and back.' })
  id!: VendorDocumentGroupResponse;
  @ApiProperty({ type: VendorDocumentGroupResponse, description: '"Business License".' })
  businessLicense!: VendorDocumentGroupResponse;
}

export class VendorStatsResponse {
  @ApiProperty({ description: 'Completed rentals.', example: 3 }) rentals!: number;
  @ApiProperty({ description: 'Listings, excluding archived.', example: 16 }) equipment!: number;
  @ApiPropertyOptional({ nullable: true, example: 4.4 }) rating!: number | null;
}

export class VendorProfileResponse {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Full name.' })
  contactName!: string | null;
  @ApiProperty() businessName!: string;
  @ApiProperty({ enum: VendorKind }) kind!: VendorKind;
  @ApiProperty({ enum: VendorType }) vendorType!: VendorType;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiProperty() location!: string;
  @ApiPropertyOptional({ nullable: true }) about!: string | null;
  @ApiPropertyOptional({ nullable: true }) logoUrl!: string | null;
  @ApiProperty({ description: 'DRAFT | PENDING_REVIEW | VERIFIED | REJECTED | SUSPENDED' })
  status!: string;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) verifiedAt!: Date | null;
  @ApiProperty({ description: 'Average rating across published reviews.' }) ratingAvg!: number;
  @ApiProperty() ratingCount!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ example: 'Joined Since July 23, 2026' }) joinedLabel!: string;
  @ApiProperty({ description: 'The tick beside the name.' }) isVerified!: boolean;
  @ApiPropertyOptional({ nullable: true }) termsAcceptedAt!: Date | null;
  @ApiProperty({ type: VendorStatsResponse }) stats!: VendorStatsResponse;

  @ApiProperty({ type: [VendorDocumentResponse] })
  documents!: VendorDocumentResponse[];

  @ApiProperty({ type: VendorVerificationResponse, description: 'Grouped as the profile shows.' })
  verification!: VendorVerificationResponse;

  @ApiProperty({
    description: 'What still blocks verification. Empty means the profile is ready to submit.',
    type: [String],
  })
  outstandingRequirements!: string[];

  @ApiProperty({ description: 'Whether the vendor may submit for verification now.' })
  canSubmitForVerification!: boolean;
}

export class UpcomingRentalResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) productName!: string;
  @ApiPropertyOptional({ nullable: true }) productImageUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Habesha Films' })
  customerOrganisation!: string | null;
  @ApiProperty({ example: '2026-08-18' }) startDate!: string;
  @ApiProperty({ example: '2026-08-21' }) endDate!: string;
  @ApiProperty({ example: { label: 'Confirmed', tone: 'SUCCESS' } })
  badge!: { label: string; tone: string };
}

export class VendorDashboardResponse {
  @ApiProperty({ example: 'Good Morning' }) greeting!: string;
  @ApiProperty({ example: 'Afro Studio' }) businessName!: string;
  @ApiProperty({ description: 'The tick beside the name.' }) isVerified!: boolean;
  @ApiPropertyOptional({ nullable: true }) logoUrl!: string | null;
  @ApiProperty() activeRentals!: number;
  @ApiProperty() availableEquipment!: number;
  @ApiProperty() pendingRequests!: number;
  @ApiProperty({ description: 'Earnings this calendar month, in minor units.' })
  monthEarningsMinor!: number;
  @ApiProperty() currency!: string;

  @ApiProperty({
    description: 'The "Needs Your Attention" feed from the vendor home screen.',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        count: { type: 'number' },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        actionPath: { type: 'string' },
      },
    },
  })
  needsAttention!: {
    kind: string;
    count: number;
    title: string;
    subtitle: string;
    actionPath: string;
  }[];

  @ApiProperty({
    type: [UpcomingRentalResponse],
    description: '"Upcoming Rentals" — soonest first.',
  })
  upcomingRentals!: UpcomingRentalResponse[];
}
