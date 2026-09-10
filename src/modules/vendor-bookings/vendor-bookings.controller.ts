import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../../common/dto/pagination.dto';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  AcceptBookingDto,
  DeclineBookingDto,
  VendorBookingDetailResponse,
  VendorBookingListQuery,
  VendorBookingSummaryResponse,
  VendorEarningsSummaryResponse,
  VendorSettlementListQuery,
  VendorSettlementResponse,
} from './dto/vendor-booking.dto';
import { VendorBookingsService } from './vendor-bookings.service';

@ApiTags('vendor · bookings')
@ApiBearerAuth()
@Roles('VENDOR')
@Controller({ path: 'vendor', version: '1' })
export class VendorBookingsController {
  constructor(private readonly bookings: VendorBookingsService) {}

  @Get('bookings')
  @ApiOperation({
    summary: 'List booking requests',
    description:
      'The `tab` parameter maps directly onto the vendor screen tabs: pending, ' +
      'upcoming, active, completed.',
  })
  @ApiOkResponse({ type: [VendorBookingSummaryResponse] })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: VendorBookingListQuery,
  ): Promise<Paginated<VendorBookingSummaryResponse>> {
    return this.bookings.list(userId, query);
  }

  @Get('bookings/:reference')
  @ApiOperation({
    summary: 'Booking detail',
    description:
      'Includes the commission breakdown the vendor screens show, the units Eskista ' +
      'assigned, and the full status timeline.',
  })
  @ApiParam({ name: 'reference', example: 'ESK-10482' })
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.findOne(userId, reference);
  }

  @Post('bookings/:reference/accept')
  @ApiOperation({
    summary: 'Accept a booking request',
    description:
      'Confirms the equipment is available for those dates. This does NOT confirm the ' +
      'booking — Eskista still has to approve, and payment follows approval.',
  })
  @ApiParam({ name: 'reference', example: 'ESK-10482' })
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  accept(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: AcceptBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.accept(userId, reference, dto);
  }

  @Post('bookings/:reference/decline')
  @ApiOperation({
    summary: 'Decline a booking request',
    description:
      'Requires a reason, recorded on the booking and in the status timeline. The ' +
      'request stays with Eskista so the team can offer the customer an alternative.',
  })
  @ApiParam({ name: 'reference', example: 'ESK-10482' })
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  decline(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: DeclineBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.decline(userId, reference, dto);
  }

  @Get('earnings/summary')
  @ApiOperation({
    summary: 'Earnings overview',
    description: 'Total revenue, today, and approved-but-unpaid — the Earnings screen header.',
  })
  @ApiOkResponse({ type: VendorEarningsSummaryResponse })
  earningsSummary(@CurrentUser('id') userId: string): Promise<VendorEarningsSummaryResponse> {
    return this.bookings.earningsSummary(userId);
  }

  @Get('earnings/settlements')
  @ApiOperation({
    summary: 'Settlement lines',
    description:
      'One row per booking with its Paid/Pending chip. `batchReference` is set when the ' +
      'line was rolled into a multi-booking payout.',
  })
  @ApiOkResponse({ type: [VendorSettlementResponse] })
  listSettlements(
    @CurrentUser('id') userId: string,
    @Query() query: VendorSettlementListQuery,
  ): Promise<Paginated<VendorSettlementResponse>> {
    return this.bookings.listSettlements(userId, query);
  }
}
