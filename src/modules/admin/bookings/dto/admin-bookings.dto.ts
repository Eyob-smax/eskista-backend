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
    description: 'Reference, customer, organisation, equipment, vendor, talent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ description: 'Rentals starting on or after.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Rentals starting on or before.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
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
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) organisation!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) email!: string | null;
}

export class LegResponse {
  @ApiProperty({ enum: ['OUTBOUND', 'RETURN'] }) direction!: 'OUTBOUND' | 'RETURN';
  @ApiProperty({ example: 'DELIVERY' }) method!: string;
  @ApiProperty({ example: 'Courier Dispatch' }) methodLabel!: string;
  @ApiProperty({ example: 'OUT_FOR_DELIVERY' }) stage!: string;
  @ApiProperty({ example: 'Out for Delivery' }) stageLabel!: string;
  @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @ApiPropertyOptional({ nullable: true }) scheduledAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) etaAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) courierName!: string | null;
  @ApiPropertyOptional({ nullable: true }) courierPhone!: string | null;
  @ApiPropertyOptional({ nullable: true }) vehicle!: string | null;
  @ApiPropertyOptional({ nullable: true }) dispatchedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) completedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
}

export class AdminBookingRowResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ enum: BookingType }) type!: BookingType;
  @ApiProperty({ type: PartyResponse }) customer!: PartyResponse;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) itemName!: string;
  @ApiPropertyOptional({ nullable: true }) itemImageUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Afro Studio' }) supplierName!: string | null;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty() periods!: number;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ example: 'Awaiting Payment' }) statusLabel!: string;
  @ApiProperty({ example: 'Receipt Uploaded', description: 'The Payment column.' })
  paymentState!: string;
  @ApiProperty({ description: 'What the customer transfers: total plus deposit.' })
  amountMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ example: 'ACCEPTED' }) supplierResponse!: string;
  @ApiProperty({ type: [String], example: ['FX3-002'] }) units!: string[];
  @ApiPropertyOptional({ type: LegResponse, nullable: true }) delivery!: LegResponse | null;
  @ApiPropertyOptional({ type: LegResponse, nullable: true }) return!: LegResponse | null;
  @ApiProperty({ example: 'Start Packing Gear', nullable: true, description: 'The row button.' })
  nextAction!: string | null;
  @ApiProperty() createdAt!: string;
}
