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
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import type { Paginated } from '../../../common/dto/pagination.dto';
import { AdminReviewService } from '../../admin-review/admin-review.service';
import { ApproveDto, RejectDto } from '../../admin-review/dto/admin-review.dto';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { PDF_CONTENT, sendPdf } from '../core/admin-http';
import {
  AdminTalentQuery,
  RegisterTalentDto,
  RegisteredTalentResponse,
  SuspendTalentDto,
  TalentAdminProfileResponse,
  TalentKpisResponse,
  TalentRosterRowResponse,
} from './admin-talent.dto';
import { AdminTalentService } from './admin-talent.service';

const TALENT_ID = { name: 'id', format: 'uuid', description: 'The talent profile id.' };

@ApiTags('admin · talent roster')
@AdminAccess()
@Controller({ path: 'admin/talent', version: '1' })
export class AdminTalentController {
  constructor(
    private readonly talent: AdminTalentService,
    private readonly review: AdminReviewService,
  ) {}

  @Get()
  @ApiEndpoint({
    summary: 'Roster & Profiles',
    does: 'Every talent, newest first. `availability=BOOKED` is booked today.',
    behind: ["Read only. Availability is derived from today's active bookings."],
  })
  @ApiPaginatedResponse(TalentRosterRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminTalentQuery): Promise<Paginated<TalentRosterRowResponse>> {
    return this.talent.list(query);
  }

  @Get('kpis')
  @ApiEndpoint({
    summary: 'Talent Marketplace Management tiles',
    does: 'Active talent, pending applications, booked today, total completed engagements.',
    behind: ['Read only. Four counts over the talent-profile and booking tables.'],
  })
  @ApiOkResponse({ type: TalentKpisResponse })
  @ApiStandardErrors()
  kpis(): Promise<TalentKpisResponse> {
    return this.talent.kpis();
  }

  @Post()
  @ApiEndpoint({
    summary: 'Register New Talent',
    does: 'For someone not on Eskista yet. Returns a claim code: the person enters it in the Mini App (`POST /talent/claim`) to take the profile over with their Telegram account.',
    behind: [
      'A placeholder user is created with the TALENT role and a talent profile holding the display name, professions, phone and bio.',
      'A random 8-character claim code is generated and stored.',
      'Admin audit log written.',
    ],
    seenBy: ['The talent: once they claim it, the profile is theirs.'],
    rules: ['400 when a field is invalid — e.g. no profession.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiOkResponse({ type: RegisteredTalentResponse })
  @ApiStandardErrors({ badRequest: 'A field is invalid — e.g. no profession.' })
  register(
    @CurrentUser('id') adminId: string,
    @Body() dto: RegisterTalentDto,
  ): Promise<RegisteredTalentResponse> {
    return this.talent.register(adminId, dto);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Talent profile, as Eskista sees it',
    does: "Everything the talent filled in, plus Eskista's side: commission, the client price, the payout channel and what is still to be paid, documents, references, reviews, bookings.",
    behind: [
      'Read only. Includes services, portfolio, experience, education, references, documents, the onboarding checklist, reviews, upcoming bookings and payout accounts.',
    ],
    rules: ['404 when not found.'],
  })
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ type: TalentAdminProfileResponse })
  @ApiStandardErrors({ notFound: 'Talent not found' })
  profile(@Param('id', ParseUUIDPipe) id: string): Promise<TalentAdminProfileResponse> {
    return this.talent.profile(id);
  }

