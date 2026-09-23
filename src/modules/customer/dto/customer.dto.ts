import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerKind, VerificationStatus } from '@prisma/client';
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

export class CustomerIdDocumentResponse {
  @ApiProperty({ example: 'selam-fayda.jpg' })
  fileName!: string;

  @ApiProperty({
    description: 'Authorised download URL. Only this customer and Eskista staff may read it.',
    example: '/api/v1/files/customers/6f1c.../id-document/selam-fayda.jpg',
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
      'Admin-controlled. A customer can upload an ID but can never verify themselves, so ' +
      'this only ever changes through Eskista review. Render the “Verified customer” ' +
      'badge when it is `VERIFIED`.',
    example: VerificationStatus.VERIFIED,
  })
  verificationStatus!: VerificationStatus;

  @ApiPropertyOptional({
    description: 'Why the last verification attempt was rejected, if it was.',
    example: 'The uploaded ID was too blurred to read.',
    nullable: true,
  })
  rejectionReason!: string | null;

  @ApiPropertyOptional({ type: CustomerIdDocumentResponse, nullable: true })
  idDocument!: CustomerIdDocumentResponse | null;

  @ApiProperty({
    description:
      'True once every field a booking request needs is present. The client can use this ' +
      'to skip the “Customer & Contact” step and go straight to project details.',
    example: true,
  })
  isBookingReady!: boolean;

  @ApiProperty({
    description:
      'Field names still missing before a booking can be submitted. Empty when ' +
      '`isBookingReady` is true.',
    example: ['idDocument'],
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
    description:
      'Average rating this customer has received from vendors, to one decimal place. ' +
      '`null` until at least one rating exists — render a dash, not a zero.',
    example: 4.9,
    nullable: true,
  })
  rating!: number | null;

  @ApiProperty({ description: 'How many ratings the average is drawn from.', example: 7 })
  ratingCount!: number;

  @ApiProperty({
    description: 'Distinct vendors this customer has completed a booking with.',
    example: 3,
  })
  vendors!: number;
}
