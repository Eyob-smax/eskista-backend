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
} from '@nestjs/swagger';
import {
  ApiEndpoint,
  ApiPaginatedResponse,
  ApiStandardErrors,
} from '../../common/dto/api-docs';
import type { UploadedFile } from '../../common/upload';
import type { Paginated } from '../../common/dto/pagination.dto';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  AvailabilityDayResponse,
  AvailabilityQuery,
  BlockDatesDto,
  CreateEquipmentDto,
  CreateUnitDto,
  EquipmentDetailResponse,
  EquipmentImageResponse,
  EquipmentListQuery,
  EquipmentSummaryResponse,
  EquipmentUnitResponse,
  ReplaceAccessoriesDto,
  ReplaceIncludedItemsDto,
  ReplaceSpecsDto,
  UpdateEquipmentDto,
  UpdateImageDto,
  UpdateUnitDto,
} from './dto/equipment.dto';
import { EquipmentService } from './equipment.service';

const binaryBody = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

const LISTING_ID_PARAM = {
  name: 'listingId',
  format: 'uuid',
  example: '7d3a2e10-9b88-4122-bc55-e45f91223401',
  description: 'The equipment listing UUID.',
};

const IMAGE_ID_PARAM = {
  name: 'imageId',
  format: 'uuid',
  example: '550e8400-e29b-41d4-a716-446655440000',
  description: 'The equipment photo UUID.',
};

const UNIT_ID_PARAM = {
  name: 'unitId',
  format: 'uuid',
  example: '9f2c7a30-0192-4f33-8aa3-6330058b87f5',
  description: 'The physical unit UUID.',
};

const BLOCK_ID_PARAM = {
  name: 'blockId',
  format: 'uuid',
  example: '8a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
  description: 'The blocked date range UUID.',
};

const DATE_PARAM = {
  name: 'date',
  example: '2026-08-18',
  description: 'Calendar date in YYYY-MM-DD format to toggle availability.',
};

