import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CategoryKind } from '@prisma/client';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
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

const LISTING_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Equipment listing ID (UUID).',
  example: '550e8400-e29b-41d4-a716-446655440000',
};

@ApiTags('catalogue · equipment')
@ApiStandardErrors({ notFound: 'No published listing with that id.' })
@ApiExtraModels(EquipmentCardResponse)
@Controller({ path: 'catalogue', version: '1' })
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('home')
  @Public()
  @ApiEndpoint({
    summary: 'Everything the Home screen needs, in one call',
    does: 'Assembles the four rails on the Home tab: categories, Featured Equipment, Popular Equipment, and Creative Professionals banner.',
    behind: [
      'Queries top categories with published listings.',
      'Resolves featured equipment listings and popular equipment ordered by completed booking counts.',
      'Resolves featured verified creative talent profiles.',
      'Returns combined homepage payload in a single response.',
    ],
    seenBy: [
      'Customer sees the marketplace Home tab with all rails pre-populated.',
    ],
    rules: [
      'Public access — no authentication required.',
    ],
  })
  @ApiOkResponse({ type: HomeResponse })
  getHome(): Promise<HomeResponse> {
    return this.catalogue.getHome();
  }

  @Get('categories')
  @Public()
  @ApiEndpoint({
    summary: 'List equipment or talent categories',
    does: 'Returns active equipment or talent categories with published listing counts and related suggestions.',
    behind: [
      'Queries Category table filtered by kind (EQUIPMENT or TALENT).',
      'Computes itemCount for published listings from verified suppliers.',
      'Includes related category suggestions.',
    ],
    seenBy: [
      'Customer sees the category selection grid in the Mini App catalogue.',
    ],
    rules: [
      'Public access.',
      'Defaults to kind=EQUIPMENT when kind query parameter is omitted.',
    ],
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
  @ApiEndpoint({
    summary: 'Browse and search equipment',
    does: 'Searches and filters published equipment listings with cursor-based pagination, date availability, and category filters.',
    behind: [
      'Searches name, brand, model, and description text.',
      'Filters by category, price range, and location.',
      'If availableFrom and availableTo are supplied, excludes items booked on those dates.',
      'Computes VAT-inclusive pricing (base vendor price + commission + 15% VAT).',
    ],
    seenBy: [
      'Customer sees the Explore tab and filtered equipment search results.',
    ],
    rules: [
      'Public access.',
      '400 if date format is invalid or minPrice exceeds maxPrice.',
    ],
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
  browse(@Query() query: BrowseEquipmentQuery): Promise<CursorPage<EquipmentCardResponse>> {
    return this.catalogue.browseEquipment(query);
  }

  @Get('equipment/:id')
  @Public()
  @ApiParam(LISTING_ID_PARAM)
  @ApiEndpoint({
    summary: 'Get one piece of equipment in full',
    does: 'Returns complete details for an equipment listing: photo gallery, specs, included accessories, vendor card, and recent customer reviews.',
    behind: [
      'Queries EquipmentListing by ID with included items, specs, vendor, and reviews.',
      'Shortens reviewer names (e.g. Selam T.) for privacy.',
    ],
    seenBy: [
      'Customer views the comprehensive Equipment Detail screen.',
    ],
    rules: [
      'Public access.',
      '404 if listing is not published, archived, or owned by a suspended vendor.',
    ],
  })
  @ApiOkResponse({ type: EquipmentDetailResponse })
  getEquipment(@Param('id', ParseUUIDPipe) listingId: string): Promise<EquipmentDetailResponse> {
    return this.catalogue.getEquipment(listingId);
  }

  @Get('equipment/:id/availability')
  @Public()
  @ApiParam(LISTING_ID_PARAM)
  @ApiEndpoint({
    summary: 'Day-by-day availability for the booking calendar',
    does: 'Returns calendar availability indicating available vs unavailable days and units free for booking.',
    behind: [
      'Computes daily unit counts across active bookings and maintenance holds.',
      'Masks internal booking reasons for customer privacy.',
    ],
    seenBy: [
      'Customer sees green (available) and grey (booked) days on the detail calendar picker.',
    ],
    rules: [
      'Public access.',
      '400 if date range is reversed, invalid, or exceeds 190 days.',
      '404 if listing not found.',
    ],
  })
  @ApiOkResponse({ type: [AvailabilityDayResponse] })
  getAvailability(
    @Param('id', ParseUUIDPipe) listingId: string,
    @Query() query: AvailabilityRangeQuery,
  ): Promise<AvailabilityDayResponse[]> {
    return this.catalogue.getAvailability(listingId, query);
  }

  @Get('equipment/:id/quote')
  @Public()
  @ApiParam(LISTING_ID_PARAM)
  @ApiEndpoint({
    summary: 'Price a rental before booking it',
    does: 'Calculates price quote including daily rental fees, delivery, platform commission, 15% VAT, and refundable deposit.',
    behind: [
      'Performs live calculation of rental subtotal, platform commission, 15% VAT, and security deposit.',
      'Checks calendar availability and checks rental duration against vendor minimum and maximum limits.',
      'Generates itemized quote lines and evaluates isBookable and blockers.',
    ],
    seenBy: [
      'Customer sees the Availability & Pricing breakdown panel and booking wizard totals.',
    ],
    rules: [
      'Public access.',
      '400 if date range is invalid.',
      '404 if listing not found.',
    ],
  })
  @ApiOkResponse({ type: QuoteResponse })
  quote(
    @Param('id', ParseUUIDPipe) listingId: string,
    @Query() query: QuoteQuery,
  ): Promise<QuoteResponse> {
    return this.catalogue.quote(listingId, query);
  }
}

