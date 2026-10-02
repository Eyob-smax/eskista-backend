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
    example: VendorKind.COMPANY,
    description:
      'Individual or registered company. Optional: the design asks only for the vendor type, ' +
      'so it is derived from it — `INDIVIDUAL` type is an individual, the rest are companies.',
  })
  @IsOptional()
  @IsEnum(VendorKind)
  kind?: VendorKind;

  @ApiProperty({
    enum: VendorType,
    example: VendorType.RENTAL_COMPANY,
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

  @ApiPropertyOptional({
    example: 'Leading cinema and broadcast equipment rental house based in Addis Ababa.',
    description: 'Short public description of the business.',
  })
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
  @ApiPropertyOptional({ description: 'Full name.', example: 'Shebelaw Bogale' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  contactName?: string;

  @ApiPropertyOptional({ example: 'Afro Studio PLC' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  businessName?: string;

  @ApiPropertyOptional({ enum: VendorKind, example: VendorKind.COMPANY })
  @IsOptional()
  @IsEnum(VendorKind)
  kind?: VendorKind;

  @ApiPropertyOptional({ enum: VendorType, example: VendorType.PRODUCTION_COMPANY })
  @IsOptional()
  @IsEnum(VendorType)
  vendorType?: VendorType;

  @ApiPropertyOptional({ example: 'contact@afrostudio.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  @trim()
  email?: string;

  @ApiPropertyOptional({ example: '+251911234567' })
  @IsOptional()
  @IsPhoneNumber('ET')
  phone?: string;

  @ApiPropertyOptional({ example: 'Bole, Addis Ababa' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  location?: string;

  @ApiPropertyOptional({
    example: 'Premier cinema equipment rental studio in Addis Ababa since 2021.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @trim()
  about?: string;
}

export class UploadVendorDocumentDto {
  @ApiProperty({
    enum: SupplierDocumentType,
    example: SupplierDocumentType.FAYDA_ID,
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
  @ApiProperty({ format: 'uuid', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }) id!: string;
  @ApiProperty({ enum: SupplierDocumentType, example: SupplierDocumentType.FAYDA_ID })
  type!: SupplierDocumentType;
  @ApiProperty({ example: 'fayda-id-front.jpg' }) fileName!: string;
  @ApiProperty({ example: '/api/v1/files/vendors/docs/fayda-id-front.jpg' }) fileUrl!: string;
  @ApiProperty({ example: 'image/jpeg' }) mimeType!: string;
  @ApiProperty({ example: 1048576, description: 'File size in bytes.' }) sizeBytes!: number;
  @ApiProperty({ example: 'PENDING', description: 'PENDING | VERIFIED | REJECTED' })
  status!: string;
  @ApiPropertyOptional({ nullable: true, example: null }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) reviewedAt!: Date | null;
  @ApiProperty({ example: '2026-09-01T12:00:00.000Z' }) createdAt!: Date;
}

export class VendorDocumentGroupResponse {
  @ApiProperty({ type: [VendorDocumentResponse] }) files!: VendorDocumentResponse[];
  @ApiProperty({ description: 'The green tick: every file here is verified.', example: true })
  verified!: boolean;
  @ApiProperty({ example: true }) required!: boolean;
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
  @ApiPropertyOptional({ nullable: true, example: 4.8 }) rating!: number | null;
}

export class VendorProfileResponse {
  @ApiProperty({ format: 'uuid', example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' }) id!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Full name.', example: 'Shebelaw Bogale' })
  contactName!: string | null;
  @ApiProperty({ example: 'Afro Studio' }) businessName!: string;
  @ApiProperty({ enum: VendorKind, example: VendorKind.COMPANY }) kind!: VendorKind;
  @ApiProperty({ enum: VendorType, example: VendorType.PRODUCTION_COMPANY })
  vendorType!: VendorType;
  @ApiProperty({ example: 'ops@afrostudio.com' }) email!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911234567' }) phone!: string | null;
  @ApiProperty({ example: 'Bole, Addis Ababa' }) location!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Specializing in RED and Sony cinema equipment rentals.',
  })
  about!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '/api/v1/files/vendors/logos/afro-logo.png',
  })
  logoUrl!: string | null;
  @ApiProperty({
    description: 'DRAFT | PENDING_REVIEW | VERIFIED | REJECTED | SUSPENDED',
    example: 'VERIFIED',
  })
  status!: string;
  @ApiPropertyOptional({ nullable: true, example: null }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-07-25T14:30:00.000Z' })
  verifiedAt!: Date | null;
  @ApiProperty({ description: 'Average rating across published reviews.', example: 4.9 })
  ratingAvg!: number;
  @ApiProperty({ example: 18 }) ratingCount!: number;
  @ApiProperty({ example: '2026-07-23T10:00:00.000Z' }) createdAt!: Date;
  @ApiProperty({ example: 'Joined Since July 23, 2026' }) joinedLabel!: string;
  @ApiProperty({ description: 'The tick beside the name.', example: true }) isVerified!: boolean;
  @ApiPropertyOptional({ nullable: true, example: '2026-07-23T10:05:00.000Z' })
  termsAcceptedAt!: Date | null;
  @ApiProperty({ type: VendorStatsResponse }) stats!: VendorStatsResponse;

  @ApiProperty({ type: [VendorDocumentResponse] })
  documents!: VendorDocumentResponse[];

  @ApiProperty({ type: VendorVerificationResponse, description: 'Grouped as the profile shows.' })
  verification!: VendorVerificationResponse;

  @ApiProperty({
    description: 'What still blocks verification. Empty means the profile is ready to submit.',
    type: [String],
    example: [],
  })
  outstandingRequirements!: string[];

  @ApiProperty({ description: 'Whether the vendor may submit for verification now.', example: true })
  canSubmitForVerification!: boolean;
}

export class UpcomingRentalResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) productName!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: '/api/v1/files/equipment/images/sony-fx3-main.jpg',
  })
  productImageUrl!: string | null;
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
  @ApiProperty({ description: 'The tick beside the name.', example: true }) isVerified!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    example: '/api/v1/files/vendors/logos/afro-logo.png',
  })
  logoUrl!: string | null;
  @ApiProperty({ example: 2 }) activeRentals!: number;
  @ApiProperty({ example: 14 }) availableEquipment!: number;
  @ApiProperty({ example: 1 }) pendingRequests!: number;
  @ApiProperty({ description: 'Earnings this calendar month, in minor units.', example: 4500000 })
  monthEarningsMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;

  @ApiProperty({
    description: 'The "Needs Your Attention" feed from the vendor home screen.',
    type: 'array',
    example: [
      {
        kind: 'BOOKING_REQUEST',
        count: 1,
        title: 'New Booking Request',
        subtitle: 'ESK-10482 from Habesha Films',
        actionPath: '/vendor/bookings/ESK-10482',
      },
    ],
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
