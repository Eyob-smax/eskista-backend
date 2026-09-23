import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
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

@ApiTags('catalogue · talent')
@ApiExtraModels(TalentCardResponse)
@Controller({ path: 'catalogue/talent', version: '1' })
export class TalentCatalogueController {
  constructor(private readonly talent: TalentCatalogueService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Browse and search creative talent',
    description: `
The **Find Talent** directory — search box, role filter chips, and the "N professionals
found" list.

Only profiles that are **verified** *and* still marked available for hire are returned. The
availability switch is the talent's own: someone mid-shoot can take themselves out of the
directory without their profile being suspended, and reappear without re-verification.

**Filtering by category** means "offers at least one active service in it", because a
person's discipline is expressed through the services they sell rather than a single field.

\`specializations\` accepts either repeated query parameters or one comma-separated value,
and matches a profile carrying **any** of them.

Paging is cursor-based — pass \`meta.nextCursor\` back as \`cursor\`.

\`baseRateMinor\` is the indicative day rate shown on the card. It is a starting point, not
a price: the fee for an engagement is negotiated and can differ. Never present it as final.
`.trim(),
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
  @ApiBadRequestResponse({ description: 'A price range whose maximum is below its minimum.' })
  browse(@Query() query: BrowseTalentQuery): Promise<CursorPage<TalentCardResponse>> {
    return this.talent.browse(query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get one talent profile in full',
    description: `
Everything on the talent profile screen: portfolio grid, About, the **Services** price list,
specialization and language chips, and the five most recent reviews.

\`services\` is the priced menu the customer picks from ("Full Day Commercial — ETB 4,500").
\`portfolio\` items carry either an uploaded \`imageUrl\` or an \`externalUrl\` to a hosted
video; expect one or the other, and handle both.

Reviewer names are shortened to "Selam T.".

Returns **404** for a profile that is unverified or hidden, rather than 403.
`.trim(),
  })
  @ApiOkResponse({ type: TalentDetailResponse })
  @ApiNotFoundResponse({ description: 'No verified, available talent with that id.' })
  getTalent(@Param('id', ParseUUIDPipe) talentProfileId: string): Promise<TalentDetailResponse> {
    return this.talent.getTalent(talentProfileId);
  }

  @Get(':id/availability')
  @Public()
  @ApiOperation({
    summary: 'Day-by-day availability for a talent',
    description: `
Drives the calendar on the talent profile, with its Selected / Unavailable legend.

A person is a single unit — there is no quantity to run down — so \`unitsAvailable\` is only
ever 1 or 0, and a day is simply free or not.

Confirmed engagements and the talent's own blocked dates both make a day unavailable. Which
of the two it was is not disclosed.

At most **190 days** per request.
`.trim(),
  })
  @ApiOkResponse({ type: [AvailabilityDayResponse] })
  @ApiBadRequestResponse({ description: 'Malformed dates, reversed range, or more than 190 days.' })
  @ApiNotFoundResponse({ description: 'No verified, available talent with that id.' })
  getAvailability(
    @Param('id', ParseUUIDPipe) talentProfileId: string,
    @Query() query: AvailabilityRangeQuery,
  ): Promise<AvailabilityDayResponse[]> {
    return this.talent.getAvailability(talentProfileId, query);
  }
}
