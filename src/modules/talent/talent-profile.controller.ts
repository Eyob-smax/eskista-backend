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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
      description: { type: 'string' },
      workLink: { type: 'string', example: 'https://youtube.com/watch?v=abc' },
    },
  },
};

@ApiTags('talent · profile')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@Controller({ path: 'talent', version: '1' })
export class TalentProfileController {
  constructor(private readonly profiles: TalentProfileService) {}

  // ── Onboarding ─────────────────────────────────────────────────────────────

  @Post('onboarding')
  @ApiOperation({
    summary: 'Become a creative professional',
    description: `
Backs **What will you offer? → Creative Professional** and the first profile screen.

Creates the talent profile, grants the **TALENT** role and switches the user into the talent
app (\`activeRole: TALENT\`). The profile starts as a \`DRAFT\` — not listed, not hireable —
until it is submitted and Eskista approves it.

Only \`displayName\` and \`location\` are required here; every other field of the wizard may be
sent now or saved later with \`PATCH /talent/me\`. A profile URL (\`slug\`) is picked from the
name automatically when none is sent.

**409** if this account already has a talent profile.
`.trim(),
  })
  @ApiCreatedResponse({ type: TalentProfileResponse })
  @ApiConflictResponse({ description: 'Already a talent, or the requested URL is taken.' })
  onboard(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTalentProfileDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.onboard(userId, dto);
  }

