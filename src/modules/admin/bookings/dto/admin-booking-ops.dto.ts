import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryStage } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ApproveBookingDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['5b0c2f9e-6a1d-4c1e-9f0a-2d3e4f5a6b7c'],
    description: 'Units to assign. When omitted and none is assigned, free units are picked.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  unitIds?: string[];

  @ApiPropertyOptional({
    example: '2026-10-04T14:00:00.000Z',
    description: 'Return deadline. Defaults to 5:00 PM on the last day.',
  })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ example: 'Approved — verified with bank statement.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class ReasonDto {
  @ApiProperty({ example: 'The camera is booked for a studio shoot those days.' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class AssignUnitsDto {
  @ApiProperty({ type: [String], example: ['5b0c2f9e-6a1d-4c1e-9f0a-2d3e4f5a6b7c'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  unitIds!: string[];
}

export class NoteDto {
  @ApiPropertyOptional({ example: 'Arranged for studio pickup at 10am.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

const PHONE = /^\+?[0-9 ()-]{7,20}$/;

/**
 * One leg of the journey — to the customer (delivery) or back to Eskista (return). Sends
 * only what changes; `stage` moves it forward on the four-step tracker.
 */
export class UpdateLegDto {
  @ApiPropertyOptional({
    enum: DeliveryStage,
    description:
      'Delivery: PREPARED "Start Packing Gear" → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED ' +
      '"Handover Complete", which starts the rental. Return: PICKED_UP "Collected" → ' +
      'OUT_FOR_DELIVERY "On the way to Eskista" → DELIVERED "Received by Eskista".',
  })
  @IsOptional()
  @IsIn(Object.values(DeliveryStage))
  stage?: DeliveryStage;

  @ApiPropertyOptional({
    enum: ['SCHEDULED_PICKUP', 'DROP_OFF'],
    description: 'Return only: Eskista collects, or the customer drops it at the hub.',
  })
  @IsOptional()
  @IsIn(['SCHEDULED_PICKUP', 'DROP_OFF'])
  returnMethod?: 'SCHEDULED_PICKUP' | 'DROP_OFF';

  @ApiPropertyOptional({ example: 'Bole, near Edna Mall, Addis Ababa' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  address?: string;
  @ApiPropertyOptional({
    example: '2026-10-02T09:00:00.000Z',
    description: 'When the courier is booked for.',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
  @ApiPropertyOptional({ example: '2026-10-02T10:30:00.000Z', description: '"Estimated arrival".' })
  @IsOptional()
  @IsDateString()
  etaAt?: string;
  @ApiPropertyOptional({ example: 'Abebe K.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  courierName?: string;
  @ApiPropertyOptional({ example: '+251911556677' })
  @IsOptional()
  @Matches(PHONE, { message: 'courierPhone must be a phone number' })
  courierPhone?: string;
  @ApiPropertyOptional({ example: 'Motorbike' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  vehicleDescription?: string;
  @ApiPropertyOptional({ example: 'AA 3-1024' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(trim)
  vehiclePlate?: string;
  @ApiPropertyOptional({ example: 'Call on arrival.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;
}

export class DepositRefundDto {
  @ApiPropertyOptional({
    example: 350000,
    description: 'Minor units sent back. Defaults to what the return inspection released.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountMinor?: number;

  @ApiProperty({ example: 'FT26280ABC123', description: 'The refund transfer reference.' })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Transform(trim)
  reference!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class CancelBookingDto extends ReasonDto {}
