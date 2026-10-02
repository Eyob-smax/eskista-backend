import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, BookingType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQuery } from '../../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The sidebar's tables: Booking Requests, Active Rentals, Deliveries & Pickups — and every
 * finished booking for search.
 */
export const BOOKING_VIEWS = ['requests', 'active', 'deliveries', 'completed', 'all'] as const;
export type BookingView = (typeof BOOKING_VIEWS)[number];

export class AdminBookingsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: BOOKING_VIEWS, default: 'all' })
  @IsOptional()
  @IsIn(BOOKING_VIEWS)
  view?: BookingView;

  @ApiPropertyOptional({ enum: BookingType })
  @IsOptional()
  @IsEnum(BookingType)
  type?: BookingType;

  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: 'ESK-10484',
    description: 'Reference, customer, organisation, equipment, vendor, talent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Rentals starting on or after.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Rentals starting on or before.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: '5b0c2f9e-6a1d-4c1e-9f0a-2d3e4f5a6b7c' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ example: '7c1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: '9d2f4b6a-1c3e-4a5b-8c7d-6e5f4a3b2c1d' })
  @IsOptional()
  @IsUUID()
  talentProfileId?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'startDate', 'amount'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'startDate', 'amount'])
  sortBy?: 'createdAt' | 'startDate' | 'amount';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class PartyResponse {
  @ApiProperty({ example: '7c1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b' }) id!: string;
  @ApiProperty({ example: 'Yoseph Alemu' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Habesha Films' }) organisation!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'yoseph@habeshafilms.et' }) email!: string | null;
}

export class LegResponse {
  @ApiProperty({ enum: ['OUTBOUND', 'RETURN'] }) direction!: 'OUTBOUND' | 'RETURN';
  @ApiProperty({ example: 'DELIVERY' }) method!: string;
  @ApiProperty({ example: 'Courier Dispatch' }) methodLabel!: string;
  @ApiProperty({ example: 'OUT_FOR_DELIVERY' }) stage!: string;
  @ApiProperty({ example: 'Out for Delivery' }) stageLabel!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Bole, near Edna Mall, Addis Ababa' }) address!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-02T09:00:00.000Z' }) scheduledAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-02T10:30:00.000Z' }) etaAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Abebe K.' }) courierName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911556677' }) courierPhone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Motorbike (AA 3-1024)' }) vehicle!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-02T09:15:00.000Z' }) dispatchedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-02T10:25:00.000Z' }) completedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Ring the doorbell; second floor' }) notes!:
    string | null;
}

export class AdminBookingRowResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ enum: BookingType }) type!: BookingType;
  @ApiProperty({ type: PartyResponse }) customer!: PartyResponse;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) itemName!: string;
  @ApiPropertyOptional({ nullable: true, example: null }) itemImageUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Afro Studio' }) supplierName!: string | null;
  @ApiProperty({ example: '2026-10-02' }) startDate!: string;
  @ApiProperty({ example: '2026-10-04' }) endDate!: string;
  @ApiProperty({ example: 3 }) periods!: number;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ example: 'Awaiting Payment' }) statusLabel!: string;
  @ApiProperty({ example: 'Receipt Uploaded', description: 'The Payment column.' })
  paymentState!: string;
  @ApiProperty({
    example: 1585000,
    description: 'What the customer transfers: total plus deposit.',
  })
  amountMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ example: 'ACCEPTED' }) supplierResponse!: string;
  @ApiProperty({ type: [String], example: ['FX3-002'] }) units!: string[];
  @ApiPropertyOptional({ type: LegResponse, nullable: true }) delivery!: LegResponse | null;
  @ApiPropertyOptional({ type: LegResponse, nullable: true }) return!: LegResponse | null;
  @ApiProperty({ example: 'Start Packing Gear', nullable: true, description: 'The row button.' })
  nextAction!: string | null;
  @ApiProperty({ example: '2026-09-25T14:30:00.000Z' }) createdAt!: string;
}
