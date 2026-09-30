import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminBookingRowResponse } from '../bookings/dto/admin-bookings.dto';

export class CountTileResponse {
  @ApiProperty({ example: 12 }) count!: number;
  @ApiPropertyOptional({
    example: 'Quotations sent',
    description: 'The small line under the figure.',
  })
  note?: string;
}

export class PendingRequestsTileResponse {
  @ApiProperty({ example: 12 }) count!: number;
  @ApiProperty({ example: 4, description: '"4 new in last 2 hours".' }) newInLast2Hours!: number;
  @ApiPropertyOptional({
    nullable: true,
    example: 20,
    description:
      'Requests in the last 24h against the 24h before, in percent. Null with nothing to compare.',
  })
  trendPercent!: number | null;
}

export class OverviewTilesResponse {
  @ApiProperty({ type: PendingRequestsTileResponse })
  pendingBookingRequests!: PendingRequestsTileResponse;
  @ApiProperty({ type: CountTileResponse, example: { count: 5, note: 'Quotations sent' } })
  awaitingPaymentConfirmation!: CountTileResponse;
  @ApiProperty({ type: CountTileResponse, example: { count: 3, note: 'Slips uploaded' } })
  paymentsToVerify!: CountTileResponse;
  @ApiProperty({ type: CountTileResponse, example: { count: 8, note: 'Gear out on field' } })
  activeRentals!: CountTileResponse;
}

export class AttentionActionResponse {
  @ApiProperty({ example: 'Verify Payment' }) label!: string;
  @ApiProperty({ example: '/admin/payments/PAY-0042', description: 'Dashboard route to open.' })
  href!: string;
}

export class AttentionItemResponse {
  @ApiProperty({ enum: ['PAYMENT_VERIFICATION', 'BOOKING_APPROVAL'] }) kind!: string;
  @ApiProperty({ example: 'Payment Verification' }) title!: string;
  @ApiProperty({ example: 'Yoseph Alemu uploaded a slip for ESK-10484' }) detail!: string;
  @ApiProperty({ example: 'PAY-0042', description: 'PAY reference or booking reference.' })
  reference!: string;
  @ApiProperty({ example: 'ESK-10484' }) bookingReference!: string;
  @ApiPropertyOptional({ example: 1_850_000 }) amountMinor?: number;
  @ApiProperty({ example: '2026-09-28T07:12:00.000Z' }) at!: string;
  @ApiProperty({ type: AttentionActionResponse }) action!: AttentionActionResponse;
}

export class OverviewQueuesResponse {
  @ApiProperty({ example: 2 }) agreementsToReview!: number;
  @ApiProperty({ example: 1 }) overduePayouts!: number;
  @ApiProperty({ example: 3 }) openIncidents!: number;
  @ApiProperty({ example: 1 }) pendingTalentVerifications!: number;
  @ApiProperty({ example: 0 }) pendingVendorVerifications!: number;
  @ApiProperty({ example: 2 }) pendingListingReviews!: number;
}

/** The sidebar badges. */
export class SidebarBadgesResponse {
  @ApiProperty({ example: 12, description: 'Booking Requests.' }) bookingRequests!: number;
  @ApiProperty({ example: 8, description: 'Active Rentals.' }) activeRentals!: number;
  @ApiProperty({ example: 3, description: 'Deliveries & Pickups.' }) deliveriesAndPickups!: number;
  @ApiProperty({ example: 4, description: 'Hiring Requests awaiting a hire.' })
  hiringRequests!: number;
  @ApiProperty({ example: 3 }) paymentVerification!: number;
  @ApiProperty({ example: 3, description: 'Issues & Disputes.' }) issues!: number;
  @ApiProperty({ example: 2 }) agreements!: number;
  @ApiProperty({ example: 1 }) talentVerification!: number;
  @ApiProperty({ example: 0 }) vendorVerification!: number;
  @ApiProperty({ example: 2 }) listingReview!: number;
}

export class AdminOverviewResponse {
  @ApiProperty({ example: 'Good Morning, Abel' }) greeting!: string;
  @ApiProperty({ type: OverviewTilesResponse }) tiles!: OverviewTilesResponse;
  @ApiProperty({
    type: [AttentionItemResponse],
    description:
      'Payment slips to verify (oldest first), then vendor-accepted requests to approve.',
  })
  attentionRequired!: AttentionItemResponse[];
  @ApiProperty({ type: OverviewQueuesResponse }) queues!: OverviewQueuesResponse;
  @ApiProperty({ type: [AdminBookingRowResponse], description: 'The eight newest bookings.' })
  recentBookings!: AdminBookingRowResponse[];
  @ApiProperty({ type: SidebarBadgesResponse }) badges!: SidebarBadgesResponse;
}
