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
  Res,
  StreamableFile,
  UploadedFile as UploadedFileParam,
  UploadedFiles as UploadedFilesParam,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { IncidentPhase, IncidentType, PaymentMethod } from '@prisma/client';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import type { UploadedFile } from '../../common/upload';
import { CurrentUser } from '../auth/auth.decorators';
import { BookingLifecycleService } from './booking-lifecycle.service';
import {
  AttachmentResponse,
  CustomerAgreementBodyResponse,
  CustomerAgreementResponse,
  DeclineAgreementDto,
  IncidentResponse,
  PaymentInstructionsResponse,
  ReportIncidentDto,
  ReturnOptionsResponse,
  ReviewResponse,
  ScheduleReturnDto,
  SubmitPaymentDto,
  SubmitReviewDto,
  TrackingResponse,
  UploadSignedCopyDto,
} from './dto/lifecycle.dto';

const BOOKING_REF_PARAM = {
  name: 'reference',
  description: 'The booking reference.',
  example: 'ESK-10482',
};

const AGREEMENT_ID_PARAM = {
  name: 'agreementId',
  format: 'uuid',
  description: 'Agreement ID (UUID).',
  example: '550e8400-e29b-41d4-a716-446655440000',
};

const ATTACHMENT_ID_PARAM = {
  name: 'attachmentId',
  format: 'uuid',
  description: 'Attachment ID (UUID).',
  example: '550e8400-e29b-41d4-a716-446655440001',
};

@ApiTags('customer · booking lifecycle')
@ApiBearerAuth()
@ApiStandardErrors({ notFound: 'No booking with that reference belongs to you.' })
@ApiParam(BOOKING_REF_PARAM)
@Controller({ path: 'customer/bookings/:reference', version: '1' })
export class BookingLifecycleController {
  constructor(private readonly lifecycle: BookingLifecycleService) {}

  // ── Agreements ─────────────────────────────────────────────────────────────

