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
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminTier, CategoryKind } from '@prisma/client';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
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

const AS_VENDOR =
  'Runs through the vendor’s own equipment rules, as that vendor — an admin edit is held to ' +
  'exactly what the vendor could do.';

@ApiTags('admin · equipment')
@AdminAccess()
@Controller({ path: 'admin/equipment', version: '1' })
export class AdminEquipmentController {
  constructor(private readonly equipment: AdminEquipmentService) {}

  @Get('kpis')
  @ApiOperation({
    summary: 'Equipment Management tiles',
    description: 'Total units, available, on rental, needs attention — across every vendor.',
  })
  @ApiOkResponse({ type: EquipmentKpisResponse })
  @ApiStandardErrors()
  kpis(): Promise<EquipmentKpisResponse> {
    return this.equipment.kpis();
  }

  @Get('units')
  @ApiOperation({
    summary: 'Equipment Management — one row per physical unit',
    description:
      'Filter with `state`: AVAILABLE, RESERVED (held for an upcoming rental), RENTED (out), ' +
      'RETURNED (back, awaiting inspection), IN_QA (maintenance or graded Damaged), RETIRED.',
  })
  @ApiPaginatedResponse(UnitRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  units(@Query() query: AdminUnitsQuery): Promise<Paginated<UnitRowResponse>> {
    return this.equipment.units(query);
  }

  @Get('units/:unitId')
  @ApiOperation({
    summary: 'Unit detail',
    description:
      'Overview & Specs, the latest Manual Inspection, Rental Bookings (or "Unit is currently ' +
      'in the Hub Vault"), and Condition History.',
  })
  @ApiParam(UNIT_ID)
  @ApiOkResponse({ type: UnitDetailResponse })
  @ApiStandardErrors({ notFound: 'Unit not found' })
  unit(@Param('unitId', ParseUUIDPipe) unitId: string): Promise<UnitDetailResponse> {
    return this.equipment.unit(unitId);
  }

  @Patch('units/:unitId')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Edit a unit',
    description:
      'Label, serial, condition notes, custody, or `status` (MAINTENANCE takes it out of ' +
      'service, RETIRED for good). Send only what changes.',
  })
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
  @ApiOperation({ summary: 'Every listing, across vendors', description: 'Archived ones are left out unless `status=ARCHIVED`.' })
  @ApiPaginatedResponse(ListingAdminRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  listings(@Query() query: AdminListingsQuery): Promise<Paginated<ListingAdminRowResponse>> {
    return this.equipment.listings(query);
  }

  @Post('listings')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Add Equipment for a vendor',
    description:
      'Created as a draft owned by `vendorId`. Then add photos, submit, and approve at ' +
      '`POST /admin/review/listings/:id/approve`. ' +
      AS_VENDOR,
  })
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
  @ApiOperation({ summary: 'A listing, as its vendor sees it — with units and availability' })
  @ApiParam(LISTING_ID)
  @ApiOkResponse({ type: EquipmentDetailResponse })
  @ApiStandardErrors({ notFound: 'Listing not found' })
  listing(@Param('listingId', ParseUUIDPipe) listingId: string): Promise<EquipmentDetailResponse> {
    return this.equipment.listing(listingId);
  }

  @Patch('listings/:listingId')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Edit a listing', description: `Send only what changes. ${AS_VENDOR}` })
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
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Add a photo to a listing', description: 'The first photo becomes the main image.' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Submit a listing for review',
    description:
      'Needs photos, a price, a description and a condition rating, and a verified vendor. ' +
      'A first unit is created when it has none.',
  })
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
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Add a physical unit to a listing' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Take a listing off the catalogue',
    description: 'Published listings only. It loses any promotion; the vendor is told why.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Put a suspended listing back on the catalogue' })
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
  @ApiOperation({
    summary: 'Equipment Categories, or Talent Categories & Skills (`kind=TALENT`)',
    description:
      'In display order, with available / on rental / in QA unit counts (equipment) or talent ' +
      'counts (talent), and each category’s associations.',
  })
  @ApiOkResponse({ type: [AdminCategoryResponse] })
  @ApiStandardErrors({ badRequest: 'Unknown `kind`.' })
  list(@Query() query: AdminCategoriesQuery): Promise<AdminCategoryResponse[]> {
    return this.categories.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Category detail' })
  @ApiParam(CATEGORY_ID)
  @ApiOkResponse({ type: AdminCategoryResponse })
  @ApiStandardErrors({ notFound: 'Category not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminCategoryResponse> {
    return this.categories.get(id);
  }

  @Post()
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Create Category',
    description:
      'Name, internal description, skills (talent), parent (one level deep), visibility and ' +
      'associations. The slug is derived from the name when omitted. Added at the end of the order.',
  })
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
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Edit Category',
    description: 'Send only what changes. `associationIds` replaces the whole list.',
  })
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
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Delete a category',
    description:
      'Deleted when nothing uses it. With equipment, services or subcategories it is hidden ' +
      'instead (`deleted: false`), so nothing points at a missing category.',
  })
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
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Reorder every category of a kind',
    description: 'Send every category id of the kind exactly once, in the new order.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'The up / down arrows',
    description: 'Swaps with its neighbour; at either end nothing moves. Returns the new order.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Upload the category thumbnail', description: 'Replaces the old one.' })
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
