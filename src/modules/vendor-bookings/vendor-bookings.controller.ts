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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
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

const REF = { name: 'reference', example: 'ESK-10482' };

@ApiTags('vendor · bookings')
@ApiBearerAuth()
@Roles('VENDOR')
@Controller({ path: 'vendor', version: '1' })
export class VendorBookingsController {
  constructor(private readonly bookings: VendorBookingsService) {}

  // ── Requests ───────────────────────────────────────────────────────────────

  @Get('bookings')
  @ApiOperation({
    summary: 'Booking Requests',
    description: `
The **Booking Requests** tabs: \`pending\`, \`upcoming\`, \`active\`, \`completed\`.

Each card: product, \`badge\` (Pending, Accepted, Active Rental, In-Progress, Completed…),
dates, Total Days (\`periods\`), Location, Purpose, and **Your earnings**, which is exactly
the price the vendor listed. Eskista adds its commission and VAT on the client's side.

The client appears only as \`customerOrganisation\` ("Habesha Films"). Contact details
are never shared; all communication goes through Eskista.
`.trim(),
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
    description: `
Every vendor booking screen reads this: **Booking Request #ESK-…**, **Rental Accepted**,
**Booking Detail** at each stage, and the completed booking.

- \`money\`: Gross rental, Eskista commission, **Your estimated earnings**, Rented Item
  Quantity, and the client's Estimated total. Gross = earnings + commission, so it always
  reconciles.
- \`timeline\`: the ten steps, from Request Submitted to Rental Closed.
- \`actions\`: the buttons for this stage, with \`primary\` for the filled one.
- \`nextStep\`: "Your next step: Prepare the equipment before Aug 27."
- \`preparation\`, \`handover\`, \`equipmentIdentification\`, \`inspection\`,
  \`equipmentReturn\`, \`payment\`: the accordions on the completed booking.
- \`documents\`: Rental Agreement (the vendor's Eskista agreement), Settlement Record and
  Payment Evidence once they exist.
`.trim(),
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiNotFoundResponse({ description: 'Not one of your bookings.' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.findOne(userId, reference);
  }

  @Post('bookings/:reference/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept Booking',
    description:
      '"By accepting, you confirm that this equipment will be available for the requested ' +
      'rental period." Eskista then coordinates the customer, payment and delivery. The ' +
      'response is the Rental Accepted screen: `nextStep` says to prepare the equipment.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiConflictResponse({ description: 'Already answered, or no longer open.' })
  accept(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: AcceptBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.accept(userId, reference, dto);
  }

  @Post('bookings/:reference/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline Request',
    description: 'The reason goes to Eskista, which may offer the client an alternative.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  decline(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: DeclineBookingDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.decline(userId, reference, dto);
  }

  // ── Prepare Equipment ──────────────────────────────────────────────────────

  @Get('bookings/:reference/preparation')
  @ApiOperation({
    summary: 'Prepare Equipment',
    description: `
The **Preparation checklist** ("2/7"): the equipment itself, each included item, then
Original accessories, Equipment tested, Equipment cleaned. Also the pre-handover condition
photos and the **Equipment condition** choice.

\`canMarkReady\` is true once every item is ticked and a condition is chosen; \`blockers\`
says what is missing. Open from accepting the booking until it is marked ready.
`.trim(),
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: PreparationResponse })
  getPreparation(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<PreparationResponse> {
    return this.bookings.getPreparation(userId, reference);
  }

  @Put('bookings/:reference/preparation')
  @ApiOperation({
    summary: 'Tick checklist items / set condition',
    description: 'Send only the items that changed. Saves immediately.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: PreparationResponse })
  @ApiBadRequestResponse({ description: 'An unknown checklist key.' })
  @ApiConflictResponse({ description: 'Not accepted yet, or already marked ready.' })
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
  @ApiOperation({
    summary: 'Upload a pre-handover condition photo',
    description:
      '"Document the equipment condition for your records." PNG, JPEG or WebP, 5 MB, up to ' +
      'six. Kept under the booking, so Eskista can compare them with the return.',
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
  addPhoto(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<PreparationResponse> {
    return this.bookings.addPreparationPhoto(userId, reference, file);
  }

  @Delete('bookings/:reference/preparation/photos/:photoId')
  @ApiOperation({ summary: 'Remove a condition photo' })
  @ApiParam(REF)
  @ApiParam({ name: 'photoId', format: 'uuid' })
  @ApiOkResponse({ type: PreparationResponse })
  removePhoto(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<PreparationResponse> {
    return this.bookings.removePreparationPhoto(userId, reference, photoId);
  }

  @Post('bookings/:reference/preparation/ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark as Ready',
    description:
      '**400** with `outstandingRequirements` until every item is ticked and a condition ' +
      'is chosen. Moves the tracker to **Handover**.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  markReady(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.markReady(userId, reference);
  }

  // ── Handover ───────────────────────────────────────────────────────────────

  @Put('bookings/:reference/handover-method')
  @ApiOperation({
    summary: 'Select Collection Method',
    description: `
**Choose Handover Options.** \`DELIVERY\`: the vendor brings the equipment to the address,
pre-filled from the booking. \`PICKUP\`: Eskista collects it and calls \`contactPhone\`
("We will use this to confirm your Pickup from Eskista"). Can be changed until handed over.
`.trim(),
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiConflictResponse({ description: 'Not marked ready, or already handed over.' })
  setHandoverMethod(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: HandoverMethodDto,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.setHandoverMethod(userId, reference, dto);
  }

  @Post('bookings/:reference/handover/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm Handover',
    description:
      '"Equipment Handed Over. Handover record submitted. Eskista will confirm receipt and ' +
      'begin the active rental." Allowed once Eskista has confirmed the booking (the client ' +
      'has paid), the equipment is ready and a handover option is chosen.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: CompletionResponse })
  @ApiConflictResponse({ description: 'Not paid yet, not ready, or no option chosen.' })
  confirmHandover(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<CompletionResponse> {
    return this.bookings.confirmHandover(userId, reference);
  }

  // ── Tracking & return ──────────────────────────────────────────────────────

  @Get('bookings/:reference/tracking')
  @ApiOperation({
    summary: 'Track Your Equipment',
    description:
      'The courier leg that is live: out to the client, then back. Courier, vehicle, ETA ' +
      'and the four-step tracker. "Only the admin will be updating this status." ' +
      '`canConfirmReceipt` enables **Confirm Delivery** once the equipment is back.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorTrackingResponse })
  tracking(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorTrackingResponse> {
    return this.bookings.tracking(userId, reference);
  }

  @Post('bookings/:reference/return/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm Delivery / Confirm Return',
    description:
      '`confirmed: true`: the equipment is back with the vendor. `confirmed: false` ' +
      '(**Not-Confirmed**) records a dispute with the vendor’s note for Eskista to follow ' +
      'up. Open once Eskista has the equipment back.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: CompletionResponse })
  @ApiConflictResponse({ description: 'Not returned yet, or already confirmed.' })
  confirmReturn(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ConfirmReceiptDto,
  ): Promise<CompletionResponse> {
    return this.bookings.confirmReturn(userId, reference, dto);
  }

  @Get('bookings/:reference/inspection')
  @ApiOperation({
    summary: 'Inspection Results',
    description:
      '"Inspection results conducted by Eskista": photos, Physical condition, Functional ' +
      'test, Missing accessories, Damage, Inspection result, Overall condition, and the ' +
      'inspector’s declaration. **404** until Eskista has inspected.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorInspectionResponse })
  inspection(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorInspectionResponse> {
    return this.bookings.inspection(userId, reference);
  }

  // ── Payout & close ─────────────────────────────────────────────────────────

  @Post('bookings/:reference/payout/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm Payment',
    description:
      '"Could you please confirm that you’ve received your payment?" `true`: **Payment ' +
      'Received!**, and the booking closes automatically in 24 hours unless completed ' +
      'first. `false` (Not-Confirmed) alerts Eskista. Open once Eskista has paid out.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: CompletionResponse })
  @ApiConflictResponse({ description: 'Not paid out yet, or already confirmed.' })
  confirmPayout(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ConfirmReceiptDto,
  ): Promise<CompletionResponse> {
    return this.bookings.confirmPayout(userId, reference, dto);
  }

  @Post('bookings/:reference/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete the booking',
    description:
      'Closes a settled booking once the vendor has confirmed the payout. The client is ' +
      'then asked for a review.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: VendorBookingDetailResponse })
  @ApiConflictResponse({ description: 'Payout not confirmed, or not settled.' })
  complete(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<VendorBookingDetailResponse> {
    return this.bookings.complete(userId, reference);
  }

  @Get('bookings/:reference/settlement-record.pdf')
  @ApiOperation({
    summary: 'Settlement Record (PDF)',
    description: 'What the vendor was paid for this booking, and any deductions.',
  })
  @ApiParam(REF)
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
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
  @ApiOperation({
    summary: 'Earnings',
    description: `
The **Earnings** screen: Total Revenue, Today's Earning, Upcoming, and the list for the tab.
\`overview\`: everything. \`upcoming\`: earned, not yet paid out. \`completed\`: paid.
Each row: product, "ESK-10482 · Aug 24, 2026" (or "Expected Aug 24"), your earnings,
Paid / Pending.
`.trim(),
  })
  @ApiOkResponse({ type: VendorEarningsResponse })
  earnings(
    @CurrentUser('id') userId: string,
    @Query() query: VendorEarningsQuery,
  ): Promise<VendorEarningsResponse> {
    return this.bookings.earnings(userId, query);
  }

  @Get('earnings/summary')
  @ApiOperation({ summary: 'Earnings totals only' })
  @ApiOkResponse({ type: VendorEarningsSummaryResponse })
  summary(@CurrentUser('id') userId: string): Promise<VendorEarningsSummaryResponse> {
    return this.bookings.earningsSummary(userId);
  }

  @Get('earnings/settlements')
  @ApiOperation({
    summary: 'Settlement lines',
    description: 'The **Settlements** tab: one line per booking, with any batch it was paid in.',
  })
  @ApiOkResponse({ type: [VendorSettlementResponse] })
  settlements(
    @CurrentUser('id') userId: string,
    @Query() query: VendorSettlementListQuery,
  ): Promise<Paginated<VendorSettlementResponse>> {
    return this.bookings.listSettlements(userId, query);
  }
}
