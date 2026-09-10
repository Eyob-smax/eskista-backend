import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { BookingStatus, CollectionMethod, SettlementStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery, SortQuery } from '../../../common/dto/pagination.dto';

/** The vendor Bookings screen tabs: Pending · Upcoming · Active · Completed. */
export const BOOKING_TABS = ['pending', 'upcoming', 'active', 'completed', 'all'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

export class VendorBookingListQuery extends IntersectionType(PaginationQuery, SortQuery) {
  @ApiPropertyOptional({ enum: BOOKING_TABS, default: 'all' })
  @IsOptional()
  @IsIn(BOOKING_TABS)
  tab: BookingTab = 'all';
}

export class DeclineBookingDto {
  @ApiProperty({
    description: 'Shown to Eskista, not the customer. Required so declines are auditable.',
    example: 'Camera is in for sensor cleaning that week.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class AcceptBookingDto {
  @ApiPropertyOptional({ description: 'Optional note for the Eskista team.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class VendorBookingSummaryResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ description: 'PENDING | ACCEPTED | DECLINED' }) supplierResponse!: string;
  @ApiProperty() productName!: string;
  @ApiPropertyOptional({ nullable: true }) productImageUrl!: string | null;
  @ApiProperty() customerName!: string;
  @ApiProperty() startDate!: Date;
  @ApiProperty() endDate!: Date;
  @ApiProperty({ description: 'Billable periods — "Total Days" on the vendor card.' })
  periods!: number;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional({ nullable: true, enum: CollectionMethod })
  collectionMethod!: CollectionMethod | null;
  @ApiPropertyOptional({ nullable: true }) location!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'The client’s "Purpose" field.' })
  projectDescription!: string | null;
  @ApiProperty({ description: 'Vendor earnings after commission, in minor units.' })
  earningsMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() createdAt!: Date;
}

export class VendorBookingDetailResponse extends VendorBookingSummaryResponse {
  @ApiProperty({ description: 'Gross rental before commission.' }) grossMinor!: number;
  @ApiProperty() commissionRateBps!: number;
  @ApiProperty() commissionMinor!: number;
  @ApiProperty() securityDepositMinor!: number;
  @ApiProperty() deliveryFeeMinor!: number;
  @ApiProperty({ description: 'What the customer pays.' }) customerTotalMinor!: number;
  @ApiPropertyOptional({ nullable: true }) deliveryAddress!: string | null;
  @ApiPropertyOptional({ nullable: true }) dueAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) supplierDeclineReason!: string | null;

  @ApiProperty({
    description:
      'Units assigned by Eskista. Empty until admin assigns them, which happens after ' +
      'both the vendor and Eskista have approved.',
    type: 'array',
    items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } } },
  })
  assignedUnits!: { id: string; label: string | null; serialNumber: string | null }[];

  @ApiProperty({
    description: 'Full transition history — who moved it, when and why.',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        toStatus: { type: 'string' },
        actorRole: { type: 'string' },
        reason: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  timeline!: {
    fromStatus: string | null;
    toStatus: string;
    actorRole: string | null;
    reason: string | null;
    createdAt: Date;
  }[];
}

export class VendorEarningsSummaryResponse {
  @ApiProperty({ description: 'Lifetime paid earnings, in minor units.' })
  totalRevenueMinor!: number;
  @ApiProperty() todayEarningsMinor!: number;
  @ApiProperty({ description: 'Approved but not yet paid.' }) upcomingMinor!: number;
  @ApiProperty() currency!: string;
}

export class VendorSettlementResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ESK-10482' }) bookingReference!: string;
  @ApiProperty() productName!: string;
  @ApiPropertyOptional({ nullable: true }) productImageUrl!: string | null;
  @ApiProperty() grossMinor!: number;
  @ApiProperty() commissionMinor!: number;
  @ApiProperty({ description: 'Withheld for damage or late return.' }) deductionMinor!: number;
  @ApiProperty() netMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: SettlementStatus }) status!: SettlementStatus;
  @ApiPropertyOptional({ nullable: true }) expectedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Set when this line was rolled into a multi-booking payout.',
  })
  batchReference!: string | null;
}

export class VendorSettlementListQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}
