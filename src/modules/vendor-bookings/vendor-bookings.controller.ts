import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiEndpoint,
  ApiPaginatedResponse,
  ApiStandardErrors,
} from '../../common/dto/api-docs';
import type { Paginated } from '../../common/dto/pagination.dto';
import type { UploadedFile } from '../../common/upload';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  AcceptBookingDto,
  CompletionResponse,
  ConfirmReceiptDto,
  DeclineBookingDto,
  HandoverMethodDto,
  PreparationResponse,
  UpdatePreparationDto,
  VendorBookingDetailResponse,
  VendorBookingListQuery,
  VendorBookingSummaryResponse,
  VendorEarningsQuery,
  VendorEarningsResponse,
  VendorEarningsSummaryResponse,
  VendorInspectionResponse,
  VendorSettlementListQuery,
  VendorSettlementResponse,
  VendorTrackingResponse,
} from './dto/vendor-booking.dto';
import { VendorBookingsService } from './vendor-bookings.service';

const REF = {
  name: 'reference',
  example: 'ESK-10482',
  description: 'The booking reference (e.g. ESK-10482).',
};

const NOT_FOUND_BOOKING = 'Booking not found or does not belong to your account.';

@ApiTags('vendor · bookings')
@ApiBearerAuth()
@Roles('VENDOR')
@Controller({ path: 'vendor', version: '1' })
export class VendorBookingsController {
  constructor(private readonly bookings: VendorBookingsService) {}

  // ── Requests ───────────────────────────────────────────────────────────────