  @Get('agreements')
  @ApiEndpoint({
    summary: 'List the agreements on this booking',
    does: 'Returns contract agreements associated with this booking, indicating whether customer action is required.',
    behind: [
      'Queries agreements linked to the booking reference.',
      'Derives awaitingCustomer status and human-readable status labels.',
    ],
    seenBy: [
      'Customer sees the agreements card and current signature review status.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking reference not found.',
    ],
  })
  @ApiOkResponse({ type: [CustomerAgreementResponse] })
  listAgreements(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<CustomerAgreementResponse[]> {
    return this.lifecycle.listAgreements(userId, reference);
  }

  @Get('agreements/:agreementId')
  @ApiParam(AGREEMENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Read one agreement in full',
    does: 'Returns the complete frozen legal agreement text, terms, and SHA-256 content verification hash.',
    behind: [
      'Fetches agreement details and frozen markdown body bytes.',
      'Confirms contentHash against the issued document text.',
    ],
    seenBy: [
      'Customer reads the contract terms on screen before downloading or signing.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if agreement ID or booking reference not found.',
    ],
  })
  @ApiOkResponse({ type: CustomerAgreementBodyResponse })
  getAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
  ): Promise<CustomerAgreementBodyResponse> {
    return this.lifecycle.getAgreement(userId, reference, agreementId);
  }

  @Get('agreements/:agreementId/pdf')
  @ApiParam(AGREEMENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Download the agreement as a PDF',
    does: 'Renders and streams an A4 contract PDF containing agreement terms, signature blocks, and verification hash.',
    behind: [
      'Generates an A4 PDF document on-demand from the frozen contract body.',
      'Sets Content-Disposition attachment headers with appropriate no-store caching.',
    ],
    seenBy: [
      'Customer downloads and prints the official agreement PDF for physical signature.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if agreement not found.',
    ],
  })
  @ApiOkResponse({
    description: 'The rendered contract.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async downloadAgreementPdf(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.lifecycle.renderAgreementPdf(
      userId,
      reference,
      agreementId,
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });

    return new StreamableFile(buffer);
  }

  @Post('agreements/:agreementId/signed-copy')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiParam(AGREEMENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Upload the signed agreement',
    does: 'Uploads a scanned copy or photo of the physically signed contract to submit for Eskista review.',
    behind: [
      'Stores the scanned document in secure private storage.',
      'Sets agreement status to UNDER_REVIEW and records the signer name and timestamp.',
      'Unlocks the ability for the customer to proceed to payment submission.',
      'Creates review notification for Eskista operations staff.',
    ],
    seenBy: [
      'Customer sees the agreement update to "Under Review" and can access the payment screen.',
      'Eskista admin staff see the scan in the agreements review queue.',
    ],
    rules: [
      '400 if missing file, unsupported file format (PNG, JPEG, WebP, PDF), or file exceeds 10 MB.',
      '401 if not authenticated.',
      '404 if agreement not found.',
      '409 if already approved or currently under review.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'signerName'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'The scan. Max 10 MB.' },
        signerName: {
          type: 'string',
          description: 'Who physically signed the printed contract.',
          example: 'Selam Tesfaye',
        },
        signerPhone: { type: 'string', example: '+251911234567' },
      },
    },
  })
  @ApiOkResponse({ type: CustomerAgreementResponse })
  @ApiConflictResponse({ description: 'Already approved, or a scan is already under review.' })
  uploadSignedAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: UploadSignedCopyDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<CustomerAgreementResponse> {
    return this.lifecycle.uploadSignedAgreement(userId, reference, agreementId, dto, file);
  }

  @Post('agreements/:agreementId/decline')
  @HttpCode(HttpStatus.OK)
  @ApiParam(AGREEMENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Decline to sign',
    does: 'Records that the customer declines the issued agreement terms along with their explanation.',
    behind: [
      'Updates the agreement status to REJECTED with the decline reason.',
      'Logs the event and notifies Eskista operations for mediation.',
    ],
    seenBy: [
      'Customer sees the agreement marked as declined.',
      'Eskista staff follow up with the customer.',
    ],
    rules: [
      '400 if reason is too short.',
      '401 if not authenticated.',
      '404 if agreement not found.',
      '409 if agreement is already approved.',
    ],
  })
  @ApiOkResponse({ type: CustomerAgreementResponse })
  @ApiConflictResponse({ description: 'Already approved.' })
  declineAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: DeclineAgreementDto,
  ): Promise<CustomerAgreementResponse> {
    return this.lifecycle.declineAgreement(userId, reference, agreementId, dto);
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  @Get('payment-instructions')
  @ApiEndpoint({
    summary: 'Where to send the money, and how much',
    does: 'Returns bank and Telebirr collection details, exact transfer amount due, and verification requirements.',
    behind: [
      'Calculates amountDueMinor (rental total plus refundable security deposit).',
      'Fetches active Eskista collection accounts (Telebirr merchant, commercial bank accounts).',
      'Evaluates canSubmit and provides clear blockers if payment is currently unavailable.',
    ],
    seenBy: [
      'Customer sees the Complete Payment screen with bank account numbers and transfer reference.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking not found.',
    ],
  })
  @ApiOkResponse({ type: PaymentInstructionsResponse })
  getPaymentInstructions(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<PaymentInstructionsResponse> {
    return this.lifecycle.getPaymentInstructions(userId, reference);
  }

  @Post('payments')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Submit proof of payment',
    does: 'Uploads bank transfer slip or Telebirr confirmation screenshot to record offline payment evidence.',
    behind: [
      'Stores payment slip in private file storage.',
      'Creates Payment record in SUBMITTED status with transaction reference and transfer amount.',
      'Moves booking payment status to SUBMITTED and queues for Eskista finance verification.',
    ],
    seenBy: [
      'Customer sees payment marked as "Pending Verification".',
      'Eskista finance team sees the payment in the payment verification desk.',
    ],
    rules: [
      '400 if missing receipt file, missing transaction reference, or invalid amount.',
      '401 if not authenticated.',
      '404 if booking not found.',
      '409 if payment already verified or previous submission is pending review.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'method', 'transactionReference', 'amountMinor'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Telebirr screenshot or bank confirmation. Max 10 MB.',
        },
        method: { type: 'string', enum: Object.values(PaymentMethod), example: 'TELEBIRR' },
        transactionReference: { type: 'string', example: 'TBR8842190XZ' },
        amountMinor: {
          type: 'integer',
          description: 'Minor units. ETB 15,000 is 1500000.',
          example: 1500000,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Recorded and awaiting verification.',
    schema: {
      example: {
        id: '9e4eb9cd-f86d-475c-8883-72bdd80935fb',
        status: 'SUBMITTED',
        submittedAt: '2026-08-16T14:15:00.000Z',
      },
    },
  })
  @ApiConflictResponse({
    description: 'Still under review, already paid, or the booking is closed.',
  })
  submitPayment(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: SubmitPaymentDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<{ id: string; status: string; submittedAt: string }> {
    return this.lifecycle.submitPayment(userId, reference, dto, file);
  }

  // ── Talent completion ──────────────────────────────────────────────────────

  @Post('complete-service')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Confirm the talent delivered',
    does: 'Confirms satisfactory completion of creative talent services for a talent engagement booking.',
    behind: [
      'Transitions talent booking status to RENTAL_COMPLETED.',
      'Records customer completion confirmation in the booking timeline.',
      'Triggers talent settlement payout preparation by Eskista.',
    ],
    seenBy: [
      'Customer sees the booking marked as completed and is invited to rate the talent.',
      'Talent is notified that the customer confirmed delivery.',
    ],
    rules: [
      '400 if called on an equipment booking instead of a talent booking.',
      '401 if not authenticated.',
      '404 if booking not found.',
      '409 if the engagement has not started yet.',
    ],
  })
  @ApiOkResponse({ schema: { example: { status: 'RENTAL_COMPLETED' } } })
  @ApiConflictResponse({ description: 'The engagement has not started yet.' })
  completeService(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<{ status: string }> {
    return this.lifecycle.completeService(userId, reference);
  }

  // ── Reference files ────────────────────────────────────────────────────────

  @Post('attachments')
  @UseInterceptors(FilesInterceptor('files', 10))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Attach reference files to a talent request',
    does: 'Uploads moodboards, scripts, or project briefs (up to 10 files) for an open talent hire request.',
    behind: [
      'Uploads files into secure storage and links them to the Booking record.',
      'Allows up to 10 files, max 10 MB each.',
    ],
    seenBy: [
      'Customer sees the uploaded documents list in the References step.',
      'Invited talents see the project references.',
    ],
    rules: [
      '400 if not a talent request, file exceeds 10 MB, or unsupported format.',
      '401 if not authenticated.',
      '404 if booking not found.',
      '409 if engagement is already confirmed.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Up to 10 files, 10 MB each.',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: [AttachmentResponse], description: 'The files just added.' })
  @ApiConflictResponse({ description: 'The engagement is already confirmed.' })
  addAttachments(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @UploadedFilesParam() files: UploadedFile[] | undefined,
  ): Promise<AttachmentResponse[]> {
    return this.lifecycle.addAttachments(userId, reference, files ?? []);
  }

  @Get('attachments')
  @ApiEndpoint({
    summary: 'List the reference files on a request',
    does: 'Returns all uploaded reference files attached to a talent hire request in chronological order.',
    behind: [
      'Queries attachments linked to the talent booking reference.',
    ],
    seenBy: [
      'Customer sees the reference files list on the booking screen.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking not found.',
    ],
  })
  @ApiOkResponse({ type: [AttachmentResponse] })
  listAttachments(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<AttachmentResponse[]> {
    return this.lifecycle.listAttachments(userId, reference);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam(ATTACHMENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Remove a reference file',
    does: 'Removes an uploaded reference file from a talent hire request prior to confirmation.',
    behind: [
      'Deletes the attachment record and underlying file from storage.',
    ],
    seenBy: [
      'Customer sees file removed from the references list.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if attachment or booking not found.',
      '409 if engagement is already confirmed.',
    ],
  })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiConflictResponse({ description: 'The engagement is already confirmed.' })
  removeAttachment(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<void> {
    return this.lifecycle.removeAttachment(userId, reference, attachmentId);
  }

  // ── Tracking ───────────────────────────────────────────────────────────────

  @Get('tracking')
  @ApiEndpoint({
    summary: 'Track the courier',
    does: 'Returns real-time courier delivery or return transit status, courier contact, vehicle details, and ETA.',
    behind: [
      'Queries active fulfilment record (outbound delivery or return).',
      'Derives courier details, vehicle plate, sub-tracker progress, and live tracking status.',
    ],
    seenBy: [
      'Customer sees the "Track Your Equipment" screen with Call Courier button and ETA.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking not found.',
    ],
  })
  @ApiOkResponse({ type: TrackingResponse })
  getTracking(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<TrackingResponse> {
    return this.lifecycle.getTracking(userId, reference);
  }

  // ── Return ─────────────────────────────────────────────────────────────────

  @Get('return-options')
  @ApiEndpoint({
    summary: 'Return slots and instructions',
    does: 'Returns available equipment return slots, packing instructions, and suggested pickup address.',
    behind: [
      'Computes eligible return time slots based on return deadline.',
      'Retrieves platform return instructions and original delivery location.',
    ],
    seenBy: [
      'Customer sees the Return Equipment picker with selectable time slots and return guide.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking not found.',
    ],
  })
  @ApiOkResponse({ type: ReturnOptionsResponse })
  getReturnOptions(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<ReturnOptionsResponse> {
    return this.lifecycle.getReturnOptions(userId, reference);
  }

  @Post('return')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Arrange the return',
    does: 'Schedules equipment return via Eskista courier collection or customer hub drop-off.',
    behind: [
      'Records return arrangement (SCHEDULED_PICKUP or DROP_OFF) and scheduled timestamp.',
      'Updates booking status to RETURN_SCHEDULED.',
      'Dispatches pickup task to Eskista courier dispatch operations.',
    ],
    seenBy: [
      'Customer sees return confirmed and can track return courier status.',
      'Hub operations see incoming return in the logistics schedule.',
    ],
    rules: [
      '400 if missing address for scheduled pickup or invalid time slot.',
      '401 if not authenticated.',
      '404 if booking not found.',
      '409 if equipment has not yet been delivered to the customer.',
    ],
  })
  @ApiOkResponse({
    type: ReturnOptionsResponse,
    description: 'The refreshed options, reflecting what was just booked.',
  })
  @ApiConflictResponse({ description: 'The equipment is not with you yet.' })
  scheduleReturn(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ScheduleReturnDto,
  ): Promise<ReturnOptionsResponse> {
    return this.lifecycle.scheduleReturn(userId, reference, dto);
  }

  // ── Incidents ──────────────────────────────────────────────────────────────

  @Post('incidents')
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Report an issue',
    does: 'Submits an incident report regarding damaged equipment, late delivery, or missing items directly to Eskista mediation.',
    behind: [
      'Creates Incident record linked to the booking with incident reference (e.g. ESK-INC-00042).',
      'Stores up to 6 photo attachments in private storage.',
      'Alerts Eskista mediation and grievance desk.',
    ],
    seenBy: [
      'Customer sees incident report reference and status in their booking records.',
      'Eskista mediation team receives the report in the admin grievance desk.',
    ],
    rules: [
      '400 if photos exceed 6 items, oversize, or invalid mime type.',
      '401 if not authenticated.',
      '404 if booking not found.',
      '409 if booking is not yet confirmed.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'phase', 'description'],
      properties: {
        type: {
          type: 'string',
          enum: Object.values(IncidentType),
          description: 'The "Issue type" chips.',
          example: IncidentType.PHYSICAL_DAMAGE,
        },
        phase: {
          type: 'string',
          enum: Object.values(IncidentPhase),
          description: 'The "When did this occur?" radios.',
          example: IncidentPhase.DURING_RENTAL,
        },
        description: { type: 'string', example: 'The lens hood cracked on the second day.' },
        photos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Up to 6 images, 5 MB each.',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: IncidentResponse })
  @ApiConflictResponse({ description: 'The booking is not confirmed yet.' })
  reportIncident(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ReportIncidentDto,
    @UploadedFilesParam() photos: UploadedFile[] | undefined,
  ): Promise<IncidentResponse> {
    return this.lifecycle.reportIncident(userId, reference, dto, photos ?? []);
  }

  @Get('incidents')
  @ApiEndpoint({
    summary: 'List issues I reported on this booking',
    does: 'Returns all incident reports submitted for this booking along with status and Eskista resolution.',
    behind: [
      'Queries all incidents for this booking ordered by creation date descending.',
    ],
    seenBy: [
      'Customer views reported incidents and resolutions on the booking detail screen.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if booking not found.',
    ],
  })
  @ApiOkResponse({ type: [IncidentResponse] })
  listIncidents(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<IncidentResponse[]> {
    return this.lifecycle.listIncidents(userId, reference);
  }

  // ── Review ─────────────────────────────────────────────────────────────────

  @Post('review')
  @ApiEndpoint({
    summary: 'Rate the completed booking',
    does: 'Submits a 1-to-5 star rating and optional feedback review for completed equipment rentals or talent engagements.',
    behind: [
      'Creates Review record for the booking.',
      'Recomputes average rating and review count on the listing and vendor or talent profile atomically.',
      'Marks the booking as reviewed.',
    ],
    seenBy: [
      'Customer sees their review reflected on the booking.',
      'Public catalogue reflects the updated star rating and review list.',
    ],
    rules: [
      '400 if rating is not an integer between 1 and 5.',
      '401 if not authenticated.',
      '404 if booking not found.',
      '409 if booking is not completed or has already been reviewed.',
    ],
  })
  @ApiCreatedResponse({ type: ReviewResponse })
  @ApiConflictResponse({ description: 'Not completed yet, or already rated.' })
  submitReview(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: SubmitReviewDto,
  ): Promise<ReviewResponse> {
    return this.lifecycle.submitReview(userId, reference, dto);
  }
}
