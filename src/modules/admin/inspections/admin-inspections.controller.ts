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
import { ApiBody, ApiConsumes, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
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
  @ApiEndpoint({
    summary: 'Inspections & QA',
    does: 'Every inspection across all units and bookings, newest first. `flagged=true` for Needs Attention and Damaged.',
    behind: [
      'Read only. Includes outgoing (hub → client), return (client → hub) and routine (staff check) inspections.',
    ],
  })
  @ApiPaginatedResponse(InspectionResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: InspectionsQuery): Promise<Paginated<InspectionResponse>> {
    return this.inspections.list(query);
  }

  @Get('inspections/:id')
  @ApiEndpoint({
    summary: 'One inspection, with its photos',
    does: 'The grade, notes, pass/fail checks, inspector, and every photo.',
    behind: ['Read only. Photos served as private `/api/v1/files/…` links.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(INSPECTION_ID)
  @ApiOkResponse({ type: InspectionResponse })
  @ApiStandardErrors({ notFound: 'Inspection not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InspectionResponse> {
    return this.inspections.get(id);
  }

  @Get('inspections/:id/sheet.pdf')
  @ApiEndpoint({
    summary: 'The inspection sheet',
    does: 'A PDF the hub can print: the grade, checks, notes and photos on one page.',
    behind: ['Rendered on demand from the inspection record. Nothing is stored.'],
    rules: ['404 when not found.'],
  })
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
  @ApiEndpoint({
    summary: 'Remove a photo from an inspection',
    does: 'Deletes one photo. The file is removed from storage.',
    behind: ['Photo deleted from Cloudinary and from the database.', 'Admin audit log written.'],
    rules: ['404 when the photo is not found.'],
  })
  @AdminAccess(AdminTier.ADMIN)
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
  @ApiEndpoint({
    summary: 'Condition History of a unit',
    does: 'Its routine checks, and the outgoing and return inspections of every rental it went out on. Newest first.',
    behind: ['Read only.'],
  })
  @ApiParam(UNIT_ID)
  @ApiOkResponse({ type: [InspectionResponse] })
  @ApiStandardErrors()
  history(@Param('unitId', ParseUUIDPipe) unitId: string): Promise<InspectionResponse[]> {
    return this.inspections.unitHistory(unitId);
  }

  @Post('units/:unitId/inspections')
  @ApiEndpoint({
    summary: 'Manual Inspection of a unit — staff check or routine service',
    does: 'A hub inspection outside any rental: grades the unit, records notes and photos. A Damaged grade takes the unit out of rotation.',
    behind: [
      'One ROUTINE inspection created for the unit.',
      'Photos (multipart `photos`, up to 6) stored privately on Cloudinary.',
      'Unit: last grade, last inspected and condition updated; a DAMAGED grade puts it in MAINTENANCE.',
      'Admin audit log written.',
    ],
    rules: ['400 for an invalid grade, or too many photos.', '404 when the unit is not found.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('multipart/form-data', 'application/json')
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
