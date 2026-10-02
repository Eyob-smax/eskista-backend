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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/auth.decorators';
import {
  CustomerInvitationsResponse,
  HireTalentDto,
  InviteMoreDto,
} from '../hiring/dto/hiring.dto';
import { HiringService } from '../hiring/hiring.service';
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

const DRAFT_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Draft ID (UUID).',
  example: '550e8400-e29b-41d4-a716-446655440000',
};

const BOOKING_REF_PARAM = {
  name: 'reference',
  description: 'Human-readable booking reference.',
  example: 'ESK-10482',
};

const TALENT_REQUEST_REF_PARAM = {
  name: 'reference',
  description: 'Human-readable talent request reference.',
  example: 'ESK-TLT-1004',
};

@ApiTags('customer · bookings')
@ApiBearerAuth()
@ApiStandardErrors()
@ApiExtraModels(BookingCardResponse)
@Controller({ path: 'customer/bookings', version: '1' })
export class CustomerBookingsController {
  constructor(
    private readonly bookings: CustomerBookingsService,
    private readonly requests: BookingRequestService,
    private readonly hiring: HiringService,
  ) {}

  // ── Drafts ─────────────────────────────────────────────────────────────────

  @Post('equipment/draft')
  @ApiEndpoint({
    summary: 'Start an equipment booking draft',
    does: 'Initializes a new equipment rental booking draft from the two-step equipment wizard.',
    behind: [
      'Creates a new Booking record in DRAFT status with a human-readable reference like ESK-10482.',
      'Saves optional wizard inputs (listingId, dates, quantity, collection method, delivery address).',
      'Computes wizard completion readiness checklist (outstandingRequirements).',
      'Excludes unsubmitted drafts from calendar availability calculations and avoids freezing prices.',
    ],
    seenBy: [
      'Customer receives the draft reference, pre-filled wizard fields, and outstanding requirements checklist.',
    ],
    rules: [
      '401 if not authenticated with an active session token.',
      'All request fields are optional to allow saving at any point in the wizard.',
    ],
  })
  @ApiCreatedResponse({ type: DraftResponse })
  createEquipmentDraft(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertEquipmentRequestDto,
  ): Promise<DraftResponse> {
    return this.requests.createEquipmentDraft(userId, dto);
  }

