import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerDocumentType, CustomerKind, VerificationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Trims incoming strings without widening their type to `any`. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({
    description:
      'Trading name of the company or agency booking the equipment. Leave unset for an ' +
      'individual — the contact person is then the customer.',
    example: 'Addis Creative Agency',
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  organisationName?: string;

  @ApiPropertyOptional({
    enum: CustomerKind,
    description:
      'Drives which details an invoice must carry. A COMPANY is expected to supply a TIN.',
    example: CustomerKind.COMPANY,
  })
  @IsOptional()
  @IsEnum(CustomerKind)
  kind?: CustomerKind;

  @ApiPropertyOptional({
    description: 'The person Eskista actually calls about this booking.',
    example: 'Selam Tesfaye',
    minLength: 2,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'selam@addiscreative.et', maxLength: 160 })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  @Transform(trim)
  email?: string;

  @ApiPropertyOptional({
    description: 'Primary contact number, in international format.',
    example: '+251911234567',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional({
    description: 'A second reachable number, used when the primary does not answer.',
    example: '+251911765432',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  additionalPhone?: string;

  @ApiPropertyOptional({ example: 'Addis Ababa', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  city?: string;

  @ApiPropertyOptional({
    description: 'Street address, used as the default delivery address on new bookings.',
    example: 'Bole, Addis Ababa',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trim)
  address?: string;
}

export class UploadVerificationDocumentDto {
  @ApiProperty({
    enum: CustomerDocumentType,
    description: 'Which of the three accepted documents is being uploaded.',
    example: CustomerDocumentType.BUSINESS_LICENSE,
  })
  @IsEnum(CustomerDocumentType)
  documentType!: CustomerDocumentType;
}

export class CustomerDocumentResponse {
  @ApiProperty({
    enum: CustomerDocumentType,
    description: 'Which of the three accepted documents this is.',
    example: CustomerDocumentType.BUSINESS_LICENSE,
  })
  documentType!: CustomerDocumentType;

  @ApiProperty({ example: 'business-licence.pdf' })
  fileName!: string;

  @ApiProperty({
    description: 'Authorised download URL. Only this customer and Eskista staff may read it.',
    example: '/api/v1/files/customers/6f1c.../documents/business-licence.pdf',
  })
  url!: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType!: string;

  @ApiProperty({ example: 184320, description: 'Size in bytes.' })
  sizeBytes!: number;

  @ApiProperty({ example: '2026-09-14T09:05:00.000Z' })
  uploadedAt!: string;
}

export class CustomerProfileResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'Addis Creative Agency', nullable: true })
  organisationName!: string | null;

  @ApiProperty({ enum: CustomerKind, example: CustomerKind.COMPANY })
  kind!: CustomerKind;

  @ApiProperty({ example: 'Selam Tesfaye' })
  contactPerson!: string;

  @ApiPropertyOptional({ example: 'selam@addiscreative.et', nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ example: '+251911234567', nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ example: '+251911765432', nullable: true })
  additionalPhone!: string | null;

  @ApiPropertyOptional({ example: 'Addis Ababa', nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ example: 'Bole, Addis Ababa', nullable: true })
  address!: string | null;

  @ApiProperty({
    enum: VerificationStatus,
    description:
      'Admin-controlled. A customer can upload a document but can never verify ' +
      'themselves, so this only ever changes through Eskista review. Render the ' +
      '“Verified customer” badge when it is `VERIFIED`.\n\n' +
      '**This is a badge, not a gate.** Unverified customers place bookings exactly like ' +
      'verified ones; never use it to disable an action.',
    example: VerificationStatus.VERIFIED,
  })
  verificationStatus!: VerificationStatus;

  @ApiPropertyOptional({
    description: 'Why the last verification attempt was rejected, if it was.',
    example: 'The uploaded licence was too blurred to read.',
    nullable: true,
  })
  rejectionReason!: string | null;

  @ApiPropertyOptional({
    type: CustomerDocumentResponse,
    nullable: true,
    description:
      'The business document behind the "Verified customer" badge. Null until one is ' +
      'uploaded — which is entirely optional.',
  })
  document!: CustomerDocumentResponse | null;

  @ApiProperty({
    description:
      'True once every field a booking request needs is present. The client can use this ' +
      'to skip the “Customer & Contact” step and go straight to project details. ' +
      'Verification is **not** part of this: an unverified individual can book freely.',
    example: true,
  })
  isBookingReady!: boolean;

  @ApiProperty({
    description:
      'Field names still missing before a booking can be submitted. Empty when ' +
      '`isBookingReady` is true. Never includes documents — those are optional.',
    example: ['phone'],
    type: [String],
  })
  outstandingRequirements!: string[];

  @ApiProperty({ example: '2026-08-02T11:20:00.000Z' })
  createdAt!: string;
}

export class CustomerStatsResponse {
  @ApiProperty({
    description: 'Bookings that reached CLOSED. Drafts and cancellations never count.',
    example: 12,
  })
  bookings!: number;

  @ApiProperty({
    description: 'Distinct vendors this customer has completed a booking with.',
    example: 3,
  })
  vendors!: number;
}
