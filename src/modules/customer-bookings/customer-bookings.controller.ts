import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/auth.decorators';
import { BookingRequestService } from './booking-request.service';
import { CustomerBookingsService } from './customer-bookings.service';
import {
  BookingCardResponse,
  BookingDetailResponse,
  CancelBookingDto,
  ListBookingsQuery,
} from './dto/booking.dto';
import {
  DraftResponse,
  UpsertEquipmentRequestDto,
  UpsertTalentRequestDto,
} from './dto/request.dto';

@ApiTags('customer · bookings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@ApiExtraModels(BookingCardResponse)
@Controller({ path: 'customer/bookings', version: '1' })
export class CustomerBookingsController {
  constructor(
    private readonly bookings: CustomerBookingsService,
    private readonly requests: BookingRequestService,
  ) {}

  // ── Drafts ─────────────────────────────────────────────────────────────────

  @Post('equipment/draft')
  @ApiOperation({
    summary: 'Start an equipment booking draft',
    description: `
Backs **Save Draft** on the two-step equipment wizard.

Every field is optional, so the wizard can be saved at any point — including immediately,
with nothing filled in. What a *submission* requires is checked at submit time; validating
a draft as if it were final would make "Save Draft" impossible.

The draft is the same row the booking becomes, so the \`reference\` returned here
(\`ESK-10482\`) is the one the customer keeps for the whole rental. Drafts are excluded
from every availability calculation — an unsubmitted enquiry must never block another
customer.

Nothing is priced yet. Call \`GET /catalogue/equipment/{id}/quote\` for live totals while
the customer is choosing dates.

Use \`outstandingRequirements\` to drive the wizard: it names exactly what is still missing,
including gaps in the customer's own profile, prefixed \`customer.\` (e.g.
\`customer.idDocument\`).
`.trim(),
  })
  @ApiCreatedResponse({ type: DraftResponse })
  createEquipmentDraft(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertEquipmentRequestDto,
  ): Promise<DraftResponse> {
    return this.requests.createEquipmentDraft(userId, dto);
  }

  @Patch('equipment/draft/:id')
  @ApiOperation({
    summary: 'Update an equipment draft',
    description:
      'Partial update — send only what changed. Call it on each wizard step to keep the ' +
      'draft current. Returns 409 once the request has been submitted.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The draft id, not the reference.' })
  @ApiOkResponse({ type: DraftResponse })
  @ApiConflictResponse({ description: 'Already submitted; drafts are no longer editable.' })
  @ApiNotFoundResponse({ description: 'No draft with that id belongs to you.' })
  updateEquipmentDraft(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertEquipmentRequestDto,
  ): Promise<DraftResponse> {
    return this.requests.updateEquipmentDraft(userId, id, dto);
  }

  @Post('talent/draft')
  @ApiOperation({
    summary: 'Start a talent hire draft',
    description: `
Backs the five-step hire wizard: **Project → Schedule → Location → References → Budget**,
then Review.

(The design sheet labels three consecutive screens "Step 3 of 5"; the order above is the one
their content implies.)

All five steps post to this one body. Reference files are uploaded separately through
\`POST /customer/bookings/{reference}/attachments\`, so this stays JSON.

**Budget is not a price.** Supply \`budgetBand\` or \`budgetMinor\`; either opens the
negotiation. The agreed fee arrives when the talent proposes an amount and the customer
accepts it — see the price-proposal endpoints. A talent booking carries no total until then.

The reference is \`ESK-TLT-8847\` style, distinct from equipment's \`ESK-10482\`.
`.trim(),
  })
  @ApiCreatedResponse({ type: DraftResponse })
  createTalentDraft(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertTalentRequestDto,
  ): Promise<DraftResponse> {
    return this.requests.createTalentDraft(userId, dto);
  }

  @Patch('talent/draft/:id')
  @ApiOperation({
    summary: 'Update a talent hire draft',
    description: 'Partial update. Call it at the end of each wizard step.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DraftResponse })
  @ApiConflictResponse({ description: 'Already submitted.' })
  updateTalentDraft(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertTalentRequestDto,
  ): Promise<DraftResponse> {
    return this.requests.updateTalentDraft(userId, id, dto);
  }

  @Post('draft/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a draft to Eskista',
    description: `
Turns a draft into a real request. Works for both equipment and talent drafts.

For **equipment** this is the moment pricing is frozen: totals, VAT, commission and the
deposit are computed once, with the same function the quote endpoint uses, and snapshotted
onto the booking. A later price change on the listing can never rewrite what the customer
agreed to.

Availability is re-checked here, not just at quote time. Between drafting and submitting,
someone else may have taken the dates — that returns **409**, not a silent double-booking.

For **talent** nothing is priced: the request goes to Eskista with the stated budget, and
the fee is settled through the price-proposal exchange.

A **400** carries \`outstandingRequirements\` naming every remaining gap, so the client can
send the customer back to the right step.
`.trim(),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DraftResponse })
  @ApiBadRequestResponse({
    description: 'Not ready to submit. The body carries `outstandingRequirements`.',
    schema: {
      example: {
        message: 'This request is not ready to submit',
        outstandingRequirements: ['deliveryAddress', 'customer.idDocument'],
      },
    },
  })
  @ApiConflictResponse({
    description: 'Already submitted, or the dates stopped being available while drafting.',
  })
  submit(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DraftResponse> {
    return this.requests.submit(userId, id);
  }

  @Delete('draft/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Discard a draft',
    description: 'Only an unsubmitted draft can be deleted. A submitted request is cancelled.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiConflictResponse({ description: 'Already submitted — cancel it instead.' })
  deleteDraft(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.requests.deleteDraft(userId, id);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List my bookings',
    description: `
The **My Bookings** tabs. Equipment and talent come back together, as the designs show
them; pass \`type\` to separate them.

Every booking carries an \`actions\` array — render the entry with \`primary: true\` as the
filled button. That is how one list renders *Complete Payment*, *Track Booking*, *Arrange
Return*, *Complete Service* and *Book Again* without the client re-deriving the rules. A
disabled action carries \`disabledReason\`, safe to show verbatim.

\`badge\` gives the coloured chip, already worded.

**Two totals per booking**, and they differ: \`totalMinor\` excludes the refundable deposit,
\`amountDueMinor\` includes it. Show the second only on payment screens.

Ordering is soonest-first for upcoming and active, most-recent-first for completed.
`.trim(),
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(BookingCardResponse) } },
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            nextCursor: { type: 'string', nullable: true },
            hasNext: { type: 'boolean' },
          },
        },
      },
    },
  })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListBookingsQuery,
  ): Promise<CursorPage<BookingCardResponse>> {
    return this.bookings.list(userId, query);
  }

  @Get(':reference')
  @ApiOperation({
    summary: 'Get one booking in full',
    description: `
Everything on the **Booking Details** screen, in one call: the collapsible Equipment,
Payment, Fulfilment and Inspection panels, Documents & Records, the progress tracker, and
the activity feed.

**\`timeline\`** is computed server-side — 8 steps for an equipment rental, 6 for a talent
engagement. Render whatever comes back rather than hardcoding either list, and a new status
will never need a frontend release.

**\`delivery\`** and **\`return\`** each carry their own sub-tracker: 4 steps for delivery
(Prepared → Picked Up → Out for Delivery → Delivered), 5 for the return. \`courierPhone\`
is exposed; the vendor's number never is, because Eskista mediates all contact.

**\`inspection\`** is always present. Until the equipment is back, \`isComplete\` is false
and every field is null — render dashes, as the design does, so the customer knows an
inspection is still coming.

**\`documents\`** lists only files that actually exist. A row that 404s on tap reads as a
broken app rather than a document that is not ready yet.

**\`activity\`** is an allow-list projection of the status history. Vendor decline reasons
and internal admin notes are never included.

Another customer's reference returns **404**, not 403.
`.trim(),
  })
  @ApiParam({ name: 'reference', example: 'ESK-10482', description: 'Not the uuid.' })
  @ApiOkResponse({ type: BookingDetailResponse })
  @ApiNotFoundResponse({ description: 'No booking with that reference belongs to you.' })
  getOne(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<BookingDetailResponse> {
    return this.bookings.getDetail(userId, reference);
  }

  @Post(':reference/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a booking',
    description: `
Backs **Cancel Request**.

Allowed while the booking is a draft, under review, awaiting payment, or confirmed. Once
the equipment is out for delivery it is too late to cancel unilaterally — a courier may
already be carrying it — so that returns **409** directing the customer to support.

The reason is recorded on the status event and shown to Eskista.
`.trim(),
  })
  @ApiParam({ name: 'reference', example: 'ESK-10482' })
  @ApiOkResponse({ type: BookingDetailResponse, description: 'The booking, now cancelled.' })
  @ApiConflictResponse({ description: 'Too far along to cancel in the app.' })
  @ApiNotFoundResponse({ description: 'No booking with that reference belongs to you.' })
  cancel(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: CancelBookingDto,
  ): Promise<BookingDetailResponse> {
    return this.bookings.cancel(userId, reference, dto);
  }
}
