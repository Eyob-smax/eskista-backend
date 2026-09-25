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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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

@ApiTags('vendor · equipment')
@ApiBearerAuth()
@Roles('VENDOR')
@Controller({ path: 'vendor/equipment', version: '1' })
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({
    summary: 'Create a draft listing',
    description:
      'Accepts the full B&H-style payload in one call — basics, technical, condition, ' +
      "what's included and rental terms. Photos and units are added separately.",
  })
  @ApiCreatedResponse({ type: EquipmentDetailResponse })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEquipmentDto,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List my equipment',
    description:
      'Paginated, searchable and sortable. `availabilityLabel` is derived from live ' +
      'bookings, never stored.',
  })
  @ApiOkResponse({ type: [EquipmentSummaryResponse] })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: EquipmentListQuery,
  ): Promise<Paginated<EquipmentSummaryResponse>> {
    return this.equipment.list(userId, query);
  }

  @Get(':listingId')
  @ApiOperation({ summary: 'Get one of my listings in full' })
  @ApiOkResponse({ type: EquipmentDetailResponse })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.findOne(userId, listingId);
  }

  @Patch(':listingId')
  @ApiOperation({
    summary: 'Update a listing',
    description:
      'Editing a PUBLISHED listing returns it to PENDING_REVIEW so nothing changes ' +
      'under customers without Eskista seeing it. Passing `specs` or `includedItems` ' +
      'replaces those collections wholesale.',
  })
  @ApiOkResponse({ type: EquipmentDetailResponse })
  update(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: UpdateEquipmentDto,
  ): Promise<EquipmentDetailResponse> {
    return this.equipment.update(userId, listingId, dto);
  }

  @Delete(':listingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archive a listing',
    description: 'Archives rather than deletes, so booking history survives.',
  })
  @ApiNoContentResponse()
  archive(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<void> {
    return this.equipment.archive(userId, listingId);
  }

  @Post(':listingId/submit')
  @ApiOperation({
    summary: 'Submit a listing for Eskista review',
    description:
      'Requires a verified vendor profile. Returns the outstanding requirements if the ' +
      'listing is incomplete.',
  })
  @ApiOkResponse({ type: EquipmentDetailResponse })
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
  @ApiOperation({
    summary: 'Add a photo',
    description: 'PNG, JPEG or WebP up to 5MB. The first upload becomes the main image.',
  })
  @ApiBody(binaryBody)
  @ApiCreatedResponse({ type: EquipmentImageResponse })
  addImage(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<EquipmentImageResponse> {
    return this.equipment.addImage(userId, listingId, file);
  }

  @Patch(':listingId/images/:imageId')
  @ApiOperation({
    summary: 'Reorder a photo or make it the main image',
    description: 'Setting `isPrimary` demotes the previous main image in the same transaction.',
  })
  @ApiOkResponse({ type: EquipmentImageResponse })
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
  @ApiOperation({
    summary: 'Delete a photo',
    description: 'If the main image is removed, the next photo is promoted automatically.',
  })
  @ApiNoContentResponse()
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
  @ApiOperation({ summary: 'Replace the secondary specifications table' })
  @ApiNoContentResponse()
  replaceSpecs(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: ReplaceSpecsDto,
  ): Promise<void> {
    return this.equipment.replaceSpecs(userId, listingId, dto);
  }

  @Put(':listingId/included-items')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Replace what's included",
    description: 'Both lists in one call, distinguished by `kind` (EQUIPMENT or ACCESSORY).',
  })
  @ApiNoContentResponse()
  replaceIncludedItems(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: ReplaceIncludedItemsDto,
  ): Promise<void> {
    return this.equipment.replaceIncludedItems(userId, listingId, dto);
  }

  @Put(':listingId/accessories')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set related accessories',
    description: 'Must reference your own listings. Powers the "Related Accessories" rail.',
  })
  @ApiNoContentResponse()
  replaceAccessories(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: ReplaceAccessoriesDto,
  ): Promise<void> {
    return this.equipment.replaceAccessories(userId, listingId, dto);
  }

  // ── Units ──────────────────────────────────────────────────────────────────

  @Get(':listingId/units')
  @ApiOperation({
    summary: 'List physical units',
    description: 'Each unit is an individually tracked copy that admin can assign to a booking.',
  })
  @ApiOkResponse({ type: [EquipmentUnitResponse] })
  listUnits(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<EquipmentUnitResponse[]> {
    return this.equipment.listUnits(userId, listingId);
  }

  @Post(':listingId/units')
  @ApiOperation({ summary: 'Add a physical unit' })
  @ApiCreatedResponse({ type: EquipmentUnitResponse })
  createUnit(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: CreateUnitDto,
  ): Promise<EquipmentUnitResponse> {
    return this.equipment.createUnit(userId, listingId, dto);
  }

  @Patch(':listingId/units/:unitId')
  @ApiOperation({
    summary: 'Update a unit',
    description: 'A unit on a live booking cannot be taken out of service.',
  })
  @ApiOkResponse({ type: EquipmentUnitResponse })
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
  @ApiOperation({
    summary: 'Delete a unit',
    description: 'Only possible while it has no booking history; otherwise retire it.',
  })
  @ApiNoContentResponse()
  deleteUnit(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ): Promise<void> {
    return this.equipment.deleteUnit(userId, listingId, unitId);
  }

  // ── Availability ───────────────────────────────────────────────────────────

  @Get(':listingId/availability')
  @ApiOperation({
    summary: 'Availability calendar',
    description:
      'One cell per day with state AVAILABLE | BLOCKED | RESERVED | RENTED, matching the ' +
      'vendor calendar legend. Max 190 days per request.',
  })
  @ApiOkResponse({ type: [AvailabilityDayResponse] })
  getAvailability(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Query() query: AvailabilityQuery,
  ): Promise<AvailabilityDayResponse[]> {
    return this.equipment.getAvailability(userId, listingId, query);
  }

  @Post(':listingId/availability/:date/toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tap a date to cycle its status',
    description:
      'Set Availability: toggles one day between AVAILABLE and BLOCKED and returns the new ' +
      'cell. Unblocking a day inside a longer blocked range splits it. RENTED and RESERVED ' +
      'days come from bookings: **409**.',
  })
  @ApiOkResponse({ type: AvailabilityDayResponse })
  toggleDate(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('date') date: string,
  ): Promise<AvailabilityDayResponse> {
    return this.equipment.toggleDate(userId, listingId, date);
  }

  @Post(':listingId/blocked-dates')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Block a date range',
    description:
      'Blocked dates prevent Eskista from accepting requests. Ranges covering a ' +
      'confirmed booking are rejected.',
  })
  @ApiNoContentResponse()
  blockDates(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: BlockDatesDto,
  ): Promise<void> {
    return this.equipment.blockDates(userId, listingId, dto);
  }

  @Delete(':listingId/blocked-dates/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a blocked range' })
  @ApiNoContentResponse()
  unblockDates(
    @CurrentUser('id') userId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ): Promise<void> {
    return this.equipment.unblockDates(userId, listingId, blockId);
  }
}
