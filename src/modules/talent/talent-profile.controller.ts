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
  Put,
  Query,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import type { UploadedFile } from '../../common/upload';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  BlockDatesDto,
  CreatePortfolioDto,
  CreateTalentProfileDto,
  PortfolioFieldsDto,
  PortfolioResponse,
  ReorderPortfolioDto,
  ReplaceEducationDto,
  ReplaceExperienceDto,
  ReplaceReferencesDto,
  SlugAvailabilityResponse,
  SlugQuery,
  TalentAvailabilityResponse,
  TalentProfileResponse,
  TalentServiceDto,
  TalentServiceResponse,
  UpdateTalentProfileDto,
  UpdateTalentServiceDto,
  UploadIdDocumentDto,
} from './dto/talent-profile.dto';
import { TalentProfileService } from './talent-profile.service';

const PORTFOLIO_BODY = {
  schema: {
    type: 'object',
    properties: {
      cover: { type: 'string', format: 'binary', description: 'Cover image. PNG/JPEG/WebP, 5 MB.' },
      title: { type: 'string', example: 'Abay Fashion Brand Campaign' },
      client: { type: 'string', example: 'Abay Trading' },
      role: { type: 'string', example: 'Director of Photography' },
      startDate: { type: 'string', example: '2026-08-16' },
      endDate: { type: 'string', example: '2026-08-30' },
      description: { type: 'string', example: 'High-end commercial campaign filmed on location' },
      workLink: { type: 'string', example: 'https://youtube.com/watch?v=abc' },
    },
  },
};

const PORTFOLIO_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'The portfolio project UUID.',
  example: '550e8400-e29b-41d4-a716-446655440000',
};

const SERVICE_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'The talent service UUID.',
  example: '550e8400-e29b-41d4-a716-446655440001',
};

const BLOCK_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'The blocked date range UUID.',
  example: '550e8400-e29b-41d4-a716-446655440002',
};

@ApiTags('talent · profile')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@Controller({ path: 'talent', version: '1' })
export class TalentProfileController {
  constructor(private readonly profiles: TalentProfileService) {}

  // ── Onboarding ─────────────────────────────────────────────────────────────