  @Get('slug-availability')
  @ApiOperation({
    summary: 'Check a profile URL',
    description: `
For the **Profile URL** field on Publish: \`eskista.com/talent/<slug>\`.

The input is normalised first — "Dawit Media!" becomes \`dawit-media\` — and the normalised
form is returned. When taken or reserved, \`suggestions\` offers free alternatives.
`.trim(),
  })
  @ApiOkResponse({ type: SlugAvailabilityResponse })
  slugAvailability(
    @CurrentUser('id') userId: string,
    @Query() query: SlugQuery,
  ): Promise<SlugAvailabilityResponse> {
    return this.profiles.slugAvailability(userId, query.slug);
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  @Get('me')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'Get my talent profile',
    description: `
Everything the wizard, the Profile tab and the Pending Verification screen need, in one
payload.

- \`steps\` / \`completionPercent\` — the progress bar ("Profile 78% complete"). Eight steps,
  all required, as the designs show them. A field is required unless the design labels it
  "(optional)" — specializations, unavailable dates, descriptions and work links.
- \`submitBlockers\` — what still stops **Submit Profile**, in words to show. Empty when
  \`canSubmit\`.
- \`reviewChecklist\` — the four rows on Pending Verification.
- \`references\` and \`documents\` are visible to the talent and Eskista only.

\`baseRateMinor\` and service prices are what the talent is **paid**. The customer sees them
with Eskista's commission (set at approval) and VAT added.
`.trim(),
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiForbiddenResponse({ description: 'Not a talent. Start with POST /talent/onboarding.' })
  getProfile(@CurrentUser('id') userId: string): Promise<TalentProfileResponse> {
    return this.profiles.getProfile(userId);
  }

  @Patch('me')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'Save profile fields',
    description: `
Partial update — the **Save** button on any wizard step, and every later edit. Send only
what changed.

Array fields (\`professions\`, \`specializations\`, \`skills\`, \`languages\`, \`workingDays\`)
replace the stored list.

**Changing the rate on an approved profile sends it back to review** (\`PENDING_REVIEW\`):
Eskista set the commission against the old rate. The profile is unlisted until re-approved.
Other edits apply immediately.
`.trim(),
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiConflictResponse({ description: 'The requested profile URL is taken.' })
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
  @ApiOperation({
    summary: 'Upload my profile picture',
    description:
      'The required profile picture on step 1. PNG, JPEG or WebP, up to 5 MB. Replaces the ' +
      'Telegram photo everywhere the talent appears.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<TalentProfileResponse> {
    return this.profiles.uploadAvatar(userId, file);
  }

  @Put('me/experience')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'Save work experience',
    description:
      'Replaces the whole list, in display order. `isCurrent: true` is "Currently working ' +
      'here" and needs no end date. Title, company and start date are required; at least ' +
      'one entry is needed to submit.',
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  replaceExperience(
    @CurrentUser('id') userId: string,
    @Body() dto: ReplaceExperienceDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.replaceExperience(userId, dto);
  }

  @Put('me/education')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'Save education',
    description:
      'Replaces the whole list. Institution, field of study, qualification and both years ' +
      'are required, as on the design; at least one entry is needed to submit.',
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  replaceEducation(
    @CurrentUser('id') userId: string,
    @Body() dto: ReplaceEducationDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.replaceEducation(userId, dto);
  }

  @Put('me/references')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'Save professional references',
    description:
      'The two references on Publish. Eskista contacts them during review; they are never ' +
      'shown to clients. Two are needed to submit.',
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  replaceReferences(
    @CurrentUser('id') userId: string,
    @Body() dto: ReplaceReferencesDto,
  ): Promise<TalentProfileResponse> {
    return this.profiles.replaceReferences(userId, dto);
  }

  // ── Portfolio ──────────────────────────────────────────────────────────────

  @Get('me/portfolio')
  @Roles('TALENT')
  @ApiOperation({ summary: 'List my portfolio projects', description: 'In display order.' })
  @ApiOkResponse({ type: [PortfolioResponse] })
  listPortfolio(@CurrentUser('id') userId: string): Promise<PortfolioResponse[]> {
    return this.profiles.listPortfolio(userId);
  }

  @Get('me/portfolio/:id')
  @Roles('TALENT')
  @ApiOperation({ summary: 'Get one project', description: 'Backs the project detail screen.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PortfolioResponse })
  @ApiNotFoundResponse()
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
  @ApiOperation({
    summary: 'Add a project',
    description: `
**Add Project** — multipart, so the cover image travels with the fields. \`title\` is required.

Up to **5** projects ("a curated showcase of 3 to 5 best works"); **3** are needed to submit.
The sixth returns **409**.
`.trim(),
  })
  @ApiBody(PORTFOLIO_BODY)
  @ApiCreatedResponse({ type: PortfolioResponse })
  @ApiConflictResponse({ description: 'Already five projects.' })
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
  @ApiOperation({
    summary: 'Edit a project',
    description: 'Edit project → **Save and Exit**. Send a new `cover` to **Replace Image**.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(PORTFOLIO_BODY)
  @ApiOkResponse({ type: PortfolioResponse })
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
  @ApiOperation({ summary: 'Reorder my portfolio', description: 'Send every id, in order.' })
  @ApiOkResponse({ type: [PortfolioResponse] })
  reorderPortfolio(
    @CurrentUser('id') userId: string,
    @Body() dto: ReorderPortfolioDto,
  ): Promise<PortfolioResponse[]> {
    return this.profiles.reorderPortfolio(userId, dto.ids);
  }

  @Delete('me/portfolio/:id')
  @Roles('TALENT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a project',
    description:
      'The **Remove** confirmation. An approved profile that drops below three projects ' +
      'stays listed; the minimum applies at submission.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  deletePortfolioItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.profiles.deletePortfolioItem(userId, id);
  }

  // ── Services ───────────────────────────────────────────────────────────────

  @Get('me/services')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'List my priced services',
    description:
      'The price list a client sees on the profile ("Full Day Commercial — ETB …"). Prices ' +
      'here are what the talent is paid; clients see them with commission and VAT.',
  })
  @ApiOkResponse({ type: [TalentServiceResponse] })
  listServices(@CurrentUser('id') userId: string): Promise<TalentServiceResponse[]> {
    return this.profiles.listServices(userId);
  }

  @Post('me/services')
  @Roles('TALENT')
  @ApiOperation({ summary: 'Add a service' })
  @ApiCreatedResponse({ type: TalentServiceResponse })
  createService(
    @CurrentUser('id') userId: string,
    @Body() dto: TalentServiceDto,
  ): Promise<TalentServiceResponse> {
    return this.profiles.createService(userId, dto);
  }

  @Patch('me/services/:id')
  @Roles('TALENT')
  @ApiOperation({ summary: 'Edit a service' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TalentServiceResponse })
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
  @ApiOperation({
    summary: 'Remove a service',
    description: 'A service that has been booked is deactivated rather than deleted.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  deleteService(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.profiles.deleteService(userId, id);
  }

  // ── Availability ───────────────────────────────────────────────────────────

  @Get('me/availability')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'Get my availability',
    description: `
The Availability step and calendar: working days, day type, and from today on the dates
**Blocked** (by the talent) and **Rented** (hired). Everything else is Available.

Working days and day type are saved with \`PATCH /talent/me\`.
`.trim(),
  })
  @ApiOkResponse({ type: TalentAvailabilityResponse })
  getAvailability(@CurrentUser('id') userId: string): Promise<TalentAvailabilityResponse> {
    return this.profiles.getAvailability(userId);
  }

  @Post('me/blocked-dates')
  @Roles('TALENT')
  @ApiOperation({
    summary: 'Block dates',
    description:
      'Marks a range unavailable, so clients cannot invite the talent for it. **409** over ' +
      'dates the talent is already hired for.',
  })
  @ApiCreatedResponse({ type: TalentAvailabilityResponse })
  @ApiConflictResponse({ description: 'Already hired on some of those dates.' })
  blockDates(
    @CurrentUser('id') userId: string,
    @Body() dto: BlockDatesDto,
  ): Promise<TalentAvailabilityResponse> {
    return this.profiles.blockDates(userId, dto);
  }

  @Delete('me/blocked-dates/:id')
  @Roles('TALENT')
  @ApiOperation({ summary: 'Unblock dates' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TalentAvailabilityResponse })
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
  @ApiOperation({
    summary: 'Upload my ID or passport',
    description:
      '"Valid Ethiopian ID or passport" on Publish. PNG, JPEG, WebP or PDF, up to 5 MB. ' +
      'A new upload replaces the previous one. Readable by the talent and Eskista only.',
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
  @ApiBadRequestResponse({ description: 'Missing file or type, unsupported, or over 5 MB.' })
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
  @ApiOperation({
    summary: 'Submit my profile for review',
    description: `
**Submit Profile.** Moves the profile to \`PENDING_REVIEW\` and sets the review checklist:
identity **in progress**, portfolio and references **queued**, Eskista approval **pending**.

Needs: name, phone, location, bio, a rate (or a priced service), profile picture, accepted
terms, a profession, **3+ portfolio projects**, an **ID or passport**, **2 references** and
a profile URL. A **400** lists what is missing in \`outstandingRequirements\` — the same list
as \`submitBlockers\` on \`GET /talent/me\`.

The profile is not listed until Eskista approves it; approval is also where the commission
on top of the talent's rate is set. A rejected profile can be fixed and resubmitted.
`.trim(),
  })
  @ApiOkResponse({ type: TalentProfileResponse })
  @ApiBadRequestResponse({ description: 'Not ready — see `outstandingRequirements`.' })
  @ApiConflictResponse({ description: 'Already under review or approved.' })
  submit(@CurrentUser('id') userId: string): Promise<TalentProfileResponse> {
    return this.profiles.submit(userId);
  }
}
