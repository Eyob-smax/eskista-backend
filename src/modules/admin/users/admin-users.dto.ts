import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerKind, VerificationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminVendorsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: VerificationStatus })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({ description: 'Business, representative, phone or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ example: 'Addis Ababa' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  location?: string;
}

export class AdminCustomersQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Name, organisation, phone or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ enum: VerificationStatus, description: 'The Verified customer badge.' })
  @IsOptional()
  @IsEnum(VerificationStatus)
  verification?: VerificationStatus;

  @ApiPropertyOptional({ enum: CustomerKind })
  @IsOptional()
  @IsEnum(CustomerKind)
  kind?: CustomerKind;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}

export class VerifyVendorDto {
  @ApiPropertyOptional({
    description: "The vendor's commission, in basis points. Omit to keep the default.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  commissionRateBps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class AccountReasonDto {
  @ApiProperty({ example: 'Documents do not match the business name.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}
