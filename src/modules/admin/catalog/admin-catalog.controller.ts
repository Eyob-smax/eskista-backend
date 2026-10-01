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
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminTier, CategoryKind } from '@prisma/client';

import type { UploadedFile } from '../../../common/upload';
import { CurrentUser } from '../../auth/auth.decorators';
import { CreateUnitDto, UpdateEquipmentDto } from '../../equipment/dto/equipment.dto';
import { AdminAccess } from '../core/admin-access';
import {
  AdminCategoriesQuery,
  AdminCreateEquipmentDto,
  AdminListingsQuery,
  AdminUnitsQuery,
  AdminUpdateUnitDto,
  CategoryDto,
  MoveCategoryDto,
  ReorderCategoriesDto,
  SuspendListingDto,
  UpdateCategoryDto,
} from './admin-catalog.dto';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminEquipmentService } from './admin-equipment.service';

const IMAGE_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary', description: 'PNG, JPEG or WebP.' } },
  },
};

@ApiTags('admin · equipment')
@AdminAccess()
@Controller({ path: 'admin/equipment', version: '1' })
export class AdminEquipmentController {
  constructor(private readonly equipment: AdminEquipmentService) {}

  @Get('kpis')
  @ApiOperation({
    summary: 'Equipment Management tiles: total units, available, on rental, needs attention',
  })
  kpis(): Promise<any> {
    return this.equipment.kpis();
  }

  @Get('units')
  @ApiOperation({ summary: 'Equipment Management — one row per physical unit' })
  units(@Query() query: AdminUnitsQuery): Promise<any> {
    return this.equipment.units(query);
  }

  @Get('units/:unitId')
  @ApiOperation({
    summary: 'Unit detail',
    description:
      'Overview & Specs, the latest Manual Inspection, Rental Bookings, and Condition History.',
  })
  unit(@Param('unitId', ParseUUIDPipe) unitId: string): Promise<any> {
    return this.equipment.unit(unitId);
  }

  @Patch('units/:unitId')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Edit a unit — label, serial, custody, or take it out of service' })
  updateUnit(
    @CurrentUser('id') adminId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: AdminUpdateUnitDto,
  ): Promise<any> {
    return this.equipment.updateUnit(adminId, unitId, dto);
  }

  @Get('listings')
  @ApiOperation({ summary: 'Every listing, across vendors' })
  listings(@Query() query: AdminListingsQuery): Promise<any> {
    return this.equipment.listings(query);
  }

  @Post('listings')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Add Equipment for a vendor',
    description:
      'Created as a draft. Add photos, submit, then approve at `/admin/review/listings/:id/approve`.',
  })
  createListing(@CurrentUser('id') adminId: string, @Body() dto: AdminCreateEquipmentDto) {
    const { vendorId, ...rest } = dto;
    return this.equipment.createListing(adminId, vendorId, rest);
  }

  @Get('listings/:listingId')
  listing(@Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.equipment.listing(listingId);
  }

  @Patch('listings/:listingId')
  @AdminAccess(AdminTier.ADMIN)
  updateListing(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.equipment.updateListing(adminId, listingId, dto);
  }

  @Post('listings/:listingId/images')
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  addImage(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @UploadedFileParam() file: UploadedFile,
  ) {
    return this.equipment.addImage(adminId, listingId, file);
  }

  @Post('listings/:listingId/submit')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  submit(@CurrentUser('id') adminId: string, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.equipment.submit(adminId, listingId);
  }

  @Post('listings/:listingId/units')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Add a physical unit to a listing' })
  addUnit(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: CreateUnitDto,
  ): Promise<any> {
    return this.equipment.addUnit(adminId, listingId, dto);
  }

  @Post('listings/:listingId/suspend')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Take a listing off the catalogue' })
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: SuspendListingDto,
  ) {
    return this.equipment.setSuspended(adminId, listingId, true, dto.reason);
  }

  @Post('listings/:listingId/unsuspend')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  unsuspend(
    @CurrentUser('id') adminId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
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
    description: 'In display order, with unit counts (equipment) or talent counts (talent).',
  })
  list(@Query() query: AdminCategoriesQuery): Promise<any> {
    return this.categories.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<any> {
    return this.categories.get(id);
  }

  @Post()
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Create Category — name, description, skills, associations' })
  create(
    @CurrentUser('id') adminId: string,
    @Body() dto: CategoryDto,
  ): Promise<any> {
    return this.categories.create(adminId, dto);
  }

  @Patch(':id')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Edit Category — incl. Publicly Visible and associations' })
  update(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<any> {
    return this.categories.update(adminId, id, dto);
  }

  @Delete(':id')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Delete — or hide, when equipment or services use it' })
  remove(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean }> {
    return this.categories.remove(adminId, id);
  }

  @Put('order/:kind')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Reorder every category of a kind' })
  reorder(
    @CurrentUser('id') adminId: string,
    @Param('kind') kind: CategoryKind,
    @Body() dto: ReorderCategoriesDto,
  ): Promise<any[]> {
    return this.categories.reorder(
      adminId,
      kind === CategoryKind.TALENT ? CategoryKind.TALENT : CategoryKind.EQUIPMENT,
      dto.ids,
    );
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'The up / down arrows' })
  move(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveCategoryDto,
  ): Promise<any[]> {
    return this.categories.move(adminId, id, dto.direction);
  }

  @Post(':id/thumbnail')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  thumbnail(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<any> {
    return this.categories.setThumbnail(adminId, id, file);
  }
}
