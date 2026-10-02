import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { Public } from '../auth/auth.decorators';
import {
  AvailabilityDayResponse,
  AvailabilityRangeQuery,
  BrowseTalentQuery,
  TalentCardResponse,
  TalentDetailResponse,
} from './dto/catalogue.dto';
import { TalentCatalogueService } from './talent-catalogue.service';

const TALENT_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Talent profile ID (UUID).',
  example: '550e8400-e29b-41d4-a716-446655440000',
};

const SLUG_PARAM = {
  name: 'slug',
  type: 'string',
  description: 'Unique URL slug assigned to the talent profile.',
  example: 'selam-tefera-cinematographer',
};

@ApiTags('catalogue · talent')
@ApiStandardErrors({ notFound: 'No verified, available talent with that id.' })
@ApiExtraModels(TalentCardResponse)
@Controller({ path: 'catalogue/talent', version: '1' })
export class TalentCatalogueController {
  constructor(private readonly talent: TalentCatalogueService) {}

  @Get()
  @Public()
  @ApiEndpoint({
    summary: 'Browse and search creative talent',
    does: 'Searches the creative talent directory by category, search text, specialization tags, experience level, and hourly/daily rate ranges.',
    behind: [
      'Queries verified and available TalentProfile records.',
      'Filters on active services belonging to the selected category.',
      'Applies multi-match filtering for specialization tags.',
      'Applies cursor pagination based on profile ID.',
    ],
    seenBy: [
      'Customer sees the talent cards in the Find Talent directory with badges, rating, daily rate (inclusive of 15% VAT), and primary skills.',
    ],
    rules: [
      'Public access — no authentication required.',
      'Only returns profiles that are verified AND marked available for hire.',
      'Returns 400 when minRate exceeds maxRate or cursor is malformed.',
    ],
  })
  @ApiStandardErrors({
    badRequest: 'A price range whose maximum is below its minimum, or malformed pagination cursor.',
  })
  @ApiOkResponse({
    description: 'A page of talent cards plus the cursor for the next one.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(TalentCardResponse) } },
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'number', example: 20 },
            nextCursor: { type: 'string', nullable: true },
            hasNext: { type: 'boolean', example: false },
          },
        },
      },
    },
  })
  browse(@Query() query: BrowseTalentQuery): Promise<CursorPage<TalentCardResponse>> {
    return this.talent.browse(query);
  }

  @Get('by-slug/:slug')
  @Public()
  @ApiParam(SLUG_PARAM)
  @ApiEndpoint({
    summary: 'Open a profile from its shared link',
    does: 'Resolves a talent profile by its vanity URL slug (e.g. from share links or portfolio embeds).',
    behind: [
      'Looks up TalentProfile by slug matching.',
      'Checks that verification status is VERIFIED and profile is publicly available.',
      'Increments profile view counters.',
      'Eager-loads portfolio items, active services, review summaries, and availability defaults.',
    ],
    seenBy: [
      'Customer or client opening a direct shared talent profile link sees full profile details.',
    ],
    rules: [
      'Public access — no authentication required.',
      'Returns 200 with complete talent profile details.',
      'Returns 404 for an unknown, unverified or hidden profile.',
    ],
  })
  @ApiStandardErrors({
    notFound: 'No verified, available talent at that URL.',
  })
  @ApiOkResponse({ type: TalentDetailResponse })
  getBySlug(@Param('slug') slug: string): Promise<TalentDetailResponse> {
    return this.talent.getTalentBySlug(slug);
  }

  @Get(':id/cv.pdf')
  @Public()
  @ApiParam(TALENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Download a talent’s CV',
    does: 'Generates and streams a standardized PDF resume/CV based on the talent’s profile, experiences, and selected template without private contact details.',
    behind: [
      'Fetches talent profile, bio, experiences, skills, and portfolio highlights.',
      'Redacts private contact information (phone, email) — clients hire through Eskista.',
      'Renders PDF using the talent’s chosen template layout and streams it with Content-Disposition attachment.',
    ],
    seenBy: [
      'Customer downloads the PDF resume for offline review, production pitches, or client presentations.',
    ],
    rules: [
      'Public access — no authentication required.',
      'Returns 200 with application/pdf binary file.',
      'Returns 404 if talent profile is not found or not verified.',
    ],
  })
  @ApiStandardErrors({
    notFound: 'No verified, available talent with that id.',
  })
  @ApiOkResponse({
    description: 'The talent’s auto-generated CV as a PDF file attachment.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async cvPdf(
    @Param('id', ParseUUIDPipe) talentProfileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.talent.cvPdf(talentProfileId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(buffer);
  }

  @Get(':id')
  @Public()
  @ApiParam(TALENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Get one talent profile in full',
    does: 'Fetches the comprehensive talent profile including portfolio media, priced services menu, bio, gear list, languages, and recent reviews.',
    behind: [
      'Finds TalentProfile by ID.',
      'Ensures profile is VERIFIED and isAvailable=true.',
      'Loads services menu, portfolio media (images and video URLs), and recent verified reviews with shortened reviewer names.',
      'Increments talent view counter for analytics.',
    ],
    seenBy: [
      'Customer sees the full talent profile sheet, priced service options, portfolio gallery, and review feedback.',
    ],
    rules: [
      'Public access — no authentication required.',
      'Returns 200 with TalentDetailResponse.',
      'Returns 404 for a profile that is unverified or hidden.',
    ],
  })
  @ApiStandardErrors({
    notFound: 'No verified, available talent with that id.',
  })
  @ApiOkResponse({ type: TalentDetailResponse })
  getTalent(@Param('id', ParseUUIDPipe) talentProfileId: string): Promise<TalentDetailResponse> {
    return this.talent.getTalent(talentProfileId);
  }

  @Get(':id/availability')
  @Public()
  @ApiParam(TALENT_ID_PARAM)
  @ApiEndpoint({
    summary: 'Day-by-day availability for a talent',
    does: 'Returns day-by-day availability status for the talent within the requested date window (up to 190 days).',
    behind: [
      'Validates date range (startDate <= endDate, maximum 190 days).',
      'Computes booked dates from confirmed talent bookings and manually blocked dates on the talent calendar.',
      'Returns each calendar day with unitsAvailable (1 if free, 0 if booked/blocked).',
    ],
    seenBy: [
      'Customer sees interactive booking calendar with selectable available days and disabled booked dates.',
    ],
    rules: [
      'Public access — no authentication required.',
      'At most 190 days per request.',
      'Returns 400 for malformed dates, reversed range, or more than 190 days.',
      'Returns 404 if talent profile does not exist.',
    ],
  })
  @ApiStandardErrors({
    badRequest: 'Malformed dates, reversed range, or more than 190 days.',
    notFound: 'No verified, available talent with that id.',
  })
  @ApiOkResponse({ type: [AvailabilityDayResponse] })
  getAvailability(
    @Param('id', ParseUUIDPipe) talentProfileId: string,
    @Query() query: AvailabilityRangeQuery,
  ): Promise<AvailabilityDayResponse[]> {
    return this.talent.getAvailability(talentProfileId, query);
  }
}
