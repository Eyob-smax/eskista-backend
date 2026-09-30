import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { UploadedFile } from '../../../common/upload';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { PDF_CONTENT, sendPdf } from '../core/admin-http';
import { AdminInspectionsService } from './admin-inspections.service';
import { InspectionResponse, InspectionsQuery, RecordInspectionDto } from './dto/inspection.dto';

const INSPECTION_ID = { name: 'id', format: 'uuid', description: 'The inspection id.' };
const UNIT_ID = { name: 'unitId', format: 'uuid', description: 'The equipment unit id.' };

@ApiTags('admin · inspections')
@AdminAccess()
@Controller({ path: 'admin', version: '1' })
export class AdminInspectionsController {
  constructor(private readonly inspections: AdminInspectionsService) {}

  @Get('inspections')
  @ApiOperation({
    summary: 'Inspections & QA',
    description: 'Every inspection, newest first. `flagged=true` for Needs Attention and Damaged.',
  })
  @ApiPaginatedResponse(InspectionResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: InspectionsQuery): Promise<Paginated<InspectionResponse>> {
    return this.inspections.list(query);
  }

  @Get('inspections/:id')
  @ApiOperation({ summary: 'One inspection, with its photos' })
  @ApiParam(INSPECTION_ID)
  @ApiOkResponse({ type: InspectionResponse })
  @ApiStandardErrors({ notFound: 'Inspection not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InspectionResponse> {
    return this.inspections.get(id);
  }

  @Get('inspections/:id/sheet.pdf')
  @ApiOperation({ summary: 'The inspection sheet' })
  @ApiParam(INSPECTION_ID)
  @ApiOkResponse({ description: 'The PDF.', content: PDF_CONTENT })
  @ApiStandardErrors({ notFound: 'Inspection not found' })
  async sheet(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.inspections.sheet(id);
    return sendPdf(res, buffer, filename);
  }

  @Delete('inspections/:id/photos/:photoId')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Remove a photo from an inspection' })
  @ApiParam(INSPECTION_ID)
  @ApiParam({ name: 'photoId', format: 'uuid' })
  @ApiOkResponse({ type: InspectionResponse })
  @ApiStandardErrors({ notFound: 'Photo not found' })
  removePhoto(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<InspectionResponse> {
    return this.inspections.removePhoto(adminId, id, photoId);
  }

  @Get('units/:unitId/inspections')
  @ApiOperation({
    summary: 'Condition History of a unit',
    description:
      'Its routine checks, and the outgoing and return inspections of every rental it went out on. Newest first.',
  })
  @ApiParam(UNIT_ID)
  @ApiOkResponse({ type: [InspectionResponse] })
  @ApiStandardErrors()
  history(@Param('unitId', ParseUUIDPipe) unitId: string): Promise<InspectionResponse[]> {
    return this.inspections.unitHistory(unitId);
  }

  @Post('units/:unitId/inspections')
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Manual Inspection of a unit — staff check or routine service',
    description: 'Outside any rental. A Damaged grade takes the unit out of rotation.',
  })
  @ApiParam(UNIT_ID)
  @ApiBody({
    description: 'JSON, or multipart/form-data with up to 6 `photos`.',
    schema: {
      type: 'object',
      required: ['grade'],
      properties: {
        grade: {
          type: 'string',
          enum: ['PRISTINE', 'EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_ATTENTION', 'DAMAGED'],
          example: 'GOOD',
        },
        notes: { type: 'string', example: 'Routine service: sensor cleaned, firmware updated.' },
        inspectorName: { type: 'string', example: 'Dawit (hub technician)' },
        physicalPassed: { type: 'boolean', example: true },
        functionalPassed: { type: 'boolean', example: true },
        photos: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: 6 },
      },
    },
  })
  @ApiOkResponse({ type: InspectionResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid grade, or too many photos.',
    notFound: 'Unit not found',
  })
  routine(
    @CurrentUser('id') adminId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: RecordInspectionDto,
    @UploadedFiles() photos: UploadedFile[] = [],
  ): Promise<InspectionResponse> {
    return this.inspections.recordRoutine(adminId, unitId, dto, photos ?? []);
  }
}