@ApiTags('vendor · equipment')
@ApiBearerAuth()
@Roles('VENDOR')
@Controller({ path: 'vendor/equipment', version: '1' })
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  @Post()
  @ApiEndpoint({
    summary: 'Create a draft listing',
    does: 'Accepts the full B&H-style payload in one call — basics, technical, condition, what is included, and rental terms. Photos and units are added separately.',
    behind: [
      'Resolves vendor profile from signed-in user; rejects with 404 if profile does not exist.',
      'Verifies categoryId exists and is an equipment category.',
      'Inserts EquipmentListing in DRAFT status with generated slug.',
      'Optionally creates SpecItem rows and IncludedItem rows in the same transaction.',
    ],
    seenBy: [
      'Vendor inventory: draft listing appears on the Equipment list with DRAFT badge.',
    ],
    rules: [
      '400 if validation fails, negative prices, or category not found.',
      '401 if unauthenticated.',
      '404 if vendor profile not found.',
    ],
  })
  @ApiCreatedResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failed or invalid category.',
    notFound: 'Vendor profile not found.',
  })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEquipmentDto,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.create(userId, dto);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List my equipment',
    does: 'Paginated, searchable, and sortable list of equipment listings owned by the vendor.',
    behind: [
      'Read only: queries EquipmentListing filtered by vendorId, optional status, categoryId, and full-text search.',
      'Derives availabilityLabel (AVAILABLE or BOOKED) and nextDueDate from live bookings and date blocks.',
      'Calculates unitCount and rating metrics per listing.',
    ],
    seenBy: [
      'Vendor portal: powers the Equipment catalog screen with filters and tab counts.',
    ],
    rules: [
      '400 if pagination or sort parameters are invalid.',
      '401 if unauthenticated.',
      '404 if vendor profile does not exist.',
    ],
  })
  @ApiPaginatedResponse(EquipmentSummaryResponse)
  @ApiStandardErrors({
    badRequest: 'Invalid filter or query parameters.',
    notFound: 'Vendor profile not found.',
  })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: EquipmentListQuery,
  ): Promise<Paginated<EquipmentSummaryResponse>> {
    return this.equipment.list(userId, query);
  }

  @Get(':listingId')
  @ApiEndpoint({
    summary: 'Get one of my listings in full',
    does: 'Returns complete details for a single equipment listing, including units, photos, specs, included items, and submission checklist.',
    behind: [
      'Read only: verifies listing belongs to the calling vendor.',
      'Eager-loads photos, specs, included items, active units, and accessories.',
      'Evaluates outstandingRequirements and canSubmitForReview.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if listingId is not found or belongs to another vendor.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({ notFound: 'Listing not found or does not belong to you.' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.findOne(userId, listingId);
  }

  @Patch(':listingId')
  @ApiEndpoint({
    summary: 'Update a listing',
    does: 'Updates listing details, pricing, or specifications. Editing a PUBLISHED listing returns it to PENDING_REVIEW.',
    behind: [
      'Verifies listing ownership.',
      'Updates listing columns. If status is PUBLISHED, changes status to PENDING_REVIEW and records submission date.',
      'Replaces specs and includedItems collections wholesale if supplied in the payload.',
    ],
    seenBy: [
      'Vendor app: listing status badge updates immediately.',
      'Admin review queue: listing reappears for re-review if previously published.',
    ],
    rules: [
      '400 if validation fails.',
      '401 if unauthenticated.',
      '404 if listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid update fields.',
    notFound: 'Listing not found.',
  })
  update(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: UpdateEquipmentDto,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.update(userId, listingId, dto);
  }

  @Delete(':listingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Archive a listing',
    does: 'Archives an equipment listing rather than deleting it, preserving past booking history and records.',
    behind: [
      'Verifies listing ownership.',
      'Sets status to ARCHIVED, unpublishes from the public catalogue, and cancels upcoming blocks.',
      'Prevents archiving if the equipment currently has live or active bookings.',
    ],
    seenBy: [
      'Catalogue: listing is removed from search results and category rails.',
      'Vendor inventory: moves to the Archived filter.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if listing not found.',
      '409 if listing has active or upcoming bookings.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiNoContentResponse({ description: 'Listing archived successfully.' })
  @ApiStandardErrors({
    notFound: 'Listing not found.',
    conflict: 'Listing has active bookings and cannot be archived.',
  })
  archive(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<void> {
    return this.equipment.archive(userId, listingId);
  }

  @Post(':listingId/submit')
  @ApiEndpoint({
    summary: 'Submit a listing for Eskista review',
    does: 'Submits a complete draft listing to Eskista QA for catalog approval and publication.',
    behind: [
      'Verifies listing has met all mandatory requirements (at least 1 photo, description, price, condition rating, and verified vendor).',
      'Transitions listing status from DRAFT or REJECTED to PENDING_REVIEW.',
      'Notifies Eskista catalog administration team to inspect and approve.',
    ],
    seenBy: [
      'Vendor app: status changes to Under Review, unlocking the progress tracker.',
      'Admin catalog: appears in the Pending Approval review queue.',
    ],
    rules: [
      '400 if listing is incomplete (missing required photos or fields).',
      '401 if unauthenticated.',
      '403 if vendor profile is unverified.',
      '404 if listing not found.',
      '409 if listing is already in review or published.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Outstanding requirements remain before submission.',
    notFound: 'Listing not found.',
    conflict: 'Listing is not in draft or rejected status.',
  })
  submit(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.submitForReview(userId, listingId);
  }

  // ── Photos ─────────────────────────────────────────────────────────────────

  @Post(':listingId/images')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Add a photo',
    does: 'Uploads an equipment photo (JPEG, PNG, WebP up to 5MB). The first photo uploaded automatically becomes the primary display image.',
    behind: [
      'Verifies listing ownership.',
      'Uploads media file to Cloudinary under the equipment listing namespace.',
      'Inserts EquipmentImage row; if no primary image exists, marks this image as isPrimary = true.',
    ],
    seenBy: [
      'Listing preview and public catalog card: displays uploaded photo.',
    ],
    rules: [
      '400 if file is missing, exceeds 5MB, or is not a supported image type.',
      '401 if unauthenticated.',
      '404 if listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiBody(binaryBody)
  @ApiCreatedResponse({ type: EquipmentImageResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid file format or file exceeds 5MB.',
    notFound: 'Listing not found.',
  })
  addImage(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<EquipmentImageResponse> {
    return this.equipment.addImage(userId, listingId, file);
  }

  @Patch(':listingId/images/:imageId')
  @ApiEndpoint({
    summary: 'Reorder a photo or make it the main image',
    does: 'Updates photo sort order, alt text, or designates it as the primary cover photo.',
    behind: [
      'Verifies listing and image ownership.',
      'If isPrimary is true, demotes the existing primary photo to isPrimary = false in the same transaction.',
      'Updates sortOrder and altText on EquipmentImage.',
    ],
    seenBy: [
      'Vendor app and catalog: primary photo thumbnail updates.',
    ],
    rules: [
      '400 if payload is invalid.',
      '401 if unauthenticated.',
      '404 if image or listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiOkResponse({ type: EquipmentImageResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid parameters.',
    notFound: 'Image or listing not found.',
  })
  updateImage(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
  ): Promise<EquipmentImageResponse> {
    return this.equipment.updateImage(userId, listingId, imageId, dto);
  }

  @Delete(':listingId/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Delete a photo',
    does: 'Deletes an equipment photo from storage and database. If the primary image is removed, another photo is automatically promoted.',
    behind: [
      'Verifies image belongs to listing.',
      'Deletes image record from database and Cloudinary storage.',
      'If deleted photo was primary, promotes the lowest sortOrder remaining photo to primary.',
    ],
    seenBy: [
      'Listing photos rail: photo removed.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if image or listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiNoContentResponse({ description: 'Photo deleted successfully.' })
  @ApiStandardErrors({ notFound: 'Image or listing not found.' })
  deleteImage(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    return this.equipment.deleteImage(userId, listingId, imageId);
  }

  // ── Spec / included / accessories collections ──────────────────────────────

  @Put(':listingId/specs')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Replace secondary specifications table',
    does: 'Replaces secondary specifications (dimensions, mounts, sensors, power) wholesale.',
    behind: [
      'Verifies listing ownership.',
      'Deletes existing SpecItem rows for this listing and bulk-inserts new entries in a single transaction.',
    ],
    seenBy: [
      'Listing detail page: Technical Specifications table updates.',
    ],
    rules: [
      '400 if validation fails.',
      '401 if unauthenticated.',
      '404 if listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiNoContentResponse({ description: 'Specs replaced successfully.' })
  @ApiStandardErrors({
    badRequest: 'Invalid specs array.',
    notFound: 'Listing not found.',
  })
  replaceSpecs(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: ReplaceSpecsDto,
  ): Promise<void> {
    return this.equipment.replaceSpecs(userId, listingId, dto);
  }

  @Put(':listingId/included-items')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: "Replace what's included",
    does: "Replaces the two included item lists (core gear and accessories) wholesale.",
    behind: [
      'Verifies listing ownership.',
      'Deletes previous IncludedItem records and inserts new rows categorized by kind (EQUIPMENT vs ACCESSORY).',
    ],
    seenBy: [
      "Listing page: 'What\\'s in the Box' and 'Included Accessories' sections update.",
    ],
    rules: [
      '400 if validation fails.',
      '401 if unauthenticated.',
      '404 if listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiNoContentResponse({ description: 'Included items replaced successfully.' })
  @ApiStandardErrors({
    badRequest: 'Invalid included items array.',
    notFound: 'Listing not found.',
  })
  replaceIncludedItems(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: ReplaceIncludedItemsDto,
  ): Promise<void> {
    return this.equipment.replaceIncludedItems(userId, listingId, dto);
  }

  @Put(':listingId/accessories')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Set related accessories',
    does: 'Selects other equipment listings belonging to this vendor to recommend alongside this gear.',
    behind: [
      'Verifies listing ownership.',
      'Ensures all referenced accessory listing IDs belong to the same vendor and are valid.',
      'Replaces equipment accessory junction records.',
    ],
    seenBy: [
      "Public listing: 'Recommended Accessories' rail.",
    ],
    rules: [
      '400 if any referenced listing does not belong to the vendor or is invalid.',
      '401 if unauthenticated.',
      '404 if listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiNoContentResponse({ description: 'Accessories linked successfully.' })
  @ApiStandardErrors({
    badRequest: 'Accessories must be your own listings.',
    notFound: 'Listing not found.',
  })
  replaceAccessories(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: ReplaceAccessoriesDto,
  ): Promise<void> {
    return this.equipment.replaceAccessories(userId, listingId, dto);
  }

  // ── Units ──────────────────────────────────────────────────────────────────

  @Get(':listingId/units')
  @ApiEndpoint({
    summary: 'List physical units',
    does: 'Lists individual physical units (serial numbers, condition grades, active bookings) for this equipment listing.',
    behind: [
      'Read only: queries EquipmentUnit records belonging to listing.',
      'Computes activeBookings count per unit from live bookings.',
    ],
    seenBy: [
      'Vendor units drawer: displays inventory units, condition badges, and in-service flags.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiOkResponse({ type: [EquipmentUnitResponse] })
  @ApiStandardErrors({ notFound: 'Listing not found.' })
  listUnits(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<EquipmentUnitResponse[]> {
    return this.equipment.listUnits(userId, listingId);
  }

  @Post(':listingId/units')
  @ApiEndpoint({
    summary: 'Add a physical unit',
    does: 'Registers a new physical copy of this equipment model with its own serial number and condition rating.',
    behind: [
      'Verifies listing ownership.',
      'Ensures serialNumber is unique within this listing if provided.',
      'Creates EquipmentUnit record in AVAILABLE status.',
    ],
    seenBy: [
      'Inventory count: increases total units available for customer bookings.',
    ],
    rules: [
      '400 if validation fails.',
      '401 if unauthenticated.',
      '404 if listing not found.',
      '409 if serial number already exists for this listing.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiCreatedResponse({ type: EquipmentUnitResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid unit details.',
    notFound: 'Listing not found.',
    conflict: 'Serial number already registered for this equipment.',
  })
  createUnit(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: CreateUnitDto,
  ): Promise<EquipmentUnitResponse> {
    return this.equipment.createUnit(userId, listingId, dto);
  }

  @Patch(':listingId/units/:unitId')
  @ApiEndpoint({
    summary: 'Update a unit',
    does: 'Updates a unit label, serial number, condition notes, or status (e.g. MAINTENANCE or RETIRED).',
    behind: [
      'Verifies unit and listing ownership.',
      'Checks active bookings: a unit currently on a live rental cannot be set to RETIRED or OUT_OF_SERVICE.',
      'Updates EquipmentUnit record.',
    ],
    seenBy: [
      'Admin assignment pool: retired units are removed from dispatch selection.',
    ],
    rules: [
      '400 if validation fails.',
      '401 if unauthenticated.',
      '404 if unit or listing not found.',
      '409 if taking unit out of service while held by an active booking.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiParam(UNIT_ID_PARAM)
  @ApiOkResponse({ type: EquipmentUnitResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid unit parameters.',
    notFound: 'Unit or listing not found.',
    conflict: 'Unit is on an active rental and cannot be retired.',
  })
  updateUnit(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: UpdateUnitDto,
  ): Promise<EquipmentUnitResponse> {
    return this.equipment.updateUnit(userId, listingId, unitId, dto);
  }

  @Delete(':listingId/units/:unitId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Delete a unit',
    does: 'Permanently removes an equipment unit with no rental history. Units with past bookings must be RETIRED instead.',
    behind: [
      'Verifies unit ownership.',
      'Checks booking history: rejects deletion if unit has ever been assigned to a booking (return 409 conflict).',
      'Deletes EquipmentUnit record.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if unit or listing not found.',
      '409 if unit has rental history (must retire instead of delete).',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiParam(UNIT_ID_PARAM)
  @ApiNoContentResponse({ description: 'Unit deleted successfully.' })
  @ApiStandardErrors({
    notFound: 'Unit not found.',
    conflict: 'Unit has booking history; retire it instead of deleting.',
  })
  deleteUnit(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ): Promise<void> {
    return this.equipment.deleteUnit(userId, listingId, unitId);
  }

  // ── Availability ───────────────────────────────────────────────────────────

  @Get(':listingId/availability')
  @ApiEndpoint({
    summary: 'Availability calendar',
    does: 'Returns day-by-day availability status (AVAILABLE, BLOCKED, RESERVED, RENTED) for up to 190 days.',
    behind: [
      'Read only: aggregates stored vendor blocks and active booking reservations across the date window.',
      'Computes free unit count for each day.',
    ],
    seenBy: [
      'Vendor calendar: colors each date cell according to the legend.',
    ],
    rules: [
      '400 if date window is invalid or exceeds 190 days.',
      '401 if unauthenticated.',
      '404 if listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiOkResponse({ type: [AvailabilityDayResponse] })
  @ApiStandardErrors({
    badRequest: 'Date range invalid or exceeds 190 days.',
    notFound: 'Listing not found.',
  })
  getAvailability(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Query() query: AvailabilityQuery,
  ): Promise<AvailabilityDayResponse[]> {
    return this.equipment.getAvailability(userId, listingId, query);
  }

  @Post(':listingId/availability/:date/toggle')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Tap a date to cycle its status',
    does: 'Toggles a single calendar day between AVAILABLE and BLOCKED. Splitting longer blocks if needed.',
    behind: [
      'Verifies listing ownership.',
      'Checks date against live bookings: cannot block a date that is already RESERVED or RENTED.',
      'If date is inside an existing block, splits or removes the block. If unblocked, creates a single-day block.',
    ],
    seenBy: [
      'Vendor calendar: cell state toggles immediately.',
      'Customer booking calendar: date becomes unavailable for checkout.',
    ],
    rules: [
      '400 if date string is not in YYYY-MM-DD format.',
      '401 if unauthenticated.',
      '404 if listing not found.',
      '409 if date conflicts with an active or confirmed customer rental.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiParam(DATE_PARAM)
  @ApiOkResponse({ type: AvailabilityDayResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid date format (must be YYYY-MM-DD).',
    notFound: 'Listing not found.',
    conflict: 'Date has active bookings and cannot be blocked.',
  })
  toggleDate(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('date') date: string,
  ): Promise<AvailabilityDayResponse> {
    return this.equipment.toggleDate(userId, listingId, date);
  }

  @Post(':listingId/blocked-dates')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Block a date range',
    does: 'Blocks an inclusive date range from customer rentals (e.g. for scheduled maintenance or internal shoots).',
    behind: [
      'Verifies listing ownership and unitId if specified.',
      'Validates no confirmed bookings overlap the requested range.',
      'Inserts BlockedDate record covering the date interval.',
    ],
    seenBy: [
      'Customer booking dates picker: dates disabled.',
      'Vendor calendar: range marked with BLOCKED color.',
    ],
    rules: [
      '400 if startDate is after endDate or dates are in the past.',
      '401 if unauthenticated.',
      '404 if listing or unit not found.',
      '409 if range overlaps confirmed bookings.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiNoContentResponse({ description: 'Date range blocked successfully.' })
  @ApiStandardErrors({
    badRequest: 'Invalid date range.',
    notFound: 'Listing not found.',
    conflict: 'Range conflicts with confirmed bookings.',
  })
  blockDates(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: BlockDatesDto,
  ): Promise<void> {
    return this.equipment.blockDates(userId, listingId, dto);
  }

  @Delete(':listingId/blocked-dates/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint({
    summary: 'Remove a blocked range',
    does: 'Removes a previously blocked date range, restoring calendar availability for rental.',
    behind: [
      'Verifies listing ownership.',
      'Deletes BlockedDate record.',
    ],
    seenBy: [
      'Customer catalogue: dates become available for rental booking.',
      'Vendor calendar: cells return to AVAILABLE state.',
    ],
    rules: [
      '401 if unauthenticated.',
      '404 if blockId or listing not found.',
    ],
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiParam(BLOCK_ID_PARAM)
  @ApiNoContentResponse({ description: 'Blocked date range removed.' })
  @ApiStandardErrors({ notFound: 'Blocked date range or listing not found.' })
  unblockDates(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ): Promise<void> {
    return this.equipment.unblockDates(userId, listingId, blockId);
  }
}
