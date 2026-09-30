import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentType, InspectionGrade, InspectionKind, InspectionOutcome } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Multipart fields arrive as strings: "true" / "false". */
const bool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * "Update Manual Outgoing Inspection", "Post-Shoot Return Inspection" and a routine check
 * all send this. Sent as multipart when photos are attached (field `photos`, up to 6).
 */
export class RecordInspectionDto {
  @ApiProperty({ enum: InspectionGrade, example: InspectionGrade.EXCELLENT })
  @IsEnum(InspectionGrade)
  grade!: InspectionGrade;

  @ApiPropertyOptional({ example: 'Sensor clean, all accessories present, battery at 100%.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  notes?: string;

  @ApiPropertyOptional({
    example: 'Dawit (hub technician)',
    description: 'Who did the check, when it was not the admin recording it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  inspectorName?: string;

  @ApiPropertyOptional({ description: 'Which unit, when the booking has more than one.' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  physicalPassed?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  functionalPassed?: boolean;

  // ── Return inspection only ──

  @ApiPropertyOptional({
    enum: InspectionOutcome,
    description: 'Return only. Derived from the grade and missing items when omitted.',
  })
  @IsOptional()
  @IsEnum(InspectionOutcome)
  outcome?: InspectionOutcome;

  @ApiPropertyOptional({ example: '1× lens cap', description: 'Return only.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  missingItems?: string;

  @ApiPropertyOptional({ description: 'Return only: what the damage is.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  damageNotes?: string;

  @ApiPropertyOptional({
    description:
      'Return only: "Damage / replacement deduction", withheld from the deposit, in minor ' +
      'units. At most the deposit held; it is passed on to the vendor in their settlement.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deductionMinor?: number;

  @ApiPropertyOptional({ description: 'Return only: "Report an Issue" — opens an incident.' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  reportIssue?: boolean;

  @ApiPropertyOptional({ enum: IncidentType, default: IncidentType.PHYSICAL_DAMAGE })
  @IsOptional()
  @IsEnum(IncidentType)
  issueType?: IncidentType;

  @ApiPropertyOptional({ description: 'What the incident says; defaults to the damage notes.' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  @Transform(trim)
  issueDescription?: string;
}

export class InspectionsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: InspectionKind })
  @IsOptional()
  @IsEnum(InspectionKind)
  kind?: InspectionKind;

  @ApiPropertyOptional({ enum: InspectionGrade })
  @IsOptional()
  @IsEnum(InspectionGrade)
  grade?: InspectionGrade;

  @ApiPropertyOptional({ description: 'Only Needs Attention and Damaged.' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  flagged?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class InspectionResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: InspectionKind, example: InspectionKind.OUTGOING }) kind!: InspectionKind;
  @ApiProperty({ example: 'Outgoing Check-out' }) kindLabel!: string;
  @ApiPropertyOptional({
    nullable: true,
    enum: InspectionGrade,
    example: InspectionGrade.EXCELLENT,
  })
  grade!: InspectionGrade | null;
  @ApiPropertyOptional({ nullable: true, example: 'Excellent' }) gradeLabel!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'ESK-10485',
    description: 'Null for a routine check.',
  })
  bookingReference!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) unitId!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'FX3-002' }) unitLabel!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'SNY-FX3-2291' }) serialNumber!: string | null;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) equipmentName!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Sensor clean, all accessories present.' })
  notes!: string | null;
  @ApiProperty({ example: 'Dawit (hub technician)' }) inspector!: string;
  @ApiProperty({ example: true }) physicalPassed!: boolean;
  @ApiProperty({ example: true }) functionalPassed!: boolean;
  @ApiPropertyOptional({ nullable: true, enum: InspectionOutcome })
  outcome!: InspectionOutcome | null;
  @ApiPropertyOptional({ nullable: true, example: null }) missingItems!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) damageNotes!: string | null;
  @ApiProperty({ example: 0, description: 'Return only: withheld from the deposit.' })
  deductionMinor!: number;
  @ApiProperty({ example: 0, description: 'Return only: deposit released.' })
  depositReturnedMinor!: number;
  @ApiProperty({
    type: [String],
    example: ['/api/v1/files/bookings/ESK-10485/inspections/outgoing/a1.jpg'],
  })
  photoUrls!: string[];
  @ApiProperty({ example: '2026-09-27T08:30:00.000Z' }) inspectedAt!: string;
  @ApiProperty({
    example: '/api/v1/admin/inspections/2b0d6c1e-…/sheet.pdf',
    description: 'The inspection sheet PDF.',
  })
  sheetUrl!: string;
}
