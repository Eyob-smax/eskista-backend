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
import { ApiBody, ApiConsumes, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminTier, CategoryKind } from '@prisma/client';
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { UploadedFile } from '../../../common/upload';
import { CurrentUser } from '../../auth/auth.decorators';
import {
  CreateUnitDto,
  EquipmentDetailResponse,
  EquipmentImageResponse,
  UpdateEquipmentDto,
} from '../../equipment/dto/equipment.dto';
import { AdminAccess } from '../core/admin-access';
import {
  AdminCategoriesQuery,
  AdminCategoryResponse,
  AdminCreateEquipmentDto,
  AdminListingsQuery,
  AdminUnitsQuery,
  AdminUpdateUnitDto,
  CategoryDeleteResponse,
  CategoryDto,
  EquipmentKpisResponse,
  ListingAdminRowResponse,
  MoveCategoryDto,
  ReorderCategoriesDto,
  SuspendListingDto,
  UnitDetailResponse,
  UnitRowResponse,
  UpdateCategoryDto,
} from './admin-catalog.dto';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminEquipmentService } from './admin-equipment.service';

const IMAGE_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: {
      file: { type: 'string', format: 'binary', description: 'PNG, JPEG or WebP, up to 10 MB.' },
    },
  },
};

const UNIT_ID = { name: 'unitId', format: 'uuid', description: 'The equipment unit id.' };
const LISTING_ID = { name: 'listingId', format: 'uuid', description: 'The listing id.' };
const CATEGORY_ID = { name: 'id', format: 'uuid', description: 'The category id.' };

@ApiTags('admin · equipment')
@AdminAccess()
@Controller({ path: 'admin/equipment', version: '1' })
export class AdminEquipmentController {
  constructor(private readonly equipment: AdminEquipmentService) {}

  @Get('kpis')
  @ApiEndpoint({
    summary: 'Equipment Management tiles',
    does: 'Total units, available, on rental, needs attention — across every vendor.',
    behind: ['Read only. Four counts over the equipment-unit table.'],
  })
  @ApiOkResponse({ type: EquipmentKpisResponse })
  @ApiStandardErrors()
  kpis(): Promise<EquipmentKpisResponse> {
    return this.equipment.kpis();
  }

