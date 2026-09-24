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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { IncidentPhase, IncidentType, PaymentMethod } from '@prisma/client';
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

@ApiTags('customer · booking lifecycle')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@ApiNotFoundResponse({ description: 'No booking with that reference belongs to you.' })
@ApiParam({ name: 'reference', example: 'ESK-10482', description: 'The booking reference.' })
@Controller({ path: 'customer/bookings/:reference', version: '1' })
export class BookingLifecycleController {
  constructor(private readonly lifecycle: BookingLifecycleService) {}

  // ── Agreements ─────────────────────────────────────────────────────────────

  @Get('agreements')
  @ApiOperation({
    summary: 'List the agreements on this booking',
    description: `
Usually one — the Eskista ↔ Customer rental agreement for this booking.

\`awaitingCustomer\` is the flag to branch on: it is true while the next move is theirs,
covering both "never uploaded" and "rejected, upload a better scan". \`statusLabel\` gives
the status pill text already worded.
`.trim(),
  })
  @ApiOkResponse({ type: [CustomerAgreementResponse] })
  listAgreements(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<CustomerAgreementResponse[]> {
    return this.lifecycle.listAgreements(userId, reference);
  }

  @Get('agreements/:agreementId')
  @ApiOperation({
    summary: 'Read one agreement in full',
    description: `
Returns the contract text exactly as frozen when it was issued, plus \`documentUrl\` for
the **Download Agreement (PDF)** button.

**Render \`body\`, do not re-render from a template.** \`contentHash\` is the SHA-256 of
these exact bytes; anything regenerated later would not match, and the hash is what proves
what was agreed if it is ever disputed.

\`governedBy\` is "Ethiopian Law", for the agreement header.
`.trim(),
  })
  @ApiParam({ name: 'agreementId', format: 'uuid' })
  @ApiOkResponse({ type: CustomerAgreementBodyResponse })
  getAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
  ): Promise<CustomerAgreementBodyResponse> {
    return this.lifecycle.getAgreement(userId, reference, agreementId);
  }

