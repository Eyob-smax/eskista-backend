import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { UploadedFile } from '../../common/upload';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  CustomerAgreementBodyResponse,
  CustomerAgreementResponse,
  DeclineAgreementDto,
  UploadSignedCopyDto,
} from '../customer-bookings/dto/lifecycle.dto';
import { ConfirmReceiptDto } from '../vendor-bookings/dto/vendor-booking.dto';
import {
  DeclineRequestDto,
  HireRequestResponse,
  ListHireRequestsQuery,
} from '../hiring/dto/hiring.dto';
import {
  EngagementCardResponse,
  EngagementDetailResponse,
  ListEngagementsQuery,
  TalentCompletionResponse,
  TalentCvResponse,
  TalentDashboardResponse,
  TalentEarningsResponse,
} from './dto/talent-work.dto';
import { TalentWorkService } from './talent-work.service';

const PDF_HEADERS = (filename: string) => ({
  'Content-Type': 'application/pdf',
  'Content-Disposition': `attachment; filename="${filename}"`,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
});

@ApiTags('talent · work')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@Roles('TALENT')
@Controller({ path: 'talent', version: '1' })
export class TalentWorkController {
  constructor(private readonly work: TalentWorkService) {}

  // ── Home ───────────────────────────────────────────────────────────────────

  @Get('me/dashboard')
  @ApiOperation({
    summary: 'Talent home screen',
    description: `
Everything on **Home**: the greeting, **This month** earnings, **Profile views**,
**Pending Requests**, the **N new opportunities** banner, **Profile completion** with
Complete Profile, and the **Hire Requests** list.

- *Pending* = requests waiting on the talent's answer. *New opportunities* = the subset not
  yet opened. Opening one (\`GET /talent/requests/{id}\`) makes it no longer new.
- *This month* = the talent's own earnings from confirmed engagements starting this month.
- *Profile views* counts clients opening the public profile, never the talent's own views.
`.trim(),
  })
  @ApiOkResponse({ type: TalentDashboardResponse })
  dashboard(@CurrentUser('id') userId: string): Promise<TalentDashboardResponse> {
    return this.work.dashboard(userId);
  }

  @Get('me/earnings')
  @ApiOperation({
    summary: 'My earnings',
    description: `
The **Earnings** tab. Every amount is what the talent is paid — their own rate in full.

| status | Meaning |
|---|---|
| \`UPCOMING\` | Confirmed (client has paid), not yet done |
| \`PENDING\` | Done, waiting for Eskista to pay out |
| \`PAID\` | Paid out |

Engagements still awaiting the client's payment are not counted: nobody has committed that
money yet.
`.trim(),
  })
  @ApiOkResponse({ type: TalentEarningsResponse })
  earnings(@CurrentUser('id') userId: string): Promise<TalentEarningsResponse> {
    return this.work.earnings(userId);
  }

  @Get('me/cv')
  @ApiOperation({
    summary: 'My CV (preview)',
    description:
      'The auto-generated CV, "built from what you entered", in the chosen `cvTemplate`. ' +
      'Includes contact details because it is the talent’s own copy; the client-facing CV ' +
      'never does.',
  })
  @ApiOkResponse({ type: TalentCvResponse })
  cv(@CurrentUser('id') userId: string): Promise<TalentCvResponse> {
    return this.work.cv(userId);
  }

  @Get('me/cv.pdf')
  @ApiOperation({ summary: 'Download my CV as PDF', description: 'In the chosen template.' })
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async cvPdf(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.work.cvPdf(userId);
    res.set(PDF_HEADERS(filename));
    return new StreamableFile(buffer);
  }

  // ── Hire requests ──────────────────────────────────────────────────────────