  @Get('units')
  @ApiEndpoint({
    summary: 'Equipment Management — one row per physical unit',
    does: 'Every unit Eskista holds or has out. Filterable by state: AVAILABLE, RESERVED, RENTED, RETURNED, IN_QA, RETIRED.',
    behind: [
      'Read only. State is derived: RESERVED = booked but not dispatched; RENTED = custody CLIENT; RETURNED = back at the hub awaiting inspection; IN_QA = graded Damaged or in maintenance; RETIRED = decommissioned.',
    ],
  })
  @ApiPaginatedResponse(UnitRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  units(@Query() query: AdminUnitsQuery): Promise<Paginated<UnitRowResponse>> {
    return this.equipment.units(query);
  }

  @Get('units/:unitId')
  @ApiEndpoint({
    summary: 'Unit detail',
    does: 'Overview & Specs, the latest Manual Inspection, Rental Bookings (or "Unit is currently in the Hub Vault"), and Condition History.',
    behind: ['Read only.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(UNIT_ID)
  @ApiOkResponse({ type: UnitDetailResponse })
  @ApiStandardErrors({ notFound: 'Unit not found' })
  unit(@Param('unitId', ParseUUIDPipe) unitId: string): Promise<UnitDetailResponse> {
    return this.equipment.unit(unitId);
  }

  @Patch('units/:unitId')
  @ApiEndpoint({
    summary: 'Edit a unit',
    does: 'Label, serial, condition notes, custody, or status (MAINTENANCE takes it out of service, RETIRED for good). Send only what changes.',
    behind: [
      'Unit updated; admin audit log written.',
      'MAINTENANCE: the unit is removed from service and flagged for repair.',
      'RETIRED: the unit is decommissioned permanently.',
    ],
    rules: [
      '400 for an invalid field.',
      '409 when another unit of this listing already has that serial number.',
      '404 when not found.',
    ],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(UNIT_ID)
  @ApiOkResponse({ type: UnitDetailResponse })
  @ApiStandardErrors({
    badRequest: 'A field is invalid.',
    notFound: 'Unit not found',
    conflict: 'Another unit of this listing already has that serial number',
  })
  updateUnit(
    @CurrentUser('id') adminId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: AdminUpdateUnitDto,
  ): Promise<UnitDetailResponse> {
    return this.equipment.updateUnit(adminId, unitId, dto);
  }

  @Get('listings')
  @ApiEndpoint({
    summary: 'Every listing, across vendors',
    does: 'The full catalogue from the admin side. Archived ones are left out unless `status=ARCHIVED`.',
    behind: ['Read only.'],
  })
  @ApiPaginatedResponse(ListingAdminRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  listings(@Query() query: AdminListingsQuery): Promise<Paginated<ListingAdminRowResponse>> {
    return this.equipment.listings(query);
  }

  @Post('listings')
  @ApiEndpoint({
    summary: 'Add Equipment for a vendor',
    does: 'Creates a draft listing owned by `vendorId`. Then add photos, submit, and approve.',
    behind: [
      "Runs through the vendor's own equipment rules, as that vendor — an admin edit is held to exactly what the vendor could do.",
      'Admin audit log written.',
    ],
    seenBy: ['Vendor: a new draft listing.'],
    rules: [
      '400 for an invalid field, or the category does not exist.',
      '404 when the vendor is not found.',
    ],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({
    badRequest: 'A field is invalid, or the category does not exist.',
    notFound: 'Vendor not found',
  })
  createListing(
    @CurrentUser('id') adminId: string,
    @Body() dto: AdminCreateEquipmentDto,
  ): Promise<EquipmentDetailResponse> {
    const { vendorId, ...rest } = dto;
    return this.equipment.createListing(adminId, vendorId, rest);
  }

  @Get('listings/:listingId')
  @ApiEndpoint({
    summary: 'A listing, as its vendor sees it — with units and availability',
    does: 'One listing with its images, units and calendar.',
    behind: ['Read only.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({ notFound: 'Listing not found' })
  listing(@Param('listingId', ParseUUIDPipe) listingId: string): Promise<EquipmentDetailResponse> {
    return this.equipment.listing(listingId);
  }

  @Patch('listings/:listingId')
  @ApiEndpoint({
    summary: 'Edit a listing',
    does: "Send only what changes. Runs through the vendor's own equipment rules.",
    behind: ['Listing updated; admin audit log written.'],
    rules: ['400 for an invalid field.', '404 when not found.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({ badRequest: 'A field is invalid.', notFound: 'Listing not found' })
  updateListing(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: UpdateEquipmentDto,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.updateListing(adminId, listingId, dto);
  }

  @Post('listings/:listingId/images')
  @ApiEndpoint({
    summary: 'Add a photo to a listing',
    does: 'Uploads a PNG, JPEG or WebP image. The first photo becomes the main image.',
    behind: ["Photo stored on Cloudinary under the vendor's folder.", 'Admin audit log written.'],
    rules: ['400 for no file, or not a PNG/JPEG/WebP image.', '404 when the listing is not found.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: EquipmentImageResponse })
  @ApiStandardErrors({
    badRequest: 'No file, or not a PNG/JPEG/WebP image.',
    notFound: 'Listing not found',
  })
  addImage(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<EquipmentImageResponse> {
    return this.equipment.addImage(adminId, listingId, file);
  }

  @Post('listings/:listingId/submit')
  @ApiEndpoint({
    summary: 'Submit a listing for review',
    does: 'Needs photos, a price, a description and a condition rating, and a verified vendor. A first unit is created when it has none.',
    behind: ['Status → PENDING_REVIEW.', 'Admin audit log written.'],
    rules: [
      '400 when the listing is not ready for review (`outstandingRequirements` lists what is missing).',
      '404 when not found.',
      '409 when the listing is already awaiting review.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({
    badRequest: 'Listing is not ready for review (`outstandingRequirements` lists what is missing)',
    notFound: 'Listing not found',
    conflict: 'This listing is already awaiting review',
  })
  submit(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.submit(adminId, listingId);
  }

  @Post('listings/:listingId/units')
  @ApiEndpoint({
    summary: 'Add a physical unit to a listing',
    does: 'Creates a new copy of the equipment.',
    behind: ['Unit added with label, serial, condition. Admin audit log written.'],
    rules: [
      '404 when the listing is not found.',
      '409 when another unit of this listing already has that serial number.',
    ],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: UnitDetailResponse, description: 'The new unit.' })
  @ApiStandardErrors({
    notFound: 'Listing not found',
    conflict: 'Another unit of this listing already has that serial number',
  })
  addUnit(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: CreateUnitDto,
  ): Promise<UnitDetailResponse> {
    return this.equipment.addUnit(adminId, listingId, dto);
  }

  @Post('listings/:listingId/suspend')
  @ApiEndpoint({
    summary: 'Take a listing off the catalogue',
    does: 'Published listings only. The listing loses any promotion; the vendor is told why.',
    behind: [
      'Listing status → SUSPENDED; feature tier cleared.',
      'Notification: vendor — Listing Suspended (with the reason).',
      'Admin audit log written.',
    ],
    seenBy: ['Vendor: "Your listing has been temporarily removed".'],
    rules: ['404 when not found.', '409 when it is not published.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({
    notFound: 'Listing not found',
    conflict: 'Only a published listing can be suspended',
  })
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: SuspendListingDto,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.setSuspended(adminId, listingId, true, dto.reason);
  }

  @Post('listings/:listingId/unsuspend')
  @ApiEndpoint({
    summary: 'Put a suspended listing back on the catalogue',
    does: 'Restores a suspended listing to Published.',
    behind: ['Listing status → PUBLISHED. Admin audit log written.'],
    seenBy: ['Vendor: the listing is live again.'],
    rules: ['404 when not found.', '409 when it is not suspended.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({ notFound: 'Listing not found', conflict: 'This listing is not suspended' })
  unsuspend(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.setSuspended(adminId, listingId, false);
  }
}

@ApiTags('admin · categories')
@AdminAccess()
@Controller({ path: 'admin/categories', version: '1' })
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Equipment Categories, or Talent Categories & Skills (`kind=TALENT`)',
    does: "In display order, with unit counts (equipment) or talent counts (talent), and each category's associations.",
    behind: ['Read only.'],
  })
  @ApiOkResponse({ type: [AdminCategoryResponse] })
  @ApiStandardErrors({ badRequest: 'Unknown `kind`.' })
  list(@Query() query: AdminCategoriesQuery): Promise<AdminCategoryResponse[]> {
    return this.categories.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Category detail',
    does: 'One category with its associations and counts.',
    behind: ['Read only.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(CATEGORY_ID)
  @ApiOkResponse({ type: AdminCategoryResponse })
  @ApiStandardErrors({ notFound: 'Category not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminCategoryResponse> {
    return this.categories.get(id);
  }

  @Post()
  @ApiEndpoint({
    summary: 'Create Category',
    does: 'Name, internal description, skills (talent), parent (one level deep), visibility and associations. The slug is derived from the name when omitted.',
    behind: ['Added at the end of the display order. Admin audit log written.'],
    rules: [
      '400 when the parent must be a category of the same kind.',
      '409 when a category with the slug already exists.',
    ],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiOkResponse({ type: AdminCategoryResponse })
  @ApiStandardErrors({
    badRequest: 'The parent must be a category of the same kind',
    conflict: 'A category with the slug "cinema-cameras" already exists',
  })
  create(
    @CurrentUser('id') adminId: string,
    @Body() dto: CategoryDto,
  ): Promise<AdminCategoryResponse> {
    return this.categories.create(adminId, dto);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Edit Category',
    does: 'Send only what changes. `associationIds` replaces the whole list.',
    behind: ['Admin audit log written.'],
    rules: [
      '400 when a category cannot be its own parent.',
      '404 when not found.',
      '409 when a category with that slug already exists.',
    ],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(CATEGORY_ID)
  @ApiOkResponse({ type: AdminCategoryResponse })
  @ApiStandardErrors({
    badRequest: 'A category cannot be its own parent',
    notFound: 'Category not found',
    conflict: 'A category with that slug already exists',
  })
  update(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<AdminCategoryResponse> {
    return this.categories.update(adminId, id, dto);
  }

  @Delete(':id')
  @ApiEndpoint({
    summary: 'Delete a category',
    does: 'Deleted when nothing uses it. With equipment, services or subcategories it is hidden instead, so nothing points at a missing category.',
    behind: [
      'Hard-deleted when empty; soft-deleted (hidden) when equipment, talent services or subcategories depend on it.',
      'Admin audit log written.',
    ],
    rules: ['404 when not found.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(CATEGORY_ID)
  @ApiOkResponse({ type: CategoryDeleteResponse })
  @ApiStandardErrors({ notFound: 'Category not found' })
  remove(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategoryDeleteResponse> {
    return this.categories.remove(adminId, id);
  }

  @Put('order/:kind')
  @ApiEndpoint({
    summary: 'Reorder every category of a kind',
    does: 'Send every category id of the kind exactly once, in the new order.',
    behind: ['Display order rewritten. Admin audit log written.'],
    rules: ['400 when the list is incomplete or has duplicates.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam({ name: 'kind', enum: CategoryKind, example: CategoryKind.EQUIPMENT })
  @ApiOkResponse({ type: [AdminCategoryResponse] })
  @ApiStandardErrors({ badRequest: 'Send every equipment category exactly once' })
  reorder(
    @CurrentUser('id') adminId: string,
    @Param('kind') kind: CategoryKind,
    @Body() dto: ReorderCategoriesDto,
  ): Promise<AdminCategoryResponse[]> {
    return this.categories.reorder(
      adminId,
      kind === CategoryKind.TALENT ? CategoryKind.TALENT : CategoryKind.EQUIPMENT,
      dto.ids,
    );
  }

  @Post(':id/move')
  @ApiEndpoint({
    summary: 'The up / down arrows',
    does: 'Swaps with its neighbour; at either end nothing moves. Returns the new order.',
    behind: ['Display order swap. Admin audit log written.'],
    rules: ['404 when not found.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(CATEGORY_ID)
  @ApiOkResponse({ type: [AdminCategoryResponse] })
  @ApiStandardErrors({ notFound: 'Category not found' })
  move(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveCategoryDto,
  ): Promise<AdminCategoryResponse[]> {
    return this.categories.move(adminId, id, dto.direction);
  }

  @Post(':id/thumbnail')
  @ApiEndpoint({
    summary: 'Upload the category thumbnail',
    does: 'Replaces the old one.',
    behind: [
      'Image stored on Cloudinary. The old thumbnail is not deleted (Cloudinary handles expiry). Admin audit log written.',
    ],
    rules: ['400 for no file, or not a PNG/JPEG/WebP image.', '404 when not found.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiParam(CATEGORY_ID)
  @ApiOkResponse({ type: AdminCategoryResponse })
  @ApiStandardErrors({
    badRequest: 'No file, or not a PNG/JPEG/WebP image.',
    notFound: 'Category not found',
  })
  thumbnail(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<AdminCategoryResponse> {
    return this.categories.setThumbnail(adminId, id, file);
  }
}
