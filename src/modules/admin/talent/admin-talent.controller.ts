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
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
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
  @ApiOperation({
    summary: 'Roster & Profiles',
    description: 'Every talent, newest first. `availability=BOOKED` is booked today.',
  })
  @ApiPaginatedResponse(TalentRosterRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminTalentQuery): Promise<Paginated<TalentRosterRowResponse>> {
    return this.talent.list(query);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Talent Marketplace Management tiles' })
  @ApiOkResponse({ type: TalentKpisResponse })
  @ApiStandardErrors()
  kpis(): Promise<TalentKpisResponse> {
    return this.talent.kpis();
  }

  @Post()
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Register New Talent',
    description:
      'For someone not on Eskista yet. Returns a claim code: the person enters it in the ' +
      'Mini App (`POST /talent/claim`) to take the profile over with their Telegram account.',
  })
  @ApiOkResponse({ type: RegisteredTalentResponse })
  @ApiStandardErrors({ badRequest: 'A field is invalid — e.g. no profession.' })
  register(
    @CurrentUser('id') adminId: string,
    @Body() dto: RegisterTalentDto,
  ): Promise<RegisteredTalentResponse> {
    return this.talent.register(adminId, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Talent profile, as Eskista sees it',
    description:
      'Everything the talent filled in, plus Eskista’s side: commission, the client price, the ' +
      'payout channel and what is still to be paid, documents, references, reviews, bookings.',
  })
  @ApiParam(TALENT_ID)
  @ApiOkResponse({ type: TalentAdminProfileResponse })
  @ApiStandardErrors({ notFound: 'Talent not found' })
  profile(@Param('id', ParseUUIDPipe) id: string): Promise<TalentAdminProfileResponse> {
    return this.talent.profile(id);
  }

  @Get(':id/cv.pdf')
  @ApiOperation({ summary: 'The talent CV, contact details included' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Verify and Activate Profile',
    description:
      'Commission is pre-filled with the default; pass `commissionRateBps` to change it.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Reject Request — the reason goes to the talent' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Suspend Profile — hidden from clients; open bookings go on' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Lift a suspension — back to verified, or to review if never verified' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Issue a fresh claim code for a registered profile' })
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