  @Get('requests')
  @ApiOperation({
    summary: 'My hire requests',
    description: `
The **Requests** tab: every client request the talent was invited to.

A request shows the brief, project type, dates and times, city, headcount, the client's
budget and \`yourEarningsMinor\` — exactly what the talent would be paid at their own rate.
**It never shows who the client is**: talents and clients each deal with Eskista.

\`status\` is the talent's side of it:

| status | Label | Next |
|---|---|---|
| \`INVITED\` | Request Received | Accept or Decline within \`hoursToRespond\` (48 h) |
| \`ACCEPTED\` | Accepted — waiting for the client | Withdraw, or wait |
| \`HIRED\` | Hired | Open \`engagementReference\` under Bookings |
| \`REJECTED\` | Not selected | — the client hired someone else |
| \`DECLINED\` / \`EXPIRED\` / \`WITHDRAWN\` / \`CANCELLED\` | | — |
`.trim(),
  })
  @ApiOkResponse({ type: [HireRequestResponse] })
  listRequests(
    @CurrentUser('id') userId: string,
    @Query() query: ListHireRequestsQuery,
  ): Promise<HireRequestResponse[]> {
    return this.work.listRequests(userId, query);
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'Open a hire request',
    description: 'The request detail. The first open marks it seen (`isNew: false`).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The invitation id.' })
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiNotFoundResponse()
  getRequest(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HireRequestResponse> {
    return this.work.getRequest(userId, id);
  }

  @Post('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a hire request',
    description: `
Says yes. The client is told and chooses among everyone who accepted (they have 72 hours
from the first acceptance). If the client asked to hire the first to accept, this hires
the talent immediately and \`status\` comes back \`HIRED\`.

**409** if it has expired, was already answered, the request closed, or the talent is
booked or has blocked any of those dates.
`.trim(),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiConflictResponse({ description: 'Expired, answered, closed, or a date clash.' })
  accept(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HireRequestResponse> {
    return this.work.accept(userId, id);
  }

  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline a hire request',
    description: 'The reason is optional and shown to Eskista only.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiConflictResponse({ description: 'Expired, already answered, or closed.' })
  decline(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineRequestDto,
  ): Promise<HireRequestResponse> {
    return this.work.decline(userId, id, dto.reason);
  }

  @Post('requests/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Withdraw an acceptance',
    description:
      'Before the client has chosen. Once hired, pulling out is a cancellation and goes ' +
      'through Eskista (**409**).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiConflictResponse({ description: 'Not accepted, or already hired.' })
  withdraw(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineRequestDto,
  ): Promise<HireRequestResponse> {
    return this.work.withdraw(userId, id, dto.reason);
  }

  // ── Engagements ────────────────────────────────────────────────────────────

  @Get('bookings')
  @ApiOperation({
    summary: 'My engagements',
    description:
      'The **Bookings** tab: requests the talent was hired for. Each is its own booking ' +
      'with its own reference.',
  })
  @ApiOkResponse({ type: [EngagementCardResponse] })
  listEngagements(
    @CurrentUser('id') userId: string,
    @Query() query: ListEngagementsQuery,
  ): Promise<EngagementCardResponse[]> {
    return this.work.listEngagements(userId, query);
  }

  @Get('bookings/:reference')
  @ApiOperation({
    summary: 'One engagement',
    description: `
The engagement detail with the same six-step timeline the client sees (Request Submitted →
Talent Confirmation → Payment → Booking Confirmed → Project / Hire → Completed), the client's
reference files, the talent's agreement and what they are paid.

The venue shows once hired; **access notes unlock once the client has paid**
(\`locationNotesLocked\`). The client's identity is never included — use **Contact Eskista**.
`.trim(),
  })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({ type: EngagementDetailResponse })
  @ApiNotFoundResponse()
  getEngagement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<EngagementDetailResponse> {
    return this.work.getEngagement(userId, reference);
  }

  @Post('bookings/:reference/payout/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm Payment',
    description:
      '"Could you please confirm that you’ve received your payment?" `confirmed: true`: ' +
      '**Payment Received!** — complete the booking now, or it closes automatically in 24 ' +
      'hours. `false` (Not-Confirmed) alerts Eskista. Open once Eskista has paid out.',
  })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({ type: TalentCompletionResponse })
  @ApiConflictResponse({ description: 'Not paid out yet, or already confirmed.' })
  confirmPayout(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ConfirmReceiptDto,
  ): Promise<TalentCompletionResponse> {
    return this.work.confirmPayout(userId, reference, dto.confirmed, dto.note);
  }

  @Post('bookings/:reference/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete the booking',
    description: 'Closes a settled engagement once the payout is confirmed.',
  })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({ type: EngagementDetailResponse })
  @ApiConflictResponse({ description: 'Payout not confirmed, or not settled.' })
  complete(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<EngagementDetailResponse> {
    return this.work.complete(userId, reference);
  }

  @Get('bookings/:reference/settlement-record.pdf')
  @ApiOperation({ summary: 'Settlement Record (PDF)', description: 'What you were paid for it.' })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async settlementPdf(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.work.settlementPdf(userId, reference);
    res.set(PDF_HEADERS(filename));
    return new StreamableFile(buffer);
  }

  @Get('bookings/:reference/agreement')
  @ApiOperation({
    summary: 'My agreement for an engagement',
    description: `
The Eskista ↔ Talent agreement, issued when the talent is hired, with its frozen text.

Signed on paper: **Download Agreement (PDF)**, sign by hand, **Upload Scanned Agreement**.
\`AWAITING_UPLOAD → UNDER_REVIEW → APPROVED\`, exactly as on the client side. It names the
project and the talent's fee — never the client.
`.trim(),
  })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({ type: CustomerAgreementBodyResponse })
  @ApiNotFoundResponse()
  getAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<CustomerAgreementBodyResponse> {
    return this.work.getAgreement(userId, reference);
  }

  @Get('bookings/:reference/agreement/pdf')
  @ApiOperation({ summary: 'Download my agreement as a PDF' })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async agreementPdf(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.work.agreementPdf(userId, reference);
    res.set(PDF_HEADERS(filename));
    return new StreamableFile(buffer);
  }

  @Post('bookings/:reference/agreement/signed-copy')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload my signed agreement',
    description:
      'The scan of the hand-signed agreement. PNG, JPEG, WebP or PDF, up to 10 MB. Moves it ' +
      'to `UNDER_REVIEW`; re-uploading over a rejected scan is expected.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'signerName'],
      properties: {
        file: { type: 'string', format: 'binary' },
        signerName: { type: 'string', example: 'Dawit Bekele' },
        signerPhone: { type: 'string', example: '+251911223344' },
      },
    },
  })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({ type: CustomerAgreementResponse })
  @ApiConflictResponse({ description: 'Already approved, or under review.' })
  uploadSignedAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: UploadSignedCopyDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<CustomerAgreementResponse> {
    return this.work.uploadSignedAgreement(userId, reference, dto, file);
  }

  @Post('bookings/:reference/agreement/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline my agreement',
    description: 'Tells Eskista the talent will not sign. Eskista follows up.',
  })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-1004' })
  @ApiOkResponse({ type: CustomerAgreementResponse })
  declineAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: DeclineAgreementDto,
  ): Promise<CustomerAgreementResponse> {
    return this.work.declineAgreement(userId, reference, dto.reason);
  }
}