  @Post('onboarding')
  @ApiEndpoint({
    summary: 'Become a creative professional',
    does: 'Creates a draft talent profile, grants the TALENT role, and switches the user activeRole to TALENT.',
    behind: [
      'Verifies account does not already have a talent profile.',
      'Generates unique URL slug from display name if not provided.',
      'Creates TalentProfile row with status DRAFT.',
      'Grants TALENT role membership and updates user activeRole.',
    ],
    seenBy: [
      'Role switcher: adds Creative Professional portal.',
      'Onboarding wizard: advances to step 1 (Basic Details).',
    ],
    rules: [
      '400 if validation fails on display name or location.',
      '401 if unauthenticated.',
      '409 if account already has a talent profile, or slug is taken.',
    ],
  })
  @ApiCreatedResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on display name or location.',
    conflict: 'Already a talent, or the requested URL is taken.',
  })
  onboard(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTalentProfileDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.onboard(userId, dto);
  }

  @Get('slug-availability')
  @ApiEndpoint({
    summary: 'Check a profile URL',
    does: 'Normalises a proposed profile handle and checks whether it is available on eskista.com/talent/<slug>.',
    behind: [
      'Normalises slug input to lowercase alphanumeric with single hyphens.',
      'Checks against reserved system words and existing talent profiles.',
      'Generates up to 3 available suggestions if the requested slug is taken.',
    ],
    seenBy: [
      'Publish step: displays green checkmark or alternative suggestions.',
    ],
    rules: [
      '401 if unauthenticated.',
    ],
  })
  @ApiOkResponse({ type: SlugAvailabilityResponse })
  @ApiStandardErrors()
  slugAvailability(
    @CurrentUser('id') userId: string,
    @Query() query: SlugQuery,
  ): Promise<SlugAvailabilityResponse> {
    return this.profiles.slugAvailability(userId, query.slug);
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  @Get('me')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Get my talent profile',
    does: 'Returns complete talent profile including verification status, progress percentage, completion checklist, portfolio, services, and submit blockers.',
    behind: [
      'Read only: loads TalentProfile with experience, education, references, portfolio, services, and documents.',
      'Calculates dynamic completion percentage and identifies remaining submit blockers.',
    ],
    seenBy: [
      'Talent app: populates the Profile tab, progress header, and review checklist banner.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if no talent profile exists yet.',
    ],
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    forbidden: 'Not a talent. Start with POST /talent/onboarding.',
    notFound: 'No talent profile found.',
  })
  getProfile(@CurrentUser('id') userId: string): Promise<TalentProfileResponse> {
    return this.profiles.getProfile(userId);
  }

  @Patch('me')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Save profile fields',
    does: 'Partially updates talent profile fields. If base rate is modified on an approved profile, automatically sends it back for admin review.',
    behind: [
      'Applies partial update to TalentProfile row.',
      'Replaces array fields (professions, specializations, skills, languages, workingDays) if sent.',
      'If baseRateMinor is changed on an approved profile, reverts status to PENDING_REVIEW and unlists profile.',
    ],
    seenBy: [
      'Profile tab: reflects updated bio, skills, rates, and working days.',
    ],
    rules: [
      '400 if validation fails on updated fields.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '409 if requested profile URL is already taken.',
    ],
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on updated fields.',
    conflict: 'The requested profile URL is taken.',
  })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTalentProfileDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.updateProfile(userId, dto);
  }

  @Post('me/avatar')
  @Roles('TALENT')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Upload my profile picture',
    does: 'Uploads and stores a high-resolution headshot for the talent profile, replacing previous avatar.',
    behind: [
      'Validates image file (PNG, JPEG, WebP, max 5 MB).',
      'Uploads file to public CDN storage.',
      'Updates avatarUrl on TalentProfile and recalculates completion.',
    ],
    seenBy: [
      'Talent cards across marketplace catalogue and hire requests.',
    ],
    rules: [
      '400 if file is missing, unsupported format, or exceeds 5 MB.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Missing file, unsupported format, or file exceeds 5 MB.',
  })
  uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<TalentProfileResponse> {
    return this.profiles.uploadAvatar(userId, file);
  }

  @Put('me/experience')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Save work experience',
    does: 'Replaces the entire list of past work experience items in display order.',
    behind: [
      'Deletes existing Experience rows for this talent and inserts new items.',
      'Recalculates profile completion percentage.',
    ],
    seenBy: [
      'Public profile and CV: populates Experience section.',
    ],
    rules: [
      '400 if validation fails on any item.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on experience items.',
  })
  replaceExperience(
    @CurrentUser('id') userId: string,
    @Body() dto: ReplaceExperienceDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.replaceExperience(userId, dto);
  }

  @Put('me/education')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Save education',
    does: 'Replaces the entire list of academic qualifications and training in display order.',
    behind: [
      'Replaces Education rows for this talent in a single transaction.',
      'Recalculates profile completion percentage.',
    ],
    seenBy: [
      'Public profile and CV: populates Education section.',
    ],
    rules: [
      '400 if validation fails on any item.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on education items.',
  })
  replaceEducation(
    @CurrentUser('id') userId: string,
    @Body() dto: ReplaceEducationDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.replaceEducation(userId, dto);
  }

  @Put('me/references')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Save professional references',
    does: 'Replaces professional client and peer references required for vetting. Stored confidentially for Eskista operations only.',
    behind: [
      'Replaces Reference rows for this talent.',
      'References are checked by Eskista during profile review.',
    ],
    seenBy: [
      'Admin review desk: used during talent verification. Never displayed publicly.',
    ],
    rules: [
      '400 if validation fails.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on references.',
  })
  replaceReferences(
    @CurrentUser('id') userId: string,
    @Body() dto: ReplaceReferencesDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.replaceReferences(userId, dto);
  }

  // ── Portfolio ──────────────────────────────────────────────────────────────

  @Get('me/portfolio')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'List my portfolio projects',
    does: 'Returns all portfolio showcase projects belonging to this talent, in custom display order.',
    behind: [
      'Read only: queries Portfolio items sorted by sortOrder asc.',
    ],
    seenBy: [
      'Portfolio tab: renders project cards with cover images.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: [PortfolioResponse] })
  @ApiStandardErrors()
  listPortfolio(@CurrentUser('id') userId: string): Promise<PortfolioResponse[]> {
    return this.profiles.listPortfolio(userId);
  }

  @Get('me/portfolio/:id')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Get one project',
    does: 'Returns details of a single portfolio project item by UUID.',
    behind: [
      'Read only: fetches Portfolio row matching talent ID and project UUID.',
    ],
    seenBy: [
      'Portfolio item detail and edit modal.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if project not found.',
    ],
  })
  @ApiParam(PORTFOLIO_ID_PARAM)
  @ApiOkResponse({ type: PortfolioResponse })
  @ApiStandardErrors({ notFound: 'Portfolio project not found.' })
  getPortfolioItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PortfolioResponse> {
    return this.profiles.getPortfolioItem(userId, id);
  }

  @Post('me/portfolio')
  @Roles('TALENT')
  @UseInterceptors(FileInterceptor('cover'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Add a project',
    does: 'Creates a new portfolio showcase entry with multipart cover photo. Talents can add up to 5 projects.',
    behind: [
      'Checks that talent has fewer than 5 existing portfolio projects.',
      'Uploads cover image to CDN storage if provided.',
      'Creates Portfolio record and recalculates profile completion.',
    ],
    seenBy: [
      'Portfolio showcase on talent profile.',
    ],
    rules: [
      '400 if validation fails on project fields.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '409 if maximum 5 projects already exist.',
    ],
  })
  @ApiBody(PORTFOLIO_BODY)
  @ApiCreatedResponse({ type: PortfolioResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on project fields.',
    conflict: 'Already five projects.',
  })
  createPortfolioItem(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePortfolioDto,
    @UploadedFileParam() cover: UploadedFile | undefined,
  ): Promise<PortfolioResponse> {
    return this.profiles.createPortfolioItem(userId, dto, cover);
  }

  @Patch('me/portfolio/:id')
  @Roles('TALENT')
  @UseInterceptors(FileInterceptor('cover'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Edit a project',
    does: 'Updates project fields (title, client, role, dates, description, link) and optionally replaces cover image.',
    behind: [
      'Validates project belongs to talent.',
      'If cover file provided, uploads new image and updates coverUrl.',
      'Updates Portfolio record.',
    ],
    seenBy: [
      'Updated portfolio project card.',
    ],
    rules: [
      '400 if input invalid.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if project not found.',
    ],
  })
  @ApiParam(PORTFOLIO_ID_PARAM)
  @ApiBody(PORTFOLIO_BODY)
  @ApiOkResponse({ type: PortfolioResponse })
  @ApiStandardErrors({ notFound: 'Portfolio project not found.' })
  updatePortfolioItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PortfolioFieldsDto,
    @UploadedFileParam() cover: UploadedFile | undefined,
  ): Promise<PortfolioResponse> {
    return this.profiles.updatePortfolioItem(userId, id, dto, cover);
  }

  @Put('me/portfolio/order')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Reorder my portfolio',
    does: 'Updates the display order of all portfolio showcase items.',
    behind: [
      'Updates sortOrder for each portfolio item in a transaction.',
    ],
    seenBy: [
      'Public showcase: items appear in reordered sequence.',
    ],
    rules: [
      '400 if ID list does not match existing portfolio items.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: [PortfolioResponse] })
  @ApiStandardErrors({
    badRequest: 'Invalid project ID list for reordering.',
  })
  reorderPortfolio(
    @CurrentUser('id') userId: string,
    @Body() dto: ReorderPortfolioDto,
  ): Promise<PortfolioResponse[]> {
    return this.profiles.reorderPortfolio(userId, dto.ids);
  }

  @Delete('me/portfolio/:id')
  @Roles('TALENT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Remove a project',
    does: 'Deletes a showcase project item.',
    behind: [
      'Deletes Portfolio row from database.',
      'Recalculates profile completion percentage.',
    ],
    seenBy: [
      'Portfolio tab: project is removed.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if project not found.',
    ],
  })
  @ApiParam(PORTFOLIO_ID_PARAM)
  @ApiNoContentResponse({ description: 'Portfolio project removed.' })
  @ApiStandardErrors({ notFound: 'Portfolio project not found.' })
  deletePortfolioItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.profiles.deletePortfolioItem(userId, id);
  }

  // ── Services ───────────────────────────────────────────────────────────────

  @Get('me/services')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'List my priced services',
    does: 'Returns priced service packages offered by this talent.',
    behind: [
      'Read only: queries TalentService records belonging to talent.',
    ],
    seenBy: [
      'Services list on profile and hiring modal.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: [TalentServiceResponse] })
  @ApiStandardErrors()
  listServices(@CurrentUser('id') userId: string): Promise<TalentServiceResponse[]> {
    return this.profiles.listServices(userId);
  }

  @Post('me/services')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Add a service',
    does: 'Creates a priced service package with rate and pricing model.',
    behind: [
      'Creates TalentService row associated with talent profile.',
      'Recalculates completion percentage.',
    ],
    seenBy: [
      'Talent services list and client booking wizard.',
    ],
    rules: [
      '400 if validation fails on service package fields.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiCreatedResponse({ type: TalentServiceResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on service package fields.',
  })
  createService(
    @CurrentUser('id') userId: string,
    @Body() dto: TalentServiceDto,
  ): Promise<TalentServiceResponse> {
    return this.profiles.createService(userId, dto);
  }

  @Patch('me/services/:id')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Edit a service',
    does: 'Updates title, rate, pricing model, or active status of a service package.',
    behind: [
      'Validates service belongs to talent and updates TalentService row.',
    ],
    seenBy: [
      'Updated service package on profile.',
    ],
    rules: [
      '400 if validation fails.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if service not found.',
    ],
  })
  @ApiParam(SERVICE_ID_PARAM)
  @ApiOkResponse({ type: TalentServiceResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed on service fields.',
    notFound: 'Talent service not found.',
  })
  updateService(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTalentServiceDto,
  ): Promise<TalentServiceResponse> {
    return this.profiles.updateService(userId, id, dto);
  }

  @Delete('me/services/:id')
  @Roles('TALENT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Remove a service',
    does: 'Deletes or archives a service package (deactivates if previously booked).',
    behind: [
      'Deletes TalentService row or sets isActive: false if historical bookings reference it.',
    ],
    seenBy: [
      'Removes package from profile.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if service not found.',
    ],
  })
  @ApiParam(SERVICE_ID_PARAM)
  @ApiNoContentResponse({ description: 'Service package removed.' })
  @ApiStandardErrors({ notFound: 'Talent service not found.' })
  deleteService(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.profiles.deleteService(userId, id);
  }

  // ── Availability ───────────────────────────────────────────────────────────

  @Get('me/availability')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Get my availability',
    does: 'Returns talent working days, day type, blocked date ranges, and confirmed booked engagements.',
    behind: [
      'Read only: aggregates BlockedDates and active booked booking engagements.',
    ],
    seenBy: [
      'Talent calendar view and client availability picker.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiOkResponse({ type: TalentAvailabilityResponse })
  @ApiStandardErrors()
  getAvailability(@CurrentUser('id') userId: string): Promise<TalentAvailabilityResponse> {
    return this.profiles.getAvailability(userId);
  }

  @Post('me/blocked-dates')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Block dates',
    does: 'Marks a date range unavailable to prevent client hiring requests.',
    behind: [
      'Verifies range does not overlap with confirmed bookings.',
      'Inserts BlockedDate record.',
    ],
    seenBy: [
      'Shows as Blocked on talent calendar.',
    ],
    rules: [
      '400 if invalid date range.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '409 if dates conflict with active booked engagement.',
    ],
  })
  @ApiCreatedResponse({ type: TalentAvailabilityResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid date range.',
    conflict: 'Already hired on some of those dates.',
  })
  blockDates(
    @CurrentUser('id') userId: string,
    @Body() dto: BlockDatesDto,
  ): Promise<TalentAvailabilityResponse> {
    return this.profiles.blockDates(userId, dto);
  }

  @Delete('me/blocked-dates/:id')
  @Roles('TALENT')
  @ApiEndpoint({
    summary: 'Unblock dates',
    does: 'Removes a previously blocked date range, making dates available again.',
    behind: [
      'Deletes BlockedDate record belonging to this talent.',
    ],
    seenBy: [
      'Dates become available on calendar.',
    ],
    rules: [
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '404 if blocked date record not found.',
    ],
  })
  @ApiParam(BLOCK_ID_PARAM)
  @ApiOkResponse({ type: TalentAvailabilityResponse })
  @ApiStandardErrors({ notFound: 'Blocked date record not found.' })
  unblockDates(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TalentAvailabilityResponse> {
    return this.profiles.unblockDates(userId, id);
  }

  // ── Verification ───────────────────────────────────────────────────────────

  @Post('me/id-document')
  @Roles('TALENT')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Upload my ID or passport',
    does: 'Uploads identity verification document (Fayda ID or Ethiopian passport) for review.',
    behind: [
      'Validates document type and file format (PDF, PNG, JPEG, WebP under 5 MB).',
      'Uploads to secure private document vault.',
      'Creates or updates TalentDocument row with status PENDING.',
    ],
    seenBy: [
      'Pending verification checklist: marks Identity check as submitted.',
    ],
    rules: [
      '400 if file is missing, unsupported format, or exceeds 5 MB.',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: ['FAYDA_ID', 'PASSPORT'] },
      },
    },
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Missing file or type, unsupported, or over 5 MB.',
  })
  uploadIdDocument(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadIdDocumentDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<TalentProfileResponse> {
    return this.profiles.uploadIdDocument(userId, dto.type, file);
  }

  @Post('me/submit')
  @Roles('TALENT')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Submit my profile for review',
    does: 'Submits completed talent profile for Eskista staff review and directory approval.',
    behind: [
      'Validates that all profile completion requirements are fulfilled (3+ projects, ID, 2 references, rate, bio).',
      'Transitions profile status from DRAFT to PENDING_REVIEW.',
      'Queues review checklist rows (identity in progress, portfolio and references queued).',
      'Alerts Eskista talent review team.',
    ],
    seenBy: [
      'Switches talent UI to Pending Verification state with live checklist.',
    ],
    rules: [
      '400 if profile is incomplete (details in outstandingRequirements).',
      '401 if unauthenticated.',
      '403 if user lacks TALENT role.',
      '409 if profile is already under review or approved.',
    ],
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Not ready — see outstandingRequirements.',
    conflict: 'Already under review or approved.',
  })
  submit(@CurrentUser('id') userId: string): Promise<TalentProfileResponse> {
    return this.profiles.submit(userId);
  }
}
