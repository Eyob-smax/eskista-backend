import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { UploadedFile } from '../../../common/upload';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { RecordInspectionDto } from '../inspections/dto/inspection.dto';
import { AdminInspectionsService } from '../inspections/admin-inspections.service';
import { AdminBookingOpsService } from './admin-booking-ops.service';
import { AdminBookingsService } from './admin-bookings.service';
import {
  AdminBookingDetailResponse,
  BookingCountsResponse,
  CancelledBookingResponse,
  FreeUnitResponse,
} from './dto/admin-booking-detail.dto';
import {
  ApproveBookingDto,
  AssignUnitsDto,
  CancelBookingDto,
  DepositRefundDto,
  NoteDto,
  ReasonDto,
  UpdateLegDto,
} from './dto/admin-booking-ops.dto';
import { AdminBookingRowResponse, AdminBookingsQuery } from './dto/admin-bookings.dto';

const REF = {
  name: 'reference',
  example: 'ESK-10484',
  description: 'The booking reference: `ESK-…` for equipment, `ESK-TLT-…` for talent.',
};

const NOT_FOUND = 'No booking has this reference.';

const INSPECTION_BODY = (returnFields: boolean) => ({
  description:
    'JSON, or multipart/form-data when photos are attached (field `photos`, up to 6 images). ' +
    'In multipart, booleans are the strings "true" / "false".',
  schema: {
    type: 'object',
    required: ['grade'],
    properties: {
      grade: {
        type: 'string',
        enum: ['PRISTINE', 'EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_ATTENTION', 'DAMAGED'],
        example: returnFields ? 'GOOD' : 'EXCELLENT',
      },
      notes: { type: 'string', example: 'Sensor clean, all accessories present, battery at 100%.' },
      inspectorName: { type: 'string', example: 'Dawit (hub technician)' },
      unitId: {
        type: 'string',
        format: 'uuid',
        description: 'When the booking has more than one unit.',
      },
      physicalPassed: { type: 'boolean', example: true },
      functionalPassed: { type: 'boolean', example: true },
      ...(returnFields
        ? {
            outcome: {
              type: 'string',
              enum: ['OK', 'DAMAGED', 'MISSING_ITEMS', 'LATE_RETURN'],
              example: 'DAMAGED',
            },
            missingItems: { type: 'string', example: '1× lens cap' },
            damageNotes: { type: 'string', example: 'Scratch on the LCD screen.' },
            deductionMinor: {
              type: 'integer',
              example: 150000,
              description: 'Withheld from the deposit (at most the deposit), passed to the vendor.',
            },
            reportIssue: { type: 'boolean', example: true, description: 'Opens an incident.' },
            issueType: { type: 'string', example: 'PHYSICAL_DAMAGE' },
            issueDescription: { type: 'string', example: 'LCD scratched during the shoot.' },
          }
        : {}),
      photos: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: 6 },
    },
  },
});

@ApiTags('admin · bookings')
@AdminAccess()
@Controller({ path: 'admin/bookings', version: '1' })
export class AdminBookingsController {
  constructor(
    private readonly bookings: AdminBookingsService,
    private readonly ops: AdminBookingOpsService,
    private readonly inspections: AdminInspectionsService,
  ) {}