  @Get('agreements/:agreementId/pdf')
  @ApiOperation({
    summary: 'Download the agreement as a PDF',
    description: `
Backs **Download Agreement (PDF)**.

Streams an A4 contract with the header block, the full clause text, a signature line for
each party, and the content hash in the footer. Print it, sign it by hand, then upload the
scan through \`POST .../signed-copy\`.

Rendered on demand from the **frozen body**, never re-rendered from the template — so the
PDF always matches the \`contentHash\` that was issued. The hash is printed on the page so
a signed paper copy can be checked against the bytes the parties agreed to.

Returns \`application/pdf\` as an attachment.
`.trim(),
  })
  @ApiParam({ name: 'agreementId', format: 'uuid' })
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
      // A contract is not something to leave in a shared cache.
      'Cache-Control': 'private, no-store',
    });

    return new StreamableFile(buffer);
  }

  @Post('agreements/:agreementId/signed-copy')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload the signed agreement',
    description: `
Backs **Upload Scanned Agreement**.

Contracts are signed on paper: download, print, sign by hand, photograph or scan, upload
here. There is no signature pad — that flow was replaced in September 2026.

The upload moves the agreement to \`UNDER_REVIEW\`. Eskista checks the scan is the right
document, legible, and actually signed, then approves or rejects it.

**Uploading unlocks payment.** Eskista's review runs in parallel rather than holding the
customer up; if the scan is rejected, payment closes again until a replacement is uploaded.

Re-uploading over a \`REJECTED\` scan is expected and clears the previous rejection reason.
Re-uploading over an \`APPROVED\` or \`UNDER_REVIEW\` one returns **409**.

PNG, JPEG, WebP or PDF, up to 10 MB.
`.trim(),
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
  @ApiBadRequestResponse({ description: 'Missing file, unsupported type, or larger than 10 MB.' })
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
  @ApiOperation({
    summary: 'Decline to sign',
    description:
      'Records that the customer will not sign, with their reason. Eskista follows up. ' +
      'An already-approved agreement cannot be declined.',
  })
  @ApiParam({ name: 'agreementId', format: 'uuid' })
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
  @ApiOperation({
    summary: 'Where to send the money, and how much',
    description: `
Everything on the **Complete Payment** screen: the item summary, the amount, and Eskista's
Telebirr and bank details.

**\`amountDueMinor\` is the figure to display.** It is \`totalMinor\` plus the refundable
deposit — the larger of the two totals. Showing the goods-only total here would have the
customer transfer too little.

Either \`telebirr\` or \`bank\` may be null if Eskista has not configured that method;
render only what comes back rather than assuming both exist. These come from platform
settings, so they change without a deploy.

Check \`canSubmit\` before enabling the form. \`blockedReason\` explains a false in language
you can show directly — still under review, already paid, booking closed.
`.trim(),
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
  @ApiOperation({
    summary: 'Submit proof of payment',
    description: `
Backs **Submit Payment**: the receipt upload plus transaction reference and amount.

Payment is offline. This records *evidence* of a transfer — it does not confirm the
booking. Eskista verifies the receipt against their account and moves the booking on
separately, so expect the status to stay put until they do.

**The amount is deliberately not validated against what is owed.** A customer who
transferred the wrong figure needs Eskista to see the receipt and sort it out; rejecting it
here would leave them with money sent and no record of it in the app.

\`transactionReference\` is how Eskista matches the transfer, so a typo delays verification
rather than failing outright.

Returns 409 while an earlier submission is still being verified — one pending receipt at a
time.

PNG, JPEG, WebP or PDF, up to 10 MB.
`.trim(),
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
  @ApiOperation({
    summary: 'Confirm the talent delivered',
    description: `
Backs **Complete Service** on a talent booking.

A talent engagement has nothing to return or inspect, so the customer's confirmation takes
the place of the return-and-inspection steps. The booking moves to \`RENTAL_COMPLETED\`;
Eskista then settles with the talent and closes it, which is what opens the review.

Idempotent — confirming twice returns the same status. Talent bookings only, and only once
the engagement has started.
`.trim(),
  })
  @ApiOkResponse({ schema: { example: { status: 'RENTAL_COMPLETED' } } })
  @ApiBadRequestResponse({ description: 'Not a talent booking.' })
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
  @ApiOperation({
    summary: 'Attach reference files to a talent request',
    description: `
Backs the **References** step of the hire wizard — "Moodboards, briefs, scripts, reference
images, project documents". The step is optional; a request can be submitted with none.

Upload against the draft's \`reference\` as soon as the draft exists, so files survive
the customer leaving the wizard.

PNG, JPEG, WebP, PDF or Word (.docx), up to 10 MB each and 10 per request.

Talent requests only, and only until the engagement is confirmed — after that the brief
is what the talent agreed to work from. The talent sees these as "N files (via Eskista)".
`.trim(),
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
  @ApiBadRequestResponse({
    description: 'Not a talent request, no files, too many, oversize, or wrong type.',
  })
  @ApiConflictResponse({ description: 'The engagement is already confirmed.' })
  addAttachments(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @UploadedFilesParam() files: UploadedFile[] | undefined,
  ): Promise<AttachmentResponse[]> {
    return this.lifecycle.addAttachments(userId, reference, files ?? []);
  }

  @Get('attachments')
  @ApiOperation({ summary: 'List the reference files on a request', description: 'Oldest first.' })
  @ApiOkResponse({ type: [AttachmentResponse] })
  listAttachments(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<AttachmentResponse[]> {
    return this.lifecycle.listAttachments(userId, reference);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a reference file',
    description: 'Only until the engagement is confirmed.',
  })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
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
  @ApiOperation({
    summary: 'Track the courier',
    description: `
Backs **Track Your Equipment**: the status chip, headline, ETA, the courier card with
**Call Courier**, and the four-step sub-tracker.

A deliberately small payload. The booking detail carries the same data, but it is far
heavier and this screen polls. **Poll about every 30 seconds while \`isLive\` is true, and
stop when it turns false** — a delivered booking does not need watching.

Follows the **return** leg once one exists, since by then that is the journey the customer
cares about; \`direction\` says which one you are looking at.

\`courierPhone\` is the courier's own number. The vendor's is never exposed — Eskista
mediates all contact.

Before a courier is assigned, every courier field is null and \`headline\` says delivery has
not been arranged yet. Render that state rather than an empty card.
`.trim(),
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
  @ApiOperation({
    summary: 'Return slots and instructions',
    description: `
Backs the **Return Equipment** screen: the drop-off time picker, the return instructions
list, and the address to pre-fill.

Slots past the return deadline come back with \`available: false\` rather than being
omitted — a customer who has already missed the deadline should see the option greyed out
and understand why, not wonder where it went.

\`suggestedAddress\` is the original delivery address, offered as the default pickup point.
`.trim(),
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
  @ApiOperation({
    summary: 'Arrange the return',
    description: `
Backs **Schedule Pickup** and **Drop Off**.

\`SCHEDULED_PICKUP\` means Eskista collects, and requires an \`address\`. \`DROP_OFF\` means
the customer brings it back themselves.

**Idempotent**: calling it again replaces the existing arrangement rather than creating a
second one. A customer changing their mind is ordinary, and two open return jobs for one
booking would confuse operations.

Moves the booking to \`RETURN_SCHEDULED\`. Only possible once the equipment is actually with
the customer — before that it returns 409.
`.trim(),
  })
  @ApiOkResponse({
    type: ReturnOptionsResponse,
    description: 'The refreshed options, reflecting what was just booked.',
  })
  @ApiConflictResponse({ description: 'The equipment is not with you yet.' })
  @ApiBadRequestResponse({ description: 'Missing address for a pickup, or a malformed slot.' })
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
  @ApiOperation({
    summary: 'Report an issue',
    description: `
Backs **Submit Incident Report**.

**Eskista mediates every incident.** The report goes to them, never to the vendor — the
screen says so and the operating model depends on it. Do not surface vendor contact details
anywhere near this flow.

Up to 6 photos, each PNG, JPEG or WebP up to 5 MB. Photos are optional but make assessment
much faster.

Only possible once the booking is confirmed; there is nothing to report on a request still
under review.

Returns a reference like \`ESK-INC-00042\` that the customer can quote to support.
`.trim(),
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
  @ApiBadRequestResponse({ description: 'Too many photos, or one is oversize or not an image.' })
  reportIncident(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ReportIncidentDto,
    @UploadedFilesParam() photos: UploadedFile[] | undefined,
  ): Promise<IncidentResponse> {
    return this.lifecycle.reportIncident(userId, reference, dto, photos ?? []);
  }

  @Get('incidents')
  @ApiOperation({
    summary: 'List issues I reported on this booking',
    description:
      'Newest first, with the current status and Eskista’s resolution once there is one.',
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
  @ApiOperation({
    summary: 'Rate the completed booking',
    description: `
Backs the **"How was your experience?"** sheet.

Reviews are **one-way**: clients rate equipment and talent, and nobody rates the client.
There is no counterpart endpoint for a vendor to rate a customer.

Only once per booking, and only after it closes — rating equipment still in your hands
rates an experience that has not finished.

Publishing the review recomputes the listing's and the supplier's rating aggregates in the
same transaction, from the reviews themselves rather than by nudging a running average, so
the star count on the catalogue can never disagree with the reviews behind it.
`.trim(),
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
