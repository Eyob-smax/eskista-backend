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
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
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

const LIFECYCLE = `
**An equipment rental, as Eskista runs it.**

1. **Approve Booking** once the vendor has accepted (\`/approve\`). A free unit is held and
   the customer's agreement and invoice are issued.
2. The customer signs and pays. Approve the signed scan (\`/admin/agreements\`) and confirm the
   payment (\`/admin/payments\`), in either order: the booking confirms when both are done.
3. The vendor prepares and hands over; **Receive at Hub** (\`/receive-at-hub\`).
4. **Update Manual Outgoing Inspection** (\`/inspections/outgoing\`).
5. **Start Packing Gear** (\`/delivery\`), then move the courier along: Picked Up → Out for
   Delivery → **Handover Complete** (\`stage: DELIVERED\`), which starts the rental.
6. The customer arranges the return, or Eskista does (\`/return\`); **Mark Returned to Hub** is
   \`{ "stage": "DELIVERED" }\`.
7. **Post-Shoot Return Inspection** (\`/inspections/return\`), with any damage deduction.
8. **Record Deposit Refund**, **Move to Settlement**, pay the vendor
   (\`/admin/settlements/:ref/pay\`), optionally **Return Gear to Vendor**, then **Close Booking**
   — or let the vendor complete it.

**A talent engagement:** hire (\`/admin/hiring/:ref/hire\` or the customer) → scan approved and
paid → **Start Engagement** (\`/start\`) → **Mark Completed** (\`/complete\`) or the customer's
Complete Service → **Move to Settlement** → pay the talent → close.

Every step answers with the refreshed Booking Detail. Its \`actions\` list what can happen next,
so the dashboard never has to work out the rules itself. A step called at the wrong stage
answers **409** with the reason.
`.trim();

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
  @ApiOperation({
    summary: 'Booking Requests / Active Rentals / Deliveries & Pickups',
    description:
      'The three rental tables, picked with `view`:\n\n' +
      '- `requests` — submitted, awaiting approval, awaiting payment, confirmed\n' +
      '- `active` — out for delivery, with the customer, returning, being inspected\n' +
      '- `deliveries` — gear waiting at the hub to go out, on the road, or due back\n' +
      '- `completed` — settled, closed, rejected, cancelled, expired\n' +
      '- `all` (default) — everything, talent included\n\n' +
      'The rental views show equipment only; talent requests are at `/admin/hiring`.',
  })
  @ApiPaginatedResponse(AdminBookingRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid (e.g. an unknown `view`).' })
  list(@Query() query: AdminBookingsQuery): Promise<Paginated<AdminBookingRowResponse>> {
    return this.bookings.list(query);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Sidebar badges for the rental tables' })
  @ApiOkResponse({ type: BookingCountsResponse })
  @ApiStandardErrors()
  counts(): Promise<BookingCountsResponse> {
    return this.bookings.counts();
  }

  @Get(':reference')
  @ApiOperation({ summary: 'Booking Detail — every tab', description: LIFECYCLE })
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({ notFound: NOT_FOUND })
  detail(@Param('reference') reference: string): Promise<AdminBookingDetailResponse> {
    return this.bookings.detail(reference);
  }

  @Get(':reference/units')
  @ApiOperation({
    summary: 'Units for the Assign Unit picker',
    description: 'Every unit of the booked equipment, with whether it is free on these dates.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: [FreeUnitResponse] })
  @ApiStandardErrors({ notFound: NOT_FOUND })
  units(@Param('reference') reference: string): Promise<FreeUnitResponse[]> {
    return this.ops.freeUnits(reference);
  }

  @Post(':reference/approve')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Approve Booking',
    description:
      'Equipment only, once the vendor has accepted. Moves the booking to `AWAITING_PAYMENT`: ' +
      'the price is frozen, the return deadline set (5:00 PM on the last day unless `dueAt`), ' +
      'free units held (or the ones in `unitIds`), and the customer’s agreement and invoice ' +
      'issued. The customer is told to sign and pay; the vendor that it is approved.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Reject Request',
    description:
      'Before approval only. The reason is sent to the customer; agreements are voided; for a ' +
      'talent request every open invitation is closed and each talent told.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Cancel an approved booking',
    description:
      'Up to Booking Confirmed — before the gear or the talent is out. Unpaid invoices are ' +
      'voided. `refundDueMinor` is money already verified, which finance returns separately.',
  })
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
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Assign Unit',
    description:
      'The physical copies that go out, replacing the current assignment. At most the booked ' +
      'quantity; only units of the booked equipment; not retired, vendor-blocked, or held by ' +
      'another approved booking on these dates. Locked once the gear is at the hub.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Receive at Hub',
    description:
      'Eskista has the gear from the vendor: custody → HUB. If the vendor never pressed Confirm ' +
      'Handover, this confirms it for them. Needs an assigned unit and a confirmed booking. ' +
      'Receiving twice is not an error.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody(INSPECTION_BODY(false))
  @ApiOperation({
    summary: 'Update Manual Outgoing Inspection',
    description:
      'The check at the hub before the gear leaves. Records it, or corrects it until the gear ' +
      'is delivered. Updates the unit’s condition; a DAMAGED grade takes the unit out of ' +
      'rotation and blocks dispatch.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody(INSPECTION_BODY(true))
  @ApiOperation({
    summary: 'Post-Shoot Return Inspection',
    description:
      'Once the gear is back at the hub (`RETURN_RECEIVED`). Moves the booking to `INSPECTION`. ' +
      '`deductionMinor` is withheld from the deposit — never more than the deposit; raise the ' +
      'rest as an incident — and passed to the vendor as damage compensation. ' +
      '`reportIssue: true` opens an incident. The customer is told the result. Can be corrected ' +
      'until the booking is settled.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Start Packing Gear → Picked Up → Out for Delivery → Handover Complete',
    description:
      'The first call dispatches: it needs the gear at the hub and a passing outgoing inspection, ' +
      'creates the delivery leg (courier dispatch, or studio pickup when the customer collects) ' +
      'and moves the booking to `DELIVERY_PICKUP`. Later calls update the courier and move ' +
      '`stage` forward (never back). OUT_FOR_DELIVERY tells the customer the ETA; DELIVERED is ' +
      'Handover Complete: the rental starts (`IN_PROGRESS`), custody → CLIENT, the return ' +
      'reminder is scheduled.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Arrange or advance the return — Mark Returned to Hub',
    description:
      'Arranges the return on the customer’s behalf when they have not (`RETURN_SCHEDULED`), ' +
      'updates the courier, and moves it along. `stage: DELIVERED` is "Received by Eskista": ' +
      'the booking goes to `RETURN_RECEIVED` and custody → HUB.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({
    summary: 'Record Deposit Refund',
    description:
      'After the return inspection: the deposit, less any deduction, sent back to the customer. ' +
      '`amountMinor` defaults to what the inspection released. The customer is told. Once only.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.FINANCE)
  @ApiOperation({
    summary: 'Move to Settlement',
    description:
      'The supplier’s payout is now owed: the booking goes to `SETTLEMENT` and a settlement ' +
      '(STL-…) is created, due after the payout delay, with any damage compensation added. ' +
      'Equipment after the return inspection; talent once the service is complete.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Return Gear to Vendor',
    description:
      'Optional — gear may stay at the hub for its next rental. After the return inspection; ' +
      'custody → VENDOR. The vendor then confirms the return in their app.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.FINANCE)
  @ApiOperation({
    summary: 'Close Booking',
    description:
      'Once the supplier is paid, without waiting for them to press Complete. The customer is ' +
      'told and asked for a review.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Talent: Start Engagement',
    description:
      'From Booking Confirmed, once both the client’s and the talent’s agreements are approved.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Talent: Mark Completed',
    description:
      'The client’s Complete Service, on their behalf: `RENTAL_COMPLETED`, and the talent’s ' +
      'payout is recorded. Then Move to Settlement.',
  })
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
