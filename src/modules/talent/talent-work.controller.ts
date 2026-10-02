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
  ApiConsumes,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
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

const INVITATION_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'The hire invitation UUID.',
  example: '550e8400-e29b-41d4-a716-446655440010',
};

const TALENT_BOOKING_REF_PARAM = {
  name: 'reference',
  example: 'ESK-TLT-1004',
  description: 'The talent booking reference (e.g. ESK-TLT-1004).',
};

@ApiTags('talent · work')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@Roles('TALENT')
@Controller({ path: 'talent', version: '1' })
export class TalentWorkController {
  constructor(private readonly work: TalentWorkService) {}

  // ── Home ───────────────────────────────────────────────────────────────────

  @Get('me/dashboard')
  @ApiEndpoint({
    summary: 'Talent home screen',
    does: 'Assembles dashboard home data: current month earnings, profile views, pending requests, new opportunities count, and upcoming engagements.',
    behind: [
      'Read only: aggregates earnings for current month, profile pageviews count, and pending hire invitations.',
      'Filters out self-views and resolves upcoming confirmed engagements.',
    ],
    seenBy: [
      'Talent app Home tab: KPI tiles, actionable banners, and pending requests strip.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: TalentDashboardResponse })
  @ApiStandardErrors()
  dashboard(@CurrentUser('id') userId: string): Promise<TalentDashboardResponse> {
    return this.work.dashboard(userId);
  }

  @Get('me/earnings')
  @ApiEndpoint({
    summary: 'My earnings',
    does: 'Returns earnings breakdown (total revenue, today, upcoming, pending payout) and itemized earnings history.',
    behind: [
      'Read only: aggregates confirmed bookings and settlement payout lines for this talent.',
      'Computes net earnings at talent rates in integer minor units (ETB cents).',
    ],
    seenBy: [
      'Earnings tab: overview cards and itemized engagement payouts.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: TalentEarningsResponse })
  @ApiStandardErrors()
  earnings(@CurrentUser('id') userId: string): Promise<TalentEarningsResponse> {
    return this.work.earnings(userId);
  }

  @Get('me/cv')
  @ApiEndpoint({
    summary: 'My CV (preview)',
    does: 'Returns formatted CV content including verified work history, education, portfolio highlights, and contact information for preview.',
    behind: [
      'Read only: formats talent profile data according to selected CvTemplate.',
    ],
    seenBy: [
      'CV Preview screen in talent settings.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: TalentCvResponse })
  @ApiStandardErrors()
  cv(@CurrentUser('id') userId: string): Promise<TalentCvResponse> {
    return this.work.cv(userId);
  }

  @Get('me/cv.pdf')
  @ApiEndpoint({
    summary: 'Download my CV as PDF',
    does: 'Generates and streams a professional PDF document of the talent CV formatted using the active CV template.',
    behind: [
      'Renders HTML CV template with talent data and converts to PDF binary stream.',
    ],
    seenBy: [
      'Triggers browser PDF download.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiStandardErrors()
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
  @ApiEndpoint({
    summary: 'My hire requests',
    does: 'Lists all incoming booking invitations from clients, filterable by status tab.',
    behind: [
      'Read only: queries HireRequest records where talent was invited.',
      'Hides client identity to protect marketplace mediation.',
    ],
    seenBy: [
      'Requests tab: displays invitation cards with response countdown.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: [HireRequestResponse] })
  @ApiStandardErrors()
  listRequests(
    @CurrentUser('id') userId: string,
    @Query() query: ListHireRequestsQuery,
  ): Promise<HireRequestResponse[]> {
    return this.work.listRequests(userId, query);
  }

  @Get('requests/:id')
  @ApiEndpoint({
    summary: 'Open a hire request',
    does: 'Returns details of an invitation (dates, shoot location, budget, role) and marks request as seen (isNew: false).',
    behind: [
      'Queries HireRequest row and marks isNew = false on first access.',
    ],
    seenBy: [
      'Request detail screen.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if request not found.',
    ],
  })
  @ApiParam(INVITATION_ID_PARAM)
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiStandardErrors({ notFound: 'Hire request not found.' })
  getRequest(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HireRequestResponse> {
    return this.work.getRequest(userId, id);
  }

  @Post('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Accept a hire request',
    does: 'Accepts client hire invitation. If request was configured as instant hire for first responder, status immediately moves to HIRED.',
    behind: [
      'Validates request is unexpired and unclosed.',
      'Checks talent calendar for date clashes with confirmed bookings or blocked dates.',
      'Updates invitation status to ACCEPTED (or HIRED if first-accept auto-hire is active).',
      'Notifies client of acceptance.',
    ],
    seenBy: [
      'Updates request status to Accepted or Hired.',
      'Client hiring dashboard: talent appears in accepted candidates list.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if request not found.',
      '409 if invitation expired, closed, or date conflict exists.',
    ],
  })
  @ApiParam(INVITATION_ID_PARAM)
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiStandardErrors({
    notFound: 'Hire request not found.',
    conflict: 'Expired, answered, closed, or a date clash.',
  })
  accept(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HireRequestResponse> {
    return this.work.accept(userId, id);
  }

  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Decline a hire request',
    does: 'Declines an invitation with an optional reason shown to Eskista mediation only.',
    behind: [
      'Updates invitation status to DECLINED and records optional feedback note.',
      'Removes reservation from candidate shortlist.',
    ],
    seenBy: [
      'Removes request from active list.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if request not found.',
      '409 if request already answered or closed.',
    ],
  })
  @ApiParam(INVITATION_ID_PARAM)
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiStandardErrors({
    notFound: 'Hire request not found.',
    conflict: 'Expired, already answered, or closed.',
  })
  decline(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineRequestDto,
  ): Promise<HireRequestResponse> {
    return this.work.decline(userId, id, dto.reason);
  }

  @Post('requests/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Withdraw an acceptance',
    does: 'Withdraws a previously accepted request before client makes a hiring decision.',
    behind: [
      'Verifies status is ACCEPTED and booking has not yet been confirmed by client.',
      'Updates invitation status to WITHDRAWN.',
    ],
    seenBy: [
      'Removes talent from client shortlist.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if request not found.',
      '409 if candidate was already hired or status is not ACCEPTED.',
    ],
  })
  @ApiParam(INVITATION_ID_PARAM)
  @ApiOkResponse({ type: HireRequestResponse })
  @ApiStandardErrors({
    notFound: 'Hire request not found.',
    conflict: 'Not accepted, or already hired.',
  })
  withdraw(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineRequestDto,
  ): Promise<HireRequestResponse> {
    return this.work.withdraw(userId, id, dto.reason);
  }

  // ── Engagements ────────────────────────────────────────────────────────────

  @Get('bookings')
  @ApiEndpoint({
    summary: 'My engagements',
    does: 'Lists bookings where this talent was hired, filterable by engagement stage.',
    behind: [
      'Read only: queries Booking records matching talent profile.',
    ],
    seenBy: [
      'Bookings tab: shows cards with reference, dates, and payment status.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: [EngagementCardResponse] })
  @ApiStandardErrors()
  listEngagements(
    @CurrentUser('id') userId: string,
    @Query() query: ListEngagementsQuery,
  ): Promise<EngagementCardResponse[]> {
    return this.work.listEngagements(userId, query);
  }

  @Get('bookings/:reference')
  @ApiEndpoint({
    summary: 'One engagement',
    does: 'Returns booking details including 6-step timeline, client reference files, location instructions (unlocked after payment), and agreement status.',
    behind: [
      'Read only: resolves booking by human reference (ESK-TLT-1004).',
      'Enforces location access privacy: locationNotes locked until booking is paid.',
    ],
    seenBy: [
      'Booking Detail screen.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if engagement not found.',
    ],
  })
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({ type: EngagementDetailResponse })
  @ApiStandardErrors({ notFound: 'Engagement booking not found.' })
  getEngagement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<EngagementDetailResponse> {
    return this.work.getEngagement(userId, reference);
  }

  @Post('bookings/:reference/payout/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Confirm Payment',
    does: 'Talent confirms or disputes receipt of engagement payout disbursed by Eskista.',
    behind: [
      'Validates booking is at SETTLED phase with a disbursed payout.',
      'If confirmed = true, marks payout as confirmed and initiates 24h automatic closure.',
      'If confirmed = false, raises escalation flag for Eskista finance support.',
    ],
    seenBy: [
      'Displays Payment Received celebration screen and unlocks Complete Booking.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if booking not found.',
      '409 if payout has not been sent or was already confirmed.',
    ],
  })
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({ type: TalentCompletionResponse })
  @ApiStandardErrors({
    notFound: 'Engagement booking not found.',
    conflict: 'Not paid out yet, or already confirmed.',
  })
  confirmPayout(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: ConfirmReceiptDto,
  ): Promise<TalentCompletionResponse> {
    return this.work.confirmPayout(userId, reference, dto.confirmed, dto.note);
  }

  @Post('bookings/:reference/complete')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Complete the booking',
    does: 'Closes a settled engagement once payout has been confirmed.',
    behind: [
      'Transitions Booking status to COMPLETED.',
      'Triggers customer review prompt.',
    ],
    seenBy: [
      'Moves booking to Completed tab.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if booking not found.',
      '409 if payout is not yet confirmed.',
    ],
  })
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({ type: EngagementDetailResponse })
  @ApiStandardErrors({
    notFound: 'Engagement booking not found.',
    conflict: 'Payout not confirmed, or not settled.',
  })
  complete(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<EngagementDetailResponse> {
    return this.work.complete(userId, reference);
  }

  @Get('bookings/:reference/settlement-record.pdf')
  @ApiEndpoint({
    summary: 'Settlement Record (PDF)',
    does: 'Streams PDF settlement statement summarizing earned amount, dates, and payout disbursement details.',
    behind: [
      'Generates settlement record PDF binary.',
    ],
    seenBy: [
      'Triggers browser PDF download.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if booking not found.',
    ],
  })
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiStandardErrors({ notFound: 'Engagement booking not found.' })
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
  @ApiEndpoint({
    summary: 'My agreement for an engagement',
    does: 'Returns the frozen text of the Eskista ↔ Talent contract issued for this engagement.',
    behind: [
      'Read only: fetches Agreement row for this booking and talent.',
    ],
    seenBy: [
      'Agreement preview and signing workflow screen.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if agreement not found.',
    ],
  })
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({ type: CustomerAgreementBodyResponse })
  @ApiStandardErrors({ notFound: 'Agreement not found.' })
  getAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<CustomerAgreementBodyResponse> {
    return this.work.getAgreement(userId, reference);
  }

  @Get('bookings/:reference/agreement/pdf')
  @ApiEndpoint({
    summary: 'Download my agreement as a PDF',
    does: 'Streams PDF of the contract for printing and physical signing.',
    behind: [
      'Generates and streams agreement PDF binary.',
    ],
    seenBy: [
      'Downloads contract PDF to user device.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if agreement not found.',
    ],
  })
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiStandardErrors({ notFound: 'Agreement not found.' })
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
  @ApiEndpoint({
    summary: 'Upload my signed agreement',
    does: 'Uploads a scan or photo of the hand-signed contract (PNG, JPEG, WebP, PDF up to 10 MB).',
    behind: [
      'Validates document upload and stores in private agreement storage.',
      'Updates Agreement status to UNDER_REVIEW and records signer details.',
      'Alerts Eskista agreement review operators.',
    ],
    seenBy: [
      'Updates agreement status badge to Under Review.',
    ],
    rules: [
      '400 if file missing, invalid format, or over 10 MB.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if agreement not found.',
      '409 if agreement is already approved.',
    ],
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
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({ type: CustomerAgreementResponse })
  @ApiStandardErrors({
    badRequest: 'Missing file, invalid format, or over 10 MB.',
    notFound: 'Agreement not found.',
    conflict: 'Already approved, or under review.',
  })
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
  @ApiEndpoint({
    summary: 'Decline my agreement',
    does: 'Notifies Eskista operations that the talent declines the terms of the issued contract.',
    behind: [
      'Records decline status and feedback reason.',
      'Flags booking for urgent operator mediation.',
    ],
    seenBy: [
      'Shows contract declined banner.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if agreement not found.',
    ],
  })
  @ApiParam(TALENT_BOOKING_REF_PARAM)
  @ApiOkResponse({ type: CustomerAgreementResponse })
  @ApiStandardErrors({ notFound: 'Agreement not found.' })
  declineAgreement(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: DeclineAgreementDto,
  ): Promise<CustomerAgreementResponse> {
    return this.work.declineAgreement(userId, reference, dto.reason);
  }
}