  @Get()
  @ApiEndpoint({
    summary: 'Booking Requests / Active Rentals / Deliveries & Pickups',
    does: 'The three rental tables of Equipment OPS, chosen with `view`, plus a search across every booking.',
    behind: [
      'Read only. `requests` = submitted through confirmed; `active` = out for delivery through being inspected; `deliveries` = gear waiting at the hub to go out, on the road, or due back; `completed` = settled, closed, rejected, cancelled, expired; `all` = everything.',
      'Rental views show equipment only — talent requests are on `/admin/hiring`.',
      '`paymentState` and `nextAction` are derived from payments and the lifecycle, not stored.',
    ],
  })
  @ApiPaginatedResponse(AdminBookingRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid (e.g. an unknown `view`).' })
  list(@Query() query: AdminBookingsQuery): Promise<Paginated<AdminBookingRowResponse>> {
    return this.bookings.list(query);
  }

  @Get('counts')
  @ApiEndpoint({
    summary: 'Sidebar badges for the rental tables',
    does: 'How many bookings sit in Booking Requests, Active Rentals, Deliveries & Pickups and Hiring Requests.',
    behind: ['Read only: four counts over the booking table.'],
  })
  @ApiOkResponse({ type: BookingCountsResponse })
  @ApiStandardErrors()
  counts(): Promise<BookingCountsResponse> {
    return this.bookings.counts();
  }

  @Get(':reference')
  @ApiEndpoint({
    summary: 'Booking Detail — every tab',
    does: 'Everything the Booking Detail screen shows: the header, the 13-step (equipment) or 6-step (talent) lifecycle, the next actions, and the Overview, Delivery & Inspection, Settlement and Documents tabs.',
    behind: [
      'Read only. Assembled from the booking, its units, legs, vendor handover, inspections, agreements, payments, invoice line, settlement, issues and status history.',
      '`actions` are computed from the same rules the endpoints enforce, so a disabled button carries the reason the endpoint would give.',
      'Private files (receipts, IDs, signed scans) come back as `/api/v1/files/…` links that need the admin session.',
    ],
    rules: ['404 when no booking has this reference.'],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({ notFound: NOT_FOUND })
  detail(@Param('reference') reference: string): Promise<AdminBookingDetailResponse> {
    return this.bookings.detail(reference);
  }

  @Get(':reference/units')
  @ApiEndpoint({
    summary: 'Units for the Assign Unit picker',
    does: 'Every physical unit of the booked equipment, with whether it is free on these dates.',
    behind: [
      'Read only. A unit is busy when another approved booking (awaiting payment through inspection) overlaps these dates, or the vendor blocked those days, or it is not in service.',
    ],
    rules: ['404 when no booking has this reference.'],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: [FreeUnitResponse] })
  @ApiStandardErrors({ notFound: NOT_FOUND })
  units(@Param('reference') reference: string): Promise<FreeUnitResponse[]> {
    return this.ops.freeUnits(reference);
  }

  @Post(':reference/approve')
  @ApiEndpoint({
    summary: 'Approve Booking',
    does: 'Eskista accepts an equipment request the vendor has already accepted, and asks the customer to sign and pay.',
    behind: [
      'Units assigned: the ones in `unitIds`, or free in-service units picked automatically.',
      'Status `REQUEST_SUBMITTED`/`ESKISTA_REVIEW` → `AWAITING_PAYMENT`; price frozen (`pricedAt`); return deadline set to 5:00 PM Addis Ababa on the last day unless `dueAt` is sent.',
      'Rental agreement issued: text frozen to storage with a SHA-256 hash.',
      'Invoice issued (`ESK-INV-YYYY-NNNNNN`).',
      'Notifications: customer — Booking Approved and Agreement Ready; vendor — Booking Approved.',
      'Status history and admin audit log written.',
    ],
    seenBy: [
      'Customer: the booking moves to Payment, with Download & Sign Agreement first.',
      'Vendor: the booking moves to Payment; Prepare Equipment becomes available.',
    ],
    rules: [
      '400 for a talent request (approve it by hiring) or `unitIds` of other equipment.',
      '409 unless the booking is awaiting approval and the vendor has accepted.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'A talent request (approve it by hiring), or invalid `unitIds`.',
    notFound: NOT_FOUND,
    conflict: 'Wait for the vendor to accept the request first',
  })
  async approve(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: ApproveBookingDto,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.approve(adminId, reference, dto);
    return this.bookings.detail(reference);
  }

  @Post(':reference/reject')
  @ApiEndpoint({
    summary: 'Reject Request',
    does: 'Turns down a request before approval; the reason goes to the customer.',
    behind: [
      'Status → `REJECTED`, reason stored.',
      'Wrap-up (shared with the customer’s own cancel): agreements voided, payment slips still awaiting review rejected, unpaid invoices voided (a combined invoice as a whole), scheduled jobs cancelled, gear already at the hub handed back to the vendor (custody → VENDOR), and for a talent request every open invitation closed.',
      'Notifications: customer — Booking Declined (with the reason); vendor or talent — Booking Cancelled.',
      'Status history and admin audit log written.',
    ],
    rules: [
      '409 once approved — use Cancel instead.',
      '400 when `reason` is missing or under 5 characters.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: NOT_FOUND,
    conflict: 'Only a request not yet approved can be rejected; cancel it instead',
  })
  async reject(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: ReasonDto,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.reject(adminId, reference, dto.reason);
    return this.bookings.detail(reference);
  }

  @Post(':reference/cancel')
  @ApiEndpoint({
    summary: 'Cancel an approved booking',
    does: 'Stops a booking up to Booking Confirmed — before the gear or the talent is out.',
    behind: [
      'Status → `CANCELLED` (cancelled by this admin).',
      'Wrap-up (shared with the customer’s own cancel): agreements voided, payment slips still awaiting review rejected, unpaid invoices voided (a combined invoice as a whole), scheduled jobs cancelled, gear already at the hub handed back to the vendor (custody → VENDOR), and for a talent request every open invitation closed.',
      'Notifications: customer — Booking Cancelled; vendor or talent — Booking Cancelled.',
      '`refundDueMinor` is money already verified. Nothing is refunded automatically: finance returns it outside the system.',
    ],
    rules: ['409 once delivery has started.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiOkResponse({ type: CancelledBookingResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: NOT_FOUND,
    conflict: 'This booking is already under way and cannot be cancelled',
  })
  async cancel(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: CancelBookingDto,
  ): Promise<CancelledBookingResponse> {
    const { refundDueMinor } = await this.ops.cancel(adminId, reference, dto.reason);
    return { ...(await this.bookings.detail(reference)), refundDueMinor };
  }

  @Put(':reference/units')
  @ApiEndpoint({
    summary: 'Assign Unit',
    does: 'Chooses which physical copies go out, replacing the current assignment.',
    behind: ['Booking-unit links replaced; status history noted. Custody does not change yet.'],
    rules: [
      '400 for more units than booked, or units of other equipment.',
      '409 when a unit is taken on these dates (`unitIds` lists them), retired, or the gear is already at the hub.',
    ],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Too many units, or a unit of other equipment.',
    notFound: NOT_FOUND,
    conflict: 'Some units are taken on these dates (`unitIds` lists them)',
  })
  async assignUnits(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: AssignUnitsDto,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.assignUnits(adminId, reference, dto.unitIds);
    return this.bookings.detail(reference);
  }

  @Post(':reference/receive-at-hub')
  @ApiEndpoint({
    summary: 'Receive at Hub',
    does: 'Records that Eskista has the gear from the vendor.',
    behind: [
      'Vendor handover: `receivedAtHubAt` set — and `handedOverAt` too if the vendor never pressed Confirm Handover.',
      'Assigned units: custody → HUB.',
      'Status history noted. Receiving twice changes nothing.',
    ],
    seenBy: ['Vendor: the timeline moves past Handover to Rental Active.'],
    rules: ['409 unless the booking is Booking Confirmed with a unit assigned.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({ notFound: NOT_FOUND, conflict: 'Assign a unit first' })
  async receive(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: NoteDto,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.receiveAtHub(adminId, reference, dto.note);
    return this.bookings.detail(reference);
  }

  @Post(':reference/inspections/outgoing')
  @ApiEndpoint({
    summary: 'Update Manual Outgoing Inspection',
    does: 'The check at the hub before the gear leaves — recorded, or corrected until it is delivered.',
    behind: [
      'One OUTGOING inspection per booking, upserted: grade, notes, inspector, pass/fail checks.',
      'Photos (multipart `photos`, up to 6) stored privately on Cloudinary under the booking.',
      'Units: last grade, last inspected and condition updated; a DAMAGED grade puts the unit in MAINTENANCE, which blocks Start Packing Gear.',
      'Status history noted; admin audit log written.',
    ],
    seenBy: ['Unit detail → Condition History; Inspections & QA.'],
    rules: [
      '409 unless the gear is at the hub and not yet delivered.',
      '400 for a unit not on this booking or more than 6 photos.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody(INSPECTION_BODY(false))
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid grade, a unit not on this booking, or too many photos.',
    notFound: NOT_FOUND,
    conflict: 'Receive the equipment at the hub before inspecting it',
  })
  async outgoing(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: RecordInspectionDto,
    @UploadedFiles() photos: UploadedFile[] = [],
  ): Promise<AdminBookingDetailResponse> {
    await this.inspections.recordForBooking(adminId, reference, 'OUTGOING', dto, photos ?? []);
    return this.bookings.detail(reference);
  }

  @Post(':reference/inspections/return')
  @ApiEndpoint({
    summary: 'Post-Shoot Return Inspection',
    does: 'Inspects the returned gear against the outgoing baseline and settles the deposit.',
    behind: [
      'One RETURN inspection per booking, upserted: grade, outcome, missing items, damage, photos.',
      'Deposit: `deductionMinor` withheld (never more than the deposit held); the rest is released. The deduction is later added to the vendor’s settlement as damage compensation.',
      'Status `RETURN_RECEIVED` → `INSPECTION` on the first record.',
      'Units: grade and condition updated; DAMAGED → MAINTENANCE.',
      '`reportIssue: true` opens an issue on the desk (reported by Eskista, Under Review).',
      'Notification: customer — Inspection Complete, with any deduction.',
    ],
    seenBy: ['Customer: the Inspection block on the booking.', 'Vendor: View Inspection Results.'],
    rules: [
      '409 unless the gear is back at the hub; editable until the booking is settled.',
      '400 when the deduction exceeds the deposit — raise the rest as an issue.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody(INSPECTION_BODY(true))
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'The deduction is larger than the deposit held',
    notFound: NOT_FOUND,
    conflict: 'The return inspection is done once the equipment is back at the hub',
  })
  async returnInspection(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: RecordInspectionDto,
    @UploadedFiles() photos: UploadedFile[] = [],
  ): Promise<AdminBookingDetailResponse> {
    await this.inspections.recordForBooking(adminId, reference, 'RETURN', dto, photos ?? []);
    return this.bookings.detail(reference);
  }

  @Post(':reference/delivery')
  @ApiEndpoint({
    summary: 'Start Packing Gear → Picked Up → Out for Delivery → Handover Complete',
    does: 'Sends the gear out and moves the courier along the four-step tracker.',
    behind: [
      'First call: the delivery leg is created — courier dispatch, or studio pickup when the customer collects — and the status moves `BOOKING_CONFIRMED` → `DELIVERY_PICKUP`.',
      'Later calls update the courier details and move `stage` forward (never back).',
      'OUT_FOR_DELIVERY: customer told the ETA.',
      'DELIVERED (Handover Complete): status → `IN_PROGRESS`, units custody → CLIENT, customer told it was delivered, and the return reminder job scheduled for the day before the deadline.',
    ],
    seenBy: ['Customer: Track Your Equipment.', 'Vendor: Track Your Equipment.'],
    rules: [
      '409 until the gear is at the hub with a passing outgoing inspection.',
      '400 when the stage would move backwards.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiBody({
    type: UpdateLegDto,
    examples: {
      dispatch: {
        summary: 'Start Packing Gear',
        value: {
          courierName: 'Abebe K.',
          courierPhone: '+251911556677',
          vehicleDescription: 'Motorbike',
          vehiclePlate: 'AA 3-1024',
          scheduledAt: '2026-10-01T07:00:00.000Z',
        },
      },
      outForDelivery: {
        summary: 'Out for Delivery',
        value: { stage: 'OUT_FOR_DELIVERY', etaAt: '2026-10-01T12:45:00.000Z' },
      },
      handoverComplete: { summary: 'Handover Complete', value: { stage: 'DELIVERED' } },
    },
  })
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'A delivery cannot move backwards',
    notFound: NOT_FOUND,
    conflict: 'Record the outgoing inspection first',
  })
  async delivery(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: UpdateLegDto,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.updateDelivery(adminId, reference, dto);
    return this.bookings.detail(reference);
  }

  @Post(':reference/return')
  @ApiEndpoint({
    summary: 'Arrange or advance the return — Mark Returned to Hub',
    does: 'The return leg: arranged for the customer when they have not, then moved along.',
    behind: [
      'No leg yet: one is created (Eskista collects, or the customer drops off) and the status moves to `RETURN_SCHEDULED`; the return reminder job is cancelled.',
      '`stage: DELIVERED` is "Received by Eskista": status → `RETURN_RECEIVED`, units custody → HUB.',
    ],
    seenBy: ['Customer: the Return tracker.', 'Vendor: the timeline reaches Equipment Returned.'],
    rules: ['409 until the customer has the gear.', '400 when the stage would move backwards.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiBody({
    type: UpdateLegDto,
    examples: {
      arrange: {
        summary: 'Eskista collects',
        value: {
          returnMethod: 'SCHEDULED_PICKUP',
          address: 'Bole, near Edna Mall',
          scheduledAt: '2026-10-03T08:00:00.000Z',
        },
      },
      received: { summary: 'Mark Returned to Hub', value: { stage: 'DELIVERED' } },
    },
  })
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'A delivery cannot move backwards',
    notFound: NOT_FOUND,
    conflict: 'A return is arranged once the customer has the equipment',
  })
  async returnLeg(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: UpdateLegDto,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.updateReturn(adminId, reference, dto);
    return this.bookings.detail(reference);
  }

  @Post(':reference/deposit-refund')
  @ApiEndpoint({
    summary: 'Record Deposit Refund',
    does: 'Records that the deposit, less any deduction, was sent back to the customer.',
    behind: [
      'Booking: refund amount, date and transfer reference stored. `amountMinor` defaults to what the return inspection released.',
      'Status history noted; admin audit log written.',
      'Notification: customer — Deposit Refunded (when the amount is above zero).',
    ],
    seenBy: ['Customer: the Inspection block shows the refund.'],
    rules: [
      '409 before the return inspection, when no deposit was taken, or when already recorded.',
      '400 when the refund exceeds the deposit held.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'The refund cannot exceed the deposit held',
    notFound: NOT_FOUND,
    conflict: 'Record the return inspection first',
  })
  async depositRefund(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: DepositRefundDto,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.refundDeposit(adminId, reference, dto);
    return this.bookings.detail(reference);
  }

  @Post(':reference/settle')
  @ApiEndpoint({
    summary: 'Move to Settlement',
    does: 'Makes the supplier’s payout owed.',
    behind: [
      'Status → `SETTLEMENT` (equipment from Inspection; talent from Rental Completed).',
      'Settlement created once (`STL-NNNN`): gross, commission, net; damage compensation from the deposit added as an adjustment; due after `payout.delay_days` (default 7).',
      'If the supplier already confirmed their payout (finance paid early), the 24-hour auto-close job is scheduled now.',
    ],
    seenBy: [
      'Vendor: Confirm Return / Confirm Payment.',
      'Talent: the payout block.',
      'Finance: Vendor Payouts & Settlements.',
    ],
    rules: ['409 for equipment without a return inspection, or at any other status.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.FINANCE)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({ notFound: NOT_FOUND, conflict: 'Record the return inspection first' })
  async settle(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.settle(adminId, reference);
    return this.bookings.detail(reference);
  }

  @Post(':reference/return-to-vendor')
  @ApiEndpoint({
    summary: 'Return Gear to Vendor',
    does: 'Records that the gear went back to the vendor — optional, as it may stay at the hub for its next rental.',
    behind: [
      'Vendor handover: `returnedToVendorAt` set; units at the hub: custody → VENDOR.',
      'Status history noted. Doing it twice changes nothing.',
    ],
    seenBy: ['Vendor: they must now Confirm Return before Confirm Payment.'],
    rules: ['409 before the return inspection.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    notFound: NOT_FOUND,
    conflict: 'Gear goes back to the vendor after its return inspection',
  })
  async returnToVendor(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.returnToVendor(adminId, reference);
    return this.bookings.detail(reference);
  }

  @Post(':reference/close')
  @ApiEndpoint({
    summary: 'Close Booking',
    does: 'Closes a booking whose supplier is paid, without waiting for them to press Complete.',
    behind: [
      'Status `SETTLEMENT` → `CLOSED`; the auto-close job is cancelled.',
      'Feedback request job scheduled; customer told the booking is complete.',
      'Admin audit log written.',
    ],
    seenBy: ['Customer: Rate Your Experience.'],
    rules: ['409 until the settlement is paid.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.FINANCE)
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    notFound: NOT_FOUND,
    conflict: 'Pay the supplier before closing the booking',
  })
  async close(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.close(adminId, reference);
    return this.bookings.detail(reference);
  }

  @Post(':reference/start')
  @ApiEndpoint({
    summary: 'Talent: Start Engagement',
    does: 'Marks a confirmed talent engagement as under way.',
    behind: ['Status `BOOKING_CONFIRMED` → `IN_PROGRESS`; status history noted.'],
    seenBy: [
      'Customer: Complete Service becomes available.',
      'Talent: the engagement shows as in progress.',
    ],
    rules: [
      '400 for an equipment booking.',
      '409 unless both the client’s and the talent’s agreements are approved.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam({ ...REF, example: 'ESK-TLT-9001' })
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Not a talent engagement.',
    notFound: NOT_FOUND,
    conflict: "Both the client's and the talent's agreements must be approved",
  })
  async start(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.startEngagement(adminId, reference);
    return this.bookings.detail(reference);
  }

  @Post(':reference/complete')
  @ApiEndpoint({
    summary: 'Talent: Mark Completed',
    does: 'The customer’s Complete Service, done by Eskista on their behalf.',
    behind: [
      'Status → `RENTAL_COMPLETED`; the talent’s settlement is created (due after the payout delay).',
    ],
    seenBy: ['Finance: the payout appears on Vendor Payouts & Settlements.'],
    rules: ['400 for an equipment booking.', '409 before the engagement has started.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam({ ...REF, example: 'ESK-TLT-9001' })
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Not a talent engagement.',
    notFound: NOT_FOUND,
    conflict: 'The engagement has not started',
  })
  async complete(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
  ): Promise<AdminBookingDetailResponse> {
    await this.ops.completeEngagement(adminId, reference);
    return this.bookings.detail(reference);
  }
}
