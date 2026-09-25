import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType } from '@nestjs/swagger';
import {
  ConditionGrade,
  IncludedItemKind,
  ListingStatus,
  RentalPeriodUnit,
  UnitStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery, SearchQuery, SortQuery } from '../../../common/dto/pagination.dto';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

// ── Nested pieces ────────────────────────────────────────────────────────────

export class SpecItemDto {
  @ApiPropertyOptional({ description: 'Section heading, e.g. "Sensor".' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @trim()
  group?: string;

  @ApiProperty({ example: 'Resolution' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @trim()
  label!: string;

  @ApiProperty({ example: '6K 6048 x 4032' })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  @trim()
  value!: string;
}

export class IncludedItemDto {
  @ApiProperty({
    enum: IncludedItemKind,
    description: 'EQUIPMENT for core items, ACCESSORY for extras — the client’s two lists.',
  })
  @IsEnum(IncludedItemKind)
  kind!: IncludedItemKind;

  @ApiProperty({ example: 'NP-FZ100 Battery' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @trim()
  name!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity?: number;
}

// ── Create / update ──────────────────────────────────────────────────────────

/** Basic Info → Technical Info → Condition → Rental Info, per the client's structure. */
export class CreateEquipmentDto {
  // Basic information
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  @trim()
  name!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ example: 'Sony' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @trim()
  brand?: string;

  @ApiPropertyOptional({ example: 'FX3' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @trim()
  model?: string;

  // Key technical information
  @ApiPropertyOptional({
    description: 'The single headline spec shown above the fold.',
    example: 'Full-frame 10.2MP CMOS, 4K120 10-bit',
  })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @trim()
  mainSpecification?: string;

  @ApiPropertyOptional({ type: [String], example: ['E-mount', 'EF via adapter'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  compatibility?: string[];

  @ApiPropertyOptional({ example: '2x NP-FZ100, USB-C PD input' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @trim()
  powerBattery?: string;

  @ApiPropertyOptional({ type: [SpecItemDto], description: 'Secondary specifications table.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecItemDto)
  @ArrayMaxSize(60)
  specs?: SpecItemDto[];

  // Condition
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    example: 9,
    description:
      'The ten-star **Condition** picker (required to submit). Sets `condition` too: ' +
      '10 New · 9 Like new · 7–8 Excellent · 5–6 Good · 1–4 Fair.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  conditionRating?: number;

  @ApiPropertyOptional({
    enum: ConditionGrade,
    default: ConditionGrade.EXCELLENT,
    description: 'Only when not sending `conditionRating`, which derives it.',
  })
  @IsOptional()
  @IsEnum(ConditionGrade)
  condition?: ConditionGrade;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @trim()
  conditionNotes?: string;

  // What's included
  @ApiPropertyOptional({ type: [IncludedItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncludedItemDto)
  @ArrayMaxSize(60)
  includedItems?: IncludedItemDto[];

  // Rental information
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  @trim()
  description!: string;

  @ApiProperty({ example: 'Addis Ababa' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @trim()
  location!: string;

  @ApiProperty({ description: 'Price per period, in minor units (ETB cents).', example: 320_000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rentalPriceMinor!: number;

  @ApiPropertyOptional({ enum: RentalPeriodUnit, default: RentalPeriodUnit.DAY })
  @IsOptional()
  @IsEnum(RentalPeriodUnit)
  rentalPeriodUnit?: RentalPeriodUnit;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minRentalPeriods?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRentalPeriods?: number;

  @ApiPropertyOptional({ description: 'Refundable security deposit, in minor units.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  securityDepositMinor?: number;

  @ApiPropertyOptional({ description: 'Full replacement value, used for damage assessment.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  replacementValueMinor?: number;

  @ApiPropertyOptional({ example: 'Valid ID, refundable deposit' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @trim()
  rentalRequirements?: string;
}

/**
 * Every field optional. Uses PartialType rather than re-declaring fields, because
 * `declare` would only change the Swagger decorator and leave the TypeScript type
 * required — so a partial update would still fail to compile at the call site.
 */
export class UpdateEquipmentDto extends PartialType(CreateEquipmentDto) {}

export class ReplaceSpecsDto {
  @ApiProperty({ type: [SpecItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecItemDto)
  @ArrayMaxSize(60)
  specs!: SpecItemDto[];
}

export class ReplaceIncludedItemsDto {
  @ApiProperty({ type: [IncludedItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncludedItemDto)
  @ArrayMaxSize(60)
  items!: IncludedItemDto[];
}

export class ReplaceAccessoriesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Other listings of mine to show as "Related Accessories".',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(20)
  listingIds!: string[];
}

export class UpdateImageDto {
  @ApiPropertyOptional({ description: 'Make this the main image. Demotes the previous one.' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @trim()
  altText?: string;
}

// ── Units ────────────────────────────────────────────────────────────────────

export class CreateUnitDto {
  @ApiPropertyOptional({ example: 'Body #2' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @trim()
  label?: string;

  @ApiPropertyOptional({ description: 'Unique within the listing when provided.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @trim()
  serialNumber?: string;

  @ApiPropertyOptional({ enum: ConditionGrade })
  @IsOptional()
  @IsEnum(ConditionGrade)
  condition?: ConditionGrade;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @trim()
  conditionNotes?: string;
}

export class UpdateUnitDto extends CreateUnitDto {
  @ApiPropertyOptional({
    enum: UnitStatus,
    description: 'RETIRED units keep their booking history but stop being assignable.',
  })
  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;
}

// ── Availability ─────────────────────────────────────────────────────────────

export class BlockDatesDto {
  @ApiProperty({ example: '2026-08-18', description: 'Inclusive, YYYY-MM-DD.' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-08-20', description: 'Inclusive, YYYY-MM-DD.' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Block one unit; omit to block all.' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @trim()
  reason?: string;
}

export class AvailabilityQuery {
  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  to!: string;
}

export class EquipmentListQuery extends IntersectionType(
  PaginationQuery,
  IntersectionType(SortQuery, SearchQuery),
) {
  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

// ── Responses ────────────────────────────────────────────────────────────────

export class EquipmentImageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiPropertyOptional({ nullable: true }) altText!: string | null;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty() sortOrder!: number;
}

export class EquipmentUnitResponse {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) label!: string | null;
  @ApiPropertyOptional({ nullable: true }) serialNumber!: string | null;
  @ApiProperty({ enum: ConditionGrade }) condition!: ConditionGrade;
  @ApiPropertyOptional({ nullable: true }) conditionNotes!: string | null;
  @ApiProperty({ enum: UnitStatus }) status!: UnitStatus;
  @ApiProperty({ description: 'Bookings currently holding this unit.' }) activeBookings!: number;
}

export class EquipmentSummaryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) brand!: string | null;
  @ApiPropertyOptional({ nullable: true }) model!: string | null;
  @ApiProperty() categoryName!: string;
  @ApiPropertyOptional({ nullable: true }) primaryImageUrl!: string | null;
  @ApiProperty({ enum: ListingStatus }) status!: ListingStatus;
  @ApiProperty() rentalPriceMinor!: number;
  @ApiProperty({ enum: RentalPeriodUnit }) rentalPeriodUnit!: RentalPeriodUnit;
  @ApiProperty() currency!: string;
  @ApiProperty() unitCount!: number;
  @ApiProperty() ratingAvg!: number;
  @ApiProperty() ratingCount!: number;
  @ApiProperty() isFeatured!: boolean;
  @ApiProperty({
    description: 'Derived from live bookings — never a stored flag.',
    enum: ['AVAILABLE', 'BOOKED'],
  })
  availabilityLabel!: 'AVAILABLE' | 'BOOKED';
  @ApiPropertyOptional({ nullable: true, description: 'Next return date when booked.' })
  nextDueDate!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class EquipmentDetailResponse extends EquipmentSummaryResponse {
  @ApiProperty() categoryId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() location!: string;
  @ApiPropertyOptional({ nullable: true }) mainSpecification!: string | null;
  @ApiProperty({ type: [String] }) compatibility!: string[];
  @ApiPropertyOptional({ nullable: true }) powerBattery!: string | null;
  @ApiProperty({ enum: ConditionGrade }) condition!: ConditionGrade;
  @ApiPropertyOptional({ nullable: true, description: 'Stars out of ten.', example: 9 })
  conditionRating!: number | null;
  @ApiPropertyOptional({ nullable: true }) conditionNotes!: string | null;
  @ApiProperty() minRentalPeriods!: number;
  @ApiPropertyOptional({ nullable: true }) maxRentalPeriods!: number | null;
  @ApiPropertyOptional({ nullable: true }) securityDepositMinor!: number | null;
  @ApiPropertyOptional({ nullable: true }) replacementValueMinor!: number | null;
  @ApiPropertyOptional({ nullable: true }) rentalRequirements!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) submittedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) publishedAt!: Date | null;

  @ApiProperty({ type: [EquipmentImageResponse] }) images!: EquipmentImageResponse[];
  @ApiProperty({ type: [SpecItemDto] }) specs!: SpecItemDto[];
  @ApiProperty({ type: [IncludedItemDto] }) includedItems!: IncludedItemDto[];
  @ApiProperty({ type: [EquipmentUnitResponse] }) units!: EquipmentUnitResponse[];
  @ApiProperty({ type: [EquipmentSummaryResponse] }) accessories!: EquipmentSummaryResponse[];

  @ApiProperty({ type: [String] }) outstandingRequirements!: string[];
  @ApiProperty() canSubmitForReview!: boolean;

  @ApiProperty({
    description:
      '"Equipment Added → Eskista Review → Published → Available for Booking" on the ' +
      'Equipment Submitted screen.',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        label: { type: 'string' },
        state: { type: 'string', enum: ['DONE', 'IN_PROGRESS', 'PENDING'] },
      },
    },
  })
  reviewSteps!: { key: string; label: string; state: string }[];
}

/** One calendar cell. Mirrors the vendor "Set Availability" legend exactly. */
export class AvailabilityDayResponse {
  @ApiProperty({ example: '2026-08-18' }) date!: string;
  @ApiProperty({
    enum: ['AVAILABLE', 'BLOCKED', 'RESERVED', 'RENTED'],
    description:
      'BLOCKED is vendor-authored and stored. RESERVED (approved, upcoming) and RENTED ' +
      '(in use) are derived from bookings and cannot be set directly.',
  })
  state!: 'AVAILABLE' | 'BLOCKED' | 'RESERVED' | 'RENTED';
  @ApiProperty({ description: 'Units free on this date.' }) unitsAvailable!: number;
  @ApiProperty() unitsTotal!: number;
  @ApiPropertyOptional({ nullable: true }) blockId!: string | null;
}
