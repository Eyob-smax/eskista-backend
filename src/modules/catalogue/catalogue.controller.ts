import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CategoryKind } from '@prisma/client';
import type { CursorPage } from '../../common/dto/pagination.dto';
import { Public } from '../auth/auth.decorators';
import {
  AvailabilityDayResponse,
  AvailabilityRangeQuery,
  BrowseEquipmentQuery,
  CategoryResponse,
  EquipmentCardResponse,
  EquipmentDetailResponse,
  HomeResponse,
  QuoteQuery,
  QuoteResponse,
} from './dto/catalogue.dto';
import { CatalogueService } from './catalogue.service';

@ApiTags('catalogue · equipment')
@ApiExtraModels(EquipmentCardResponse)
@Controller({ path: 'catalogue', version: '1' })
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('home')
  @Public()
  @ApiOperation({
    summary: 'Everything the Home screen needs, in one call',
    description: `
Assembles the four rails on the **Home** tab: categories, Featured Equipment, Popular
Equipment, and the talent strip behind the "Creative Professionals" banner.

Deliberately one endpoint rather than four. On a slow connection four parallel calls give
four chances to paint a half-empty screen; this resolves them server-side and returns
together.

**Public** — no session required, so the catalogue is browsable before sign-in.
`.trim(),
  })
  @ApiOkResponse({ type: HomeResponse })
  getHome(): Promise<HomeResponse> {
    return this.catalogue.getHome();
  }

  @Get('categories')
  @Public()
  @ApiOperation({
    summary: 'List equipment or talent categories',
    description: `
Backs the **Browse Categories** grid.

\`itemCount\` counts only what a customer can actually book — published listings from
verified vendors — so a category that returns 0 can be hidden rather than leading to an
empty results page.
`.trim(),
  })
  @ApiQuery({
    name: 'kind',
    enum: CategoryKind,
    required: false,
    description: 'Defaults to `EQUIPMENT`. Pass `TALENT` for the Creative Talent categories.',
  })
  @ApiOkResponse({ type: [CategoryResponse] })
  listCategories(@Query('kind') kind?: CategoryKind): Promise<CategoryResponse[]> {
    return this.catalogue.listCategories(
      kind === CategoryKind.TALENT ? CategoryKind.TALENT : CategoryKind.EQUIPMENT,
    );
  }

  @Get('equipment')
  @Public()
  @ApiOperation({
    summary: 'Browse and search equipment',
    description: `
The **Explore** tab, and every "See All" rail.

Only published listings from verified vendors are ever returned. Drafts, listings awaiting
review, rejected and archived listings, and everything belonging to a suspended vendor are
excluded — suspending a vendor therefore withdraws their whole catalogue in one step.

**Date filtering.** Pass \`availableFrom\` **and** \`availableTo\` together to hide anything
already committed or blocked anywhere inside that range. Use it once the customer has picked
dates, so nothing unbookable is shown.

**Paging is cursor-based.** Pass the \`meta.nextCursor\` from the previous response as
\`cursor\`. Offset paging would duplicate and skip rows as the catalogue changes underneath
the reader.

The \`availabilityToday\` field on each card drives the **Available / Booked** badge. It
describes *today only* and is not a promise about the customer's chosen dates — check
\`/availability\` or \`/quote\` before letting them book.
`.trim(),
  })
  @ApiOkResponse({
    description: 'A page of cards plus the cursor for the next one.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(EquipmentCardResponse) } },
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'number', example: 20 },
            nextCursor: {
              type: 'string',
              nullable: true,
              example: '6f1c4b9e-0d2a-4f3b-9c8e-1a2b3c4d5e6f',
            },
            hasNext: { type: 'boolean', example: true },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'A malformed date, a price range whose maximum is below its minimum, or only one ' +
      'half of the availability range.',
  })
  browse(@Query() query: BrowseEquipmentQuery): Promise<CursorPage<EquipmentCardResponse>> {
    return this.catalogue.browseEquipment(query);
  }

  @Get('equipment/:id')
  @Public()
  @ApiOperation({
    summary: 'Get one piece of equipment in full',
    description: `
Everything on the equipment detail screen: photo gallery, description, specification chips,
included items, related accessories, the vendor card, and the three most recent reviews.

Reviewer names are shortened to "Selam T." — a customer's full name is not published because
they left a review.

Accessories that are not themselves publishable are filtered out, so the rail never links to
a dead page.

Returns **404** for a listing that is not published, rather than 403. The existence of
another vendor's draft is not public information.
`.trim(),
  })
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiNotFoundResponse({ description: 'No published listing with that id.' })
  getEquipment(@Param('id', ParseUUIDPipe) listingId: string): Promise<EquipmentDetailResponse> {
    return this.catalogue.getEquipment(listingId);
  }

  @Get('equipment/:id/availability')
  @Public()
  @ApiOperation({
    summary: 'Day-by-day availability for the booking calendar',
    description: `
Drives the calendar on the detail screen — the green days are the ones with
\`state: "AVAILABLE"\`.

Each day reports \`unitsAvailable\`, so a vendor with three of an item stays bookable while
two are out. Compare it against the quantity the customer wants.

Only two states are exposed. The vendor console distinguishes *rented* from *reserved* from
*blocked*, but telling one customer why a day is taken would leak another customer's
booking, so the public view says only whether it is free.

At most **190 days** per request.
`.trim(),
  })
  @ApiOkResponse({ type: [AvailabilityDayResponse] })
  @ApiBadRequestResponse({ description: 'Malformed dates, reversed range, or more than 190 days.' })
  @ApiNotFoundResponse({ description: 'No published listing with that id.' })
  getAvailability(
    @Param('id', ParseUUIDPipe) listingId: string,
    @Query() query: AvailabilityRangeQuery,
  ): Promise<AvailabilityDayResponse[]> {
    return this.catalogue.getAvailability(listingId, query);
  }

  @Get('equipment/:id/quote')
  @Public()
  @ApiOperation({
    summary: 'Price a rental before booking it',
    description: `
Backs the **"Availability & Pricing"** panel, and the totals on both steps of the request
wizard.

Computed with exactly the same function the real booking uses, so the figure quoted here is
the figure charged. Read-only: it holds no stock and writes nothing, so it is safe to call
on every date change.

**Two totals, and they are not interchangeable:**

| Field | Meaning | Where the design shows it |
| --- | --- | --- |
| \`totalMinor\` | Rental + delivery + VAT. Excludes the deposit. | "Total" on Finalize Booking — ETB 12,575 |
| \`amountDueMinor\` | \`totalMinor\` + the refundable deposit. | "Total" on Complete Payment — ETB 16,575 |

VAT is charged on the **rental subtotal only** — not on delivery, not on the service fee,
and never on the refundable deposit.

\`lines\` comes back print-ready and in order, with zero-value lines already omitted, so the
breakdown can be rendered without client-side formatting rules.

Check \`isBookable\` before enabling the submit button. When it is false, \`blockers\`
explains why in language you can show the customer directly — minimum rental not met,
maximum exceeded, or days in the range already taken.
`.trim(),
  })
  @ApiOkResponse({ type: QuoteResponse })
  @ApiBadRequestResponse({ description: 'Malformed or reversed dates.' })
  @ApiNotFoundResponse({ description: 'No published listing with that id.' })
  quote(
    @Param('id', ParseUUIDPipe) listingId: string,
    @Query() query: QuoteQuery,
  ): Promise<QuoteResponse> {
    return this.catalogue.quote(listingId, query);
  }
}
