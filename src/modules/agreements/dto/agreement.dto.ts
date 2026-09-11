import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgreementStatus, AgreementType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class SignAgreementDto {
  @ApiProperty({
    description: 'Typed full name of the signer, recorded verbatim on the agreement.',
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
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AgreementType }) kind!: AgreementType;
  @ApiProperty({ enum: AgreementStatus }) status!: AgreementStatus;
  @ApiProperty({ description: 'Template version this agreement was rendered from.' })
  version!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'SHA-256 of the exact bytes presented for signature.',
  })
  contentHash!: string | null;
  @ApiPropertyOptional({ nullable: true }) documentUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) sentAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) signedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) signerName!: string | null;
  @ApiPropertyOptional({ nullable: true }) declinedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) declineReason!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class AgreementBodyResponse extends AgreementResponse {
  @ApiProperty({
    description:
      'The rendered agreement text, exactly as frozen at issue time. Render this for ' +
      'the signer — do not re-render from the template, or the hash will not match.',
  })
  body!: string;
}