  @Get(':id/cv.pdf')
  @ApiEndpoint({
    summary: 'The talent CV, contact details included',
    does: "A PDF CV rendered from the profile — phone and email included for Eskista's records.",
    behind: ['Rendered on demand from the talent profile. Nothing is stored.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ description: 'The PDF.', content: PDF_CONTENT })
  @ApiStandardErrors({ notFound: 'Talent not found' })
  async cv(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.talent.cvPdf(id);
    return sendPdf(res, buffer, filename);
  }

  @Post(':id/verify')
  @ApiEndpoint({
    summary: 'Verify and Activate Profile',
    does: 'Approves a pending talent application. Commission is pre-filled with the default; pass `commissionRateBps` to change it.',
    behind: [
      'Talent status → VERIFIED; commission rate stored on the profile.',
      "The talent's services become visible to clients.",
      'Notification: talent — Your Profile Is Verified.',
      'Admin audit log written.',
    ],
    seenBy: ['Talent: they can now receive invitations and be hired.'],
    rules: [
      '404 when not found.',
      '409 when the talent cannot be approved yet (`blockers` lists why).',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ type: TalentAdminProfileResponse })
  @ApiStandardErrors({
    notFound: 'Talent not found',
    conflict: 'This talent cannot be approved yet (`blockers` lists why)',
  })
  async verify(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
  ): Promise<TalentAdminProfileResponse> {
    await this.review.approveTalent(adminId, id, dto);
    return this.talent.profile(id);
  }

  @Post(':id/reject')
  @ApiEndpoint({
    summary: 'Reject Request — the reason goes to the talent',
    does: 'Rejects a pending application with a reason.',
    behind: [
      'Talent status back to draft; notification sent with the reason.',
      'Admin audit log written.',
    ],
    seenBy: ['Talent: "Your application needs attention" with the reason.'],
    rules: [
      '400 when `reason` is missing or too short.',
      '404 when not found.',
      '409 when only a talent awaiting review can be rejected.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ type: TalentAdminProfileResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Talent not found',
    conflict: 'Only a talent awaiting review can be rejected',
  })
  async reject(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ): Promise<TalentAdminProfileResponse> {
    await this.review.rejectTalent(adminId, id, dto);
    return this.talent.profile(id);
  }

  @Post(':id/suspend')
  @ApiEndpoint({
    summary: 'Suspend Profile — hidden from clients; open bookings go on',
    does: "Suspends the talent's public profile. They stop receiving new invitations, but engagements already under way continue.",
    behind: [
      'Talent status → SUSPENDED; services hidden from search.',
      'Notification: talent — Profile Suspended (with the reason).',
      'Admin audit log written.',
    ],
    rules: ['400 when `reason` is missing.', '404 when not found.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ type: TalentAdminProfileResponse })
  @ApiStandardErrors({ badRequest: '`reason` missing.', notFound: 'Talent not found' })
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendTalentDto,
  ): Promise<TalentAdminProfileResponse> {
    return this.talent.suspend(adminId, id, dto.reason);
  }

  @Post(':id/reactivate')
  @ApiEndpoint({
    summary: 'Lift a suspension — back to verified, or to review if never verified',
    does: 'Restores a suspended talent profile.',
    behind: ['Talent status restored; services republished.', 'Admin audit log written.'],
    rules: ['404 when not found.', '409 when only a suspended profile can be reactivated.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ type: TalentAdminProfileResponse })
  @ApiStandardErrors({
    notFound: 'Talent not found',
    conflict: 'Only a suspended profile can be reactivated',
  })
  reactivate(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TalentAdminProfileResponse> {
    return this.talent.reactivate(adminId, id);
  }

  @Post(':id/claim-code')
  @ApiEndpoint({
    summary: 'Issue a fresh claim code for a registered profile',
    does: 'Generates a new claim code, invalidating the old one. For when the first code was lost or expired.',
    behind: [
      'A new random 8-character claim code replaces the old one.',
      'Admin audit log written.',
    ],
    rules: [
      '404 when not found.',
      '409 when this profile already belongs to its talent (it was already claimed).',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ type: RegisteredTalentResponse })
  @ApiStandardErrors({
    notFound: 'Talent not found',
    conflict: 'This profile already belongs to its talent',
  })
  claimCode(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RegisteredTalentResponse> {
    return this.talent.reissueClaim(adminId, id);
  }
}
