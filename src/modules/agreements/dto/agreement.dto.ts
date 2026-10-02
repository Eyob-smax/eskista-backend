import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgreementStatus, AgreementType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class UploadSignedAgreementDto {
  @ApiProperty({
    description: 'Full name of whoever physically signed the printed contract, recorded verbatim.',
    example: 'Shebelaw Bogale',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @trim()
  signerName!: string;

  @ApiPropertyOptional({ example: '+251911234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @trim()
  signerPhone?: string;
}

export class DeclineAgreementDto {
  @ApiProperty({ description: 'Why the counterparty declined. Recorded for audit.' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @trim()
  reason!: string;
}

export class AgreementResponse {
  @ApiProperty({ format: 'uuid', example: '9a8b7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4' }) id!: string;
  @ApiProperty({ enum: AgreementType, example: AgreementType.VENDOR_ONBOARDING }) kind!: AgreementType;
  @ApiProperty({ enum: AgreementStatus, example: AgreementStatus.APPROVED }) status!: AgreementStatus;
  @ApiProperty({ example: 1, description: 'Template version this agreement was rendered from.' })
  version!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'SHA-256 of the exact bytes presented for signature.',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  contentHash!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'The blank contract to download, print and sign.',
    example: 'https://res.cloudinary.com/eskista/raw/upload/agreements/contract.pdf',
  })
  documentUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-10T11:00:00.000Z' }) sentAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the counterparty uploaded their scanned, hand-signed copy.',
    example: '2026-08-11T14:30:00.000Z',
  })
  uploadedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'When Eskista reviewed that scan.', example: '2026-08-12T09:00:00.000Z' })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Authorised download URL for the uploaded scan, once one exists.',
    example: 'https://res.cloudinary.com/eskista/raw/upload/agreements/signed.pdf',
  })
  signedCopyUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why Eskista rejected the scan. Safe to show the counterparty verbatim.',
    example: 'The signature page was missing.',
  })
  rejectionReason!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Abebe Kebede' }) signerName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) declinedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, example: null }) declineReason!: string | null;
  @ApiProperty({ example: '2026-08-10T11:00:00.000Z' }) createdAt!: Date;
}

export class AgreementBodyResponse extends AgreementResponse {
  @ApiProperty({
    example: 'THIS AGREEMENT is entered into between Eskista Marketplace and the Vendor...',
    description:
      'The rendered agreement text, exactly as frozen at issue time. Render this for ' +
      'the signer — do not re-render from the template, or the hash will not match.',
  })
  body!: string;
}
