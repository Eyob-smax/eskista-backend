import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierDocumentType, VendorKind, VendorType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
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
  @ApiProperty({ example: 'Afro Studio' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  businessName!: string;

  @ApiProperty({ enum: VendorKind, description: 'Individual freelancer or a registered company.' })
  @IsEnum(VendorKind)
  kind!: VendorKind;

  @ApiProperty({ enum: VendorType })
  @IsEnum(VendorType)
  vendorType!: VendorType;

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
      'Fayda ID is always required. Business registration is required when the vendor ' +
      'kind is COMPANY. The signed rental agreement is required for all vendors.',
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

export class VendorProfileResponse {
  @ApiProperty() id!: string;
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

  @ApiProperty({ type: [VendorDocumentResponse] })
  documents!: VendorDocumentResponse[];

  @ApiProperty({
    description: 'What still blocks verification. Empty means the profile is ready to submit.',
    type: [String],
  })
  outstandingRequirements!: string[];

  @ApiProperty({ description: 'Whether the vendor may submit for verification now.' })
  canSubmitForVerification!: boolean;
}

export class VendorDashboardResponse {
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
}