  @Get('bookings')
  @ApiEndpoint({
    summary: 'Booking Requests & Rentals',
    does: 'Filterable list of equipment rentals: pending requests, upcoming preparation, active rentals, and completed bookings.',
    behind: [
      'Read only: queries bookings where the rented item belongs to this vendor.',
      'Filters by tab: pending = REQUEST_SUBMITTED / ESKISTA_REVIEW; upcoming = AWAITING_PAYMENT / BOOKING_CONFIRMED; active = DELIVERY_PICKUP through INSPECTION; completed = SETTLEMENT / CLOSED / REJECTED / CANCELLED.',
      'Masks customer identity: returns customerOrganisation only ("Habesha Films"), never phone or email.',
    ],
    seenBy: ['Vendor app: populates the 4 tabs of the Booking Requests screen.'],
    rules: ['401 if unauthenticated.', '400 if tab parameter is invalid.'],
  })
  @ApiPaginatedResponse(VendorBookingSummaryResponse)
  @ApiStandardErrors({ badRequest: 'Invalid filter or tab parameter.' })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: VendorBookingListQuery,
  ): Promise<Paginated<VendorBookingSummaryResponse>> {
    return this.bookings.list(userId, query);
  }

  @Get('bookings/:reference')
  @ApiEndpoint({
    summary: 'Booking detail',
    does: 'Complete detail for all 10 rental stages: timeline progress, financial breakdown, next steps, preparation checklist, and documents.',
    behind: [
      'Read only: aggregates booking row, equipment units, vendor handover state, inspection logs, agreement, and settlement lines.',
      'Reconciles finances: Gross rental = earnings + Eskista commission.',
      'Calculates active lifecycle buttons and disabled reasons in real time.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if booking reference is not found or does not belong to this vendor.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiStandardErrors({ notFound: NOT_FOUND_BOOKING })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.findOne(userId, reference);
  }

  @Post('bookings/:reference/accept')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Accept Booking Request',
    does: 'Vendor accepts the rental request, committing the gear for the specified dates and advancing the booking toward customer payment.',
    behind: [
      'Records vendor acceptance in VendorHandover table (acceptedByVendor = true, acceptedAt).',
      'Notifies Eskista operations team to issue customer agreement and invoice.',
      'Generates nextStep instructing vendor to prepare equipment before the start date.',
    ],
    seenBy: [
      'Customer Mini App: booking updates to payment prompt.',
      'Admin dashboard: marked as vendor-accepted, ready for admin approval / invoice.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if booking reference not found.',
      '409 if already accepted, declined, or past expiration deadline.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiStandardErrors({
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Booking is no longer open for acceptance or has already been answered.',
  })
  accept(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: AcceptBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.accept(userId, reference, dto);
  }

  @Post('bookings/:reference/decline')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Decline Booking Request',
    does: 'Vendor declines the rental request with an auditable reason for Eskista staff.',
    behind: [
      'Records decline reason in VendorHandover and marks booking as declined by supplier.',
      'Alerts Eskista operations team so they can source an alternative or notify the customer.',
    ],
    seenBy: [
      'Admin dashboard: alerted of decline with vendor note.',
      'Customer app: booking status updates to declined/finding alternative.',
    ],
    rules: [
      '400 if reason is shorter than 5 characters.',
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if booking is no longer open for responses.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Decline reason must be at least 5 characters.',
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Booking has already been answered or is no longer open.',
  })
  decline(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: DeclineBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.decline(userId, reference, dto);
  }

  // ── Prepare Equipment ──────────────────────────────────────────────────────

  @Get('bookings/:reference/preparation')
  @ApiEndpoint({
    summary: 'Get Preparation Checklist',
    does: '7-item preparation checklist, condition rating (1-10), and pre-handover photo documentation.',
    behind: [
      'Read only: generates checklist items for equipment base unit, each included accessory, and standard QA checks (Original accessories, Equipment tested, Equipment cleaned).',
      'Calculates doneCount/totalCount, canMarkReady flag, and blockers list.',
    ],
    rules: ['401 if unauthenticated.', '404 if booking not found.'],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: PreparationResponse })
  @ApiStandardErrors({ notFound: NOT_FOUND_BOOKING })
  getPreparation(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<PreparationResponse> {
    return this.bookings.getPreparation(userId, reference);
  }

  @Put('bookings/:reference/preparation')
  @ApiEndpoint({
    summary: 'Update Preparation Checklist & Condition',
    does: 'Ticks/unticks checklist items and records physical condition rating before handover.',
    behind: [
      'Updates checklist JSON and condition rating in VendorHandover record.',
      'Recalculates preparation completion percentage.',
    ],
    seenBy: ['Vendor app: updates checklist progress counter ("2/7").'],
    rules: [
      '400 if invalid checklist key is supplied.',
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if equipment has already been marked ready.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: PreparationResponse })
  @ApiStandardErrors({
    badRequest: 'An unknown checklist key was provided.',
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Booking not accepted yet, or equipment has already been marked ready.',
  })
  updatePreparation(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: UpdatePreparationDto,
  ): Promise<PreparationResponse> {
    return this.bookings.updatePreparation(userId, reference, dto);
  }

  @Post('bookings/:reference/preparation/photos')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Upload Pre-Handover Condition Photo',
    does: 'Uploads timestamped photo documenting gear condition prior to customer or courier handover.',
    behind: [
      'Validates image file: JPEG, PNG, WebP up to 5 MB.',
      'Stores file under booking directory, links photo to VendorHandover (max 6 photos).',
    ],
    seenBy: ['Admin dashboard: visible for comparison against return QA inspection photos.'],
    rules: [
      '400 if file is not an image or over 5 MB.',
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if 6 photos already uploaded.',
    ],
  })
  @ApiParam(REF)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: PreparationResponse })
  @ApiStandardErrors({
    badRequest: 'File must be an image (JPEG, PNG, WebP) up to 5 MB.',
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Maximum of 6 pre-handover condition photos reached.',
  })
  addPhoto(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<PreparationResponse> {
    return this.bookings.addPreparationPhoto(userId, reference, file);
  }

  @Delete('bookings/:reference/preparation/photos/:photoId')
  @ApiEndpoint({
    summary: 'Remove Condition Photo',
    does: 'Deletes a pre-handover condition photo.',
    behind: ['Deletes image file from storage and removes database link.'],
    rules: [
      '401 if unauthenticated.',
      '404 if photo not found.',
      '409 if equipment already handed over.',
    ],
  })
  @ApiParam(REF)
  @ApiParam({
    name: 'photoId',
    format: 'uuid',
    description: 'The photo ID to delete.',
    example: 'c3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
  })
  @ApiOkResponse({ type: PreparationResponse })
  @ApiStandardErrors({
    notFound: 'Photo not found.',
    conflict: 'Cannot remove photos after equipment has been handed over.',
  })
  removePhoto(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<PreparationResponse> {
    return this.bookings.removePreparationPhoto(userId, reference, photoId);
  }

  @Post('bookings/:reference/preparation/ready')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Mark Equipment as Ready',
    does: 'Declares equipment prepped, tested, and ready for pickup or delivery.',
    behind: [
      'Verifies that all checklist items are ticked and condition rating is provided.',
      'Sets VendorHandover.prepared = true, preparedAt timestamp.',
      'Advances booking operational tracker to Handover stage.',
      'Notifies Eskista courier coordination team.',
    ],
    seenBy: [
      'Vendor app: enables Choose Handover Options / Confirm Handover.',
      'Admin dashboard: booking shows gear ready for dispatch.',
    ],
    rules: [
      '400 with blockers if checklist is incomplete or condition is missing.',
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if booking is not in an approved/confirmed stage.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'All checklist items must be ticked and condition selected.',
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Booking is not at the preparation stage.',
  })
  markReady(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.markReady(userId, reference);
  }

  // ── Handover ───────────────────────────────────────────────────────────────

  @Put('bookings/:reference/handover-method')
  @ApiEndpoint({
    summary: 'Select Handover Collection Method',
    does: 'Chooses DELIVERY (vendor delivers to address) or PICKUP (Eskista courier collects from vendor).',
    behind: [
      'Updates CollectionMethod and delivery address or contact phone in VendorHandover.',
      'Saves courier coordination details.',
    ],
    seenBy: ['Admin dashboard: dispatchers see collection preference.'],
    rules: [
      '400 if required address (for DELIVERY) or phone (for PICKUP) is missing.',
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if already handed over.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Required delivery address or contact phone is missing.',
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Equipment is not marked ready, or has already been handed over.',
  })
  setHandoverMethod(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: HandoverMethodDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.setHandoverMethod(userId, reference, dto);
  }

  @Post('bookings/:reference/handover/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Confirm Equipment Handed Over',
    does: 'Vendor confirms equipment has been handed over to Eskista hub or courier.',
    behind: [
      'Requires booking to be confirmed (client payment verified in escrow).',
      'Sets VendorHandover.handedOverAt timestamp.',
      'Notifies Eskista hub receiving staff.',
    ],
    seenBy: [
      'Customer app: tracking updates to equipment dispatched.',
      'Admin dashboard: active leg moves to transit.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if customer has not paid, gear is not marked ready, or handover method is unset.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: CompletionResponse })
  @ApiStandardErrors({
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Customer has not paid, equipment is not ready, or method is unset.',
  })
  confirmHandover(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<CompletionResponse> {
    return this.bookings.confirmHandover(userId, reference);
  }

  // ── Tracking & return ──────────────────────────────────────────────────────

  @Get('bookings/:reference/tracking')
  @ApiEndpoint({
    summary: 'Track Delivery / Return Leg',
    does: 'Live courier status: outbound leg to customer, or inbound return leg to vendor.',
    behind: [
      'Read only: reads active DeliveryLeg record, courier vehicle, driver phone, status, and ETA.',
    ],
    rules: ['401 if unauthenticated.', '404 if no tracking leg active for this booking.'],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorTrackingResponse })
  @ApiStandardErrors({ notFound: 'No tracking active for this booking.' })
  tracking(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorTrackingResponse> {
    return this.bookings.tracking(userId, reference);
  }

  @Post('bookings/:reference/return/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Confirm Return / Report Discrepancy',
    does: 'Vendor confirms equipment has returned safely, or reports missing/damaged items.',
    behind: [
      'If confirmed: true -> sets returnConfirmedAt. Unlocks settlement verification.',
      'If confirmed: false -> sets returnDisputedAt, opens an incident record with vendor note, and alerts Eskista support.',
    ],
    seenBy: ['Admin dashboard: marks return verified or triggers dispute investigation.'],
    rules: [
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if equipment has not been returned by customer yet, or already confirmed.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: CompletionResponse })
  @ApiStandardErrors({
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Return has not been received by Eskista yet, or was already confirmed.',
  })
  confirmReturn(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ConfirmReceiptDto,
  ): Promise<CompletionResponse> {
    return this.bookings.confirmReturn(userId, reference, dto);
  }

  @Get('bookings/:reference/inspection')
  @ApiEndpoint({
    summary: 'View Return Inspection Results',
    does: 'QA report conducted by Eskista technicians: physical grade, functional testing, missing accessories, damage notes, and deposit deductions.',
    behind: ['Read only: reads Inspection record and photos taken at the Eskista hub.'],
    rules: [
      '401 if unauthenticated.',
      '404 if inspection has not yet been conducted by Eskista.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorInspectionResponse })
  @ApiStandardErrors({ notFound: 'Inspection results not available yet.' })
  inspection(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorInspectionResponse> {
    return this.bookings.inspection(userId, reference);
  }

  // ── Payout & close ─────────────────────────────────────────────────────────

  @Post('bookings/:reference/payout/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Confirm Payout Received',
    does: 'Vendor confirms payment has landed in their Telebirr or bank account.',
    behind: [
      'If confirmed: true -> sets payoutConfirmedAt, schedules auto-close job in 24 hours.',
      'If confirmed: false -> alerts Eskista finance team with vendor dispute note.',
    ],
    seenBy: ['Admin dashboard: finance team sees payment confirmation verified.'],
    rules: [
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 if settlement has not been marked as paid by Eskista, or already confirmed.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: CompletionResponse })
  @ApiStandardErrors({
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Settlement has not been paid out yet, or was already confirmed.',
  })
  confirmPayout(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ConfirmReceiptDto,
  ): Promise<CompletionResponse> {
    return this.bookings.confirmPayout(userId, reference, dto);
  }

  @Post('bookings/:reference/complete')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Complete & Close Booking',
    does: 'Closes a settled booking after payout confirmation, releasing all records and prompting customer review.',
    behind: [
      'Transitions Booking status to CLOSED.',
      'Sends review prompt notification to customer.',
      'Records booking completion in vendor lifetime earnings stats.',
    ],
    seenBy: [
      'Customer app: review prompt appears.',
      'Vendor app: moves booking to Completed tab.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if booking not found.',
      '409 unless return and payout are both confirmed and settled.',
    ],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiStandardErrors({
    notFound: NOT_FOUND_BOOKING,
    conflict: 'Payout must be confirmed and settlement completed before closing.',
  })
  complete(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.complete(userId, reference);
  }

  @Get('bookings/:reference/settlement-record.pdf')
  @ApiEndpoint({
    summary: 'Download Settlement Record (PDF)',
    does: 'Generates official PDF statement of earnings, platform commission breakdown, damage deductions, and bank/Telebirr payout reference.',
    behind: [
      'Generates PDF in-memory using PDFKit, streams with attachment headers.',
    ],
    rules: ['401 if unauthenticated.', '404 if booking has not reached settlement.'],
  })
  @ApiParam(REF)
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiStandardErrors({ notFound: 'Settlement record not generated yet.' })
  async settlementPdf(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.bookings.settlementPdf(userId, reference);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(buffer);
  }

  // ── Earnings ───────────────────────────────────────────────────────────────

  @Get('earnings')
  @ApiTags('vendor · earnings')
  @ApiEndpoint({
    summary: 'Earnings Dashboard',
    does: 'Overview of total lifetime revenue, today’s earnings, upcoming payouts, and itemized booking earnings.',
    behind: [
      'Read only: aggregates settled payout amounts, pending earnings, and filters by tab (overview, upcoming, completed).',
    ],
    rules: ['401 if unauthenticated.'],
  })
  @ApiOkResponse({ type: VendorEarningsResponse })
  @ApiStandardErrors()
  earnings(
    @CurrentUser('id') userId: string,
    @Query() query: VendorEarningsQuery,
  ): Promise<VendorEarningsResponse> {
    return this.bookings.earnings(userId, query);
  }

  @Get('earnings/summary')
  @ApiTags('vendor · earnings')
  @ApiEndpoint({
    summary: 'Earnings Summary KPI Totals',
    does: 'Header statistics: Total Revenue, Today’s Earning, and Upcoming Payouts in minor units.',
    behind: ['Read only: computes lifetime and period aggregates.'],
    rules: ['401 if unauthenticated.'],
  })
  @ApiOkResponse({ type: VendorEarningsSummaryResponse })
  @ApiStandardErrors()
  summary(@CurrentUser('id') userId: string): Promise<VendorEarningsSummaryResponse> {
    return this.bookings.earningsSummary(userId);
  }

  @Get('earnings/settlements')
  @ApiTags('vendor · earnings')
  @ApiEndpoint({
    summary: 'Payout Settlement Lines',
    does: 'Paginated list of settlement payout records with bank/Telebirr batch references and dates.',
    behind: ['Read only: queries Settlement lines for this vendor.'],
    rules: ['401 if unauthenticated.'],
  })
  @ApiPaginatedResponse(VendorSettlementResponse)
  @ApiStandardErrors()
  settlements(
    @CurrentUser('id') userId: string,
    @Query() query: VendorSettlementListQuery,
  ): Promise<Paginated<VendorSettlementResponse>> {
    return this.bookings.listSettlements(userId, query);
  }
}
