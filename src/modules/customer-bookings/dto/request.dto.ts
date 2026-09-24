import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetBand, CollectionMethod, EngagementModel, ProjectType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ─────────────────────────────────────────────────────────────────────────────
// Equipment request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both steps of the equipment wizard in one body.
 *
 * Every field is optional so a half-finished wizard can be saved as a draft at any point.
 * What a *submission* requires is enforced at submit time, not here — validating the draft
 * as if it were final would make "Save Draft" impossible.
 */
export class UpsertEquipmentRequestDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The listing being booked. Required to submit; may be absent in a draft.',
  })
  @IsOptional()
  @IsUUID()
  listingId?: string;

  @ApiPropertyOptional({ example: '2026-08-18' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-08-21' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Free text — "Commercial shoot for Habesha Beer".',
    example: 'Commercial shoot for Habesha Beer',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  projectDescription?: string;

  @ApiPropertyOptional({
    description: 'Where the shoot happens. Distinct from the delivery address.',
    example: 'Bole, Addis Ababa',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trim)
  productionLocation?: string;

  @ApiPropertyOptional({
    enum: CollectionMethod,
    description: 'PICKUP removes the delivery fee from the total.',
  })
  @IsOptional()
  @IsEnum(CollectionMethod)
  collectionMethod?: CollectionMethod;

  @ApiPropertyOptional({
    description: 'Required when `collectionMethod` is DELIVERY.',
    example: 'Bole, Addis Ababa',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trim)
  deliveryAddress?: string;

  @ApiPropertyOptional({
    description: '"Any special handling, conditions, or requirements…"',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  deliveryNotes?: string;

  @ApiPropertyOptional({
    description: 'Number Eskista should call about this booking.',
    example: '+251911234567',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  contactPhone?: string;

  @ApiPropertyOptional({ example: '+251911765432', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  additionalPhone?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Talent hire request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All five steps of the talent wizard in one body.
 *
 * The design labels three consecutive screens "Step 3 of 5"; the order their content
 * implies is Project → Schedule → Location → References → Budget, then Review. Reference
 * files are uploaded separately, so this body stays JSON rather than multipart.
 */
export class UpsertTalentRequestDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The talent being hired.' })
  @IsOptional()
  @IsUUID()
  talentProfileId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optionally, which of their listed services this is for.',
  })
  @IsOptional()
  @IsUUID()
  talentServiceId?: string;

  // ── Step 1: Project ──
  @ApiPropertyOptional({ enum: ProjectType, description: 'The purpose chips.' })
  @IsOptional()
  @IsEnum(ProjectType)
  projectType?: ProjectType;

  @ApiPropertyOptional({
    description: '"Describe scope, creative vision, and any specific requirements…"',
    example: 'Brand campaign for a major Addis Ababa retail launch — full day shoot.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  projectDescription?: string;

  // ── Step 2: Schedule ──
  @ApiPropertyOptional({ example: '2026-09-22' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-09-22' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;

  @ApiPropertyOptional({
    example: '08:00',
    description: '24-hour clock time. Shown as "08:00 – 18:00 (10 hours)".',
  })
  @IsOptional()
  @Matches(CLOCK_TIME, { message: 'startTime must be HH:mm on a 24-hour clock' })
  startTime?: string;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @Matches(CLOCK_TIME, { message: 'endTime must be HH:mm on a 24-hour clock' })
  endTime?: string;

  @ApiPropertyOptional({
    enum: EngagementModel,
    example: EngagementModel.PER_DAY,
    default: EngagementModel.PER_DAY,
    description:
      'Talent are engaged per day or per project, and nothing else. The Full-Time / ' +
      'Part-Time / On-site / Remote options were removed in the September 2026 review.',
  })
  @IsOptional()
  @IsEnum(EngagementModel)
  engagementModel?: EngagementModel;

  // ── Step 3: Location ──
  @ApiPropertyOptional({ example: 'Addis Ababa', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  city?: string;

  @ApiPropertyOptional({
    example: "Shola Market + client's showroom",
    description: 'Venue or area.',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trim)
  venue?: string;

  @ApiPropertyOptional({
    description:
      '"Parking, access instructions, indoor / outdoor…" Withheld from the talent until ' +
      'the booking is confirmed.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  locationNotes?: string;

  // ── Step 5: Budget ──
  @ApiPropertyOptional({
    enum: BudgetBand,
    description:
      'Optional. One of the five preset bands, recorded for Eskista’s information. ' +
      'Talent rates are fixed, so a budget never prices anything.',
  })
  @IsOptional()
  @IsEnum(BudgetBand)
  budgetBand?: BudgetBand;

  @ApiPropertyOptional({
    example: 1500000,
    description: 'An exact figure in minor units, if the customer gave one.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetMinor?: number;

  @ApiPropertyOptional({ example: '+251911234567', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  contactPhone?: string;

  @ApiPropertyOptional({ example: '+251911765432', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  additionalPhone?: string;

  @ApiPropertyOptional({ description: 'Headcount, if more than one person is needed.', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  headcount?: number;
}

export class DraftResponse {
  @ApiProperty({ format: 'uuid', description: 'Use this to PATCH or submit the draft.' })
  id!: string;

  @ApiProperty({
    example: 'ESK-10482',
    description:
      'Assigned at creation and kept for life, so a draft that becomes a booking keeps ' +
      'the same reference.',
  })
  reference!: string;

  @ApiProperty({ example: 'DRAFT' })
  status!: string;

  @ApiProperty({
    type: [String],
    description: 'What is still missing before this draft can be submitted.',
    example: ['startDate', 'deliveryAddress'],
  })
  outstandingRequirements!: string[];

  @ApiProperty({ example: false })
  canSubmit!: boolean;

  @ApiProperty({ example: '2026-08-14T09:05:00.000Z' })
  updatedAt!: string;
}