  @Patch('equipment/draft/:id')
  @ApiParam(DRAFT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Update an equipment draft',
    does: 'Partially updates an existing equipment rental draft across wizard steps.',
    behind: [
      'Updates fields on the existing DRAFT Booking record belonging to this customer.',
      'Re-evaluates outstandingRequirements to guide remaining wizard steps.',
    ],
    seenBy: [
      'Customer sees updated draft state in the equipment rental wizard.',
    ],
    rules: [
      '400 if validation fails on dates or quantities.',
      '401 if not authenticated.',
      '404 if draft ID does not exist or belongs to another user.',
      '409 if the booking has already been submitted.',
    ],
  })
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
  @ApiEndpoint({
    summary: 'Start a talent hire draft',
    does: 'Initializes a new creative talent hiring draft from the five-step hiring wizard.',
    behind: [
      'Creates a new Booking record of type TALENT in DRAFT status with an ESK-TLT-xxxx reference.',
      'Stores project description, schedule, venue, headcount, budget, and invited talent profile IDs.',
      'Excludes unsubmitted drafts from talent calendars.',
    ],
    seenBy: [
      'Customer receives the talent draft ID and reference to continue the wizard.',
    ],
    rules: [
      '401 if not authenticated.',
      'Body fields are optional to permit partial progress saving.',
    ],
  })
  @ApiCreatedResponse({ type: DraftResponse })
  createTalentDraft(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertTalentRequestDto,
  ): Promise<DraftResponse> {
    return this.requests.createTalentDraft(userId, dto);
  }

  @Patch('talent/draft/:id')
  @ApiParam(DRAFT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Update a talent hire draft',
    does: 'Partially updates an existing creative talent hiring draft.',
    behind: [
      'Updates fields on the draft Booking record for this customer.',
      'Recomputes outstanding requirements.',
    ],
    seenBy: [
      'Customer sees updated draft steps in the talent hire wizard.',
    ],
    rules: [
      '400 if validation fails.',
      '401 if not authenticated.',
      '404 if draft ID is not found.',
      '409 if already submitted.',
    ],
  })
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
  @ApiParam(DRAFT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Submit a draft to Eskista',
    does: 'Submits a completed equipment or talent draft into an active marketplace request.',
    behind: [
      'Validates that all outstandingRequirements are met.',
      'For equipment: verifies calendar availability, freezes rental rate, platform commission, and VAT snapshot, moves status to SUBMITTED / UNDER_REVIEW, and notifies the vendor.',
      'For talent: verifies invited talents are available, starts 48-hour response countdowns, sets status to ESKISTA_REVIEW, and dispatches invitation notifications to each talent.',
    ],
    seenBy: [
      'Customer sees the request transition from draft to active in the upcoming tab.',
      'Suppliers receive notifications of new rental requests or invitations.',
    ],
    rules: [
      '400 with outstandingRequirements if required fields or contact details are missing.',
      '401 if not authenticated.',
      '404 if draft ID not found.',
      '409 if already submitted or if equipment dates became unavailable while drafting.',
    ],
  })
  @ApiOkResponse({ type: DraftResponse })
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
  @ApiParam(DRAFT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Discard a draft',
    does: 'Permanently discards an unsubmitted booking draft.',
    behind: [
      'Deletes the Booking row in DRAFT status from the database.',
    ],
    seenBy: [
      'Customer no longer sees the draft in their drafts list or wizard.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if draft ID not found.',
      '409 if the booking has already been submitted (must use cancel instead).',
    ],
  })
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
  @ApiEndpoint({
    summary: 'List my bookings',
    does: 'Retrieves a paginated list of bookings for the customer filtered by tab (upcoming, active, completed, drafts) and type.',
    behind: [
      'Queries bookings for the customer filtered by status bucket and type.',
      'Computes primary action buttons and badge chips for each card.',
    ],
    seenBy: [
      'Customer sees their booking list on the My Bookings screen.',
    ],
    rules: [
      '401 if not authenticated.',
    ],
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
  @ApiParam(BOOKING_REF_PARAM)
  @ApiEndpoint({
    summary: 'Get one booking in full',
    does: 'Returns complete details for a booking including equipment/talent info, payment breakdown, fulfilment tracking, inspection, documents, and activity timeline.',
    behind: [
      'Fetches booking record with all relations (subject, payments, delivery/return fulfilment, agreements, inspection).',
      'Generates timeline steps, fulfilment sub-trackers, and available client actions.',
    ],
    seenBy: [
      'Customer sees the comprehensive Booking Details screen in the Mini App.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking reference does not exist or belongs to another customer.',
    ],
  })
  @ApiOkResponse({ type: BookingDetailResponse })
  @ApiNotFoundResponse({ description: 'No booking with that reference belongs to you.' })
  getOne(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<BookingDetailResponse> {
    return this.bookings.getDetail(userId, reference);
  }

  // ── Talent hire ────────────────────────────────────────────────────────────

  @Get(':reference/invitations')
  @ApiParam(TALENT_REQUEST_REF_PARAM)
  @ApiEndpoint({
    summary: 'See who has answered a talent request',
    does: 'Returns all invited talents for a talent request, their response status, individual quotes, and the selection countdown deadline.',
    behind: [
      'Queries invitations for the talent request reference.',
      'Settles expired invitations (48h reply window).',
      'Computes each talent rate, commission, and VAT totals.',
    ],
    seenBy: [
      'Customer sees the "Choose Talent" card list with prices and accept/decline badges.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if talent request reference is not found.',
    ],
  })
  @ApiOkResponse({ type: CustomerInvitationsResponse })
  @ApiNotFoundResponse({ description: 'No talent request with that reference belongs to you.' })
  listInvitations(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<CustomerInvitationsResponse> {
    return this.hiring.listForCustomer(userId, reference);
  }

  @Post(':reference/invitations')
  @HttpCode(HttpStatus.OK)
  @ApiParam(TALENT_REQUEST_REF_PARAM)
  @ApiEndpoint({
    summary: 'Invite more talents to an open request',
    does: 'Sends invitations to additional creative professionals on an open talent request.',
    behind: [
      'Validates total invited count is within the platform limit (max 5).',
      'Creates invitation rows and starts new 48-hour response countdowns.',
      'Dispatches notifications to the newly invited talents.',
    ],
    seenBy: [
      'Customer sees the newly invited talents in the invitation roster.',
    ],
    rules: [
      '400 if exceeding the invitation limit.',
      '401 if not authenticated.',
      '404 if request reference not found.',
      '409 if someone is already hired, request is closed, or talents were already invited.',
    ],
  })
  @ApiOkResponse({ type: CustomerInvitationsResponse })
  @ApiConflictResponse({ description: 'Already hired, closed, or those talents are invited.' })
  inviteMore(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: InviteMoreDto,
  ): Promise<CustomerInvitationsResponse> {
    return this.hiring.inviteMore(userId, reference, dto.talentProfileIds);
  }

  @Post(':reference/hire')
  @HttpCode(HttpStatus.OK)
  @ApiParam(TALENT_REQUEST_REF_PARAM)
  @ApiEndpoint({
    summary: 'Hire from the talents who accepted',
    does: 'Hires one or more accepted talents for the booking, freezing their price and issuing agreements.',
    behind: [
      'Moves selected talent invitation(s) to HIRED; marks remaining active invitations as REJECTED.',
      'Prices the booking from the chosen talent service or base rate plus commission and VAT.',
      'Generates legal agreements (Customer ↔ Eskista and Eskista ↔ Talent).',
      'Transitions booking to AWAITING_PAYMENT.',
    ],
    seenBy: [
      'Customer sees the booking advance to the agreement and payment stage.',
      'Hired talent sees the engagement confirmed; rejected talents are notified.',
    ],
    rules: [
      '400 if hiring more talents than the request headcount.',
      '401 if not authenticated.',
      '404 if request reference not found.',
      '409 if a picked talent has not accepted, is no longer available, or request is closed.',
    ],
  })
  @ApiOkResponse({ type: CustomerInvitationsResponse })
  @ApiConflictResponse({ description: 'Not accepted, already hired, or closed.' })
  hire(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: HireTalentDto,
  ): Promise<CustomerInvitationsResponse> {
    return this.hiring.hire(userId, reference, dto.talentProfileIds);
  }

  @Post(':reference/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam(BOOKING_REF_PARAM)
  @ApiEndpoint({
    summary: 'Cancel a booking',
    does: 'Cancels an in-flight booking request or confirmed rental before courier dispatch.',
    behind: [
      'Transitions the Booking to CANCELLED status.',
      'Records cancellation reason in the audit activity log.',
      'Releases reserved equipment inventory or talent calendar locks.',
      'Notifies the supplier and Eskista operations.',
    ],
    seenBy: [
      'Customer sees booking status change to Cancelled with full activity history.',
      'Vendor or talent is notified of the cancellation.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking reference not found.',
      '409 if the booking is already out for delivery or completed (cancellation disallowed via app).',
    ],
  })
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

