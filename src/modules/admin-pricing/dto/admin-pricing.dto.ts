import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class PricingSettingsResponse {
  @ApiProperty({
    description: 'Commission added on top of a supplier’s price when nothing more specific is set.',
    example: 1500,
  })
  defaultCommissionBps!: number;

  @ApiProperty({
    description: 'VAT rate charged, in basis points. 0 when VAT is disabled.',
    example: 1500,
  })
  vatBps!: number;

  @ApiProperty({ description: 'Eskista’s handling fee on the rental, before VAT.', example: 0 })
  serviceFeeBps!: number;

  @ApiProperty({ description: 'Flat delivery charge, before VAT, in minor units.', example: 50000 })
  deliveryFeeMinor!: number;

  @ApiProperty({
    description: 'What a supplier price of ETB 1,000 costs the customer at these settings.',
    example: 132250,
  })
  exampleCustomerPriceFor1000Minor!: number;
}

export class UpdatePricingSettingsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, example: 1500, description: '1500 = 15%.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  defaultCommissionBps?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  serviceFeeBps?: number;

  @ApiPropertyOptional({ minimum: 0, example: 50000, description: 'Minor units, before VAT.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deliveryFeeMinor?: number;

  @ApiPropertyOptional({ description: 'Why — kept in the audit log.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  reason?: string;
}

export class SetCommissionDto {
  @ApiProperty({
    nullable: true,
    minimum: 0,
    maximum: 10000,
    example: 2000,
    description:
      'Commission for this one, in basis points (2000 = 20%). Send `null` to remove the ' +
      'override and fall back to the next level.',
  })
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  commissionRateBps!: number | null;

  @ApiPropertyOptional({ description: 'Why — kept in the audit log.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CommissionResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The override on this record, if any.',
    example: 2000,
  })
  commissionRateBps!: number | null;

  @ApiProperty({
    description: 'The rate that actually applies here now, after falling back.',
    example: 2000,
  })
  effectiveCommissionBps!: number;

  @ApiProperty({
    enum: ['LISTING', 'VENDOR', 'TALENT', 'PLATFORM_DEFAULT'],
    description: 'Which level the effective rate came from.',
    example: 'LISTING',
  })
  source!: 'LISTING' | 'VENDOR' | 'TALENT' | 'PLATFORM_DEFAULT';
}
