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
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { UploadedFile } from '../../common/upload';
import {
  CreateVendorProfileDto,
  UpdateVendorProfileDto,
  UploadVendorDocumentDto,
  VendorDashboardResponse,
  VendorDocumentResponse,
  VendorProfileResponse,
} from './dto/vendor.dto';
import { VendorService } from './vendor.service';

@ApiTags('vendor')
@ApiBearerAuth()
@Controller({ path: 'vendor', version: '1' })
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post('onboarding')
  @ApiOperation({
    summary: 'Create the signed-in user’s vendor profile',
    description:
      'Grants the VENDOR role immediately so the vendor experience is reachable while ' +
      'the profile is still a draft. Verification is a separate, admin-driven step.',
  })
  @ApiCreatedResponse({ type: VendorProfileResponse })
  createProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateVendorProfileDto,
  ): Promise<VendorProfileResponse> {
    return this.vendorService.createProfile(userId, dto);
  }

  @Get('me')
  @Roles('VENDOR')
  @ApiOperation({
    summary: 'Get my vendor profile',
    description:
      'Includes `outstandingRequirements` and `canSubmitForVerification` so the client ' +
      'can render the verification checklist without duplicating the rules.',
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  getProfile(@CurrentUser('id') userId: string): Promise<VendorProfileResponse> {
    return this.vendorService.getProfile(userId);
  }

  @Patch('me')
  @Roles('VENDOR')
  @ApiOperation({
    summary: 'Update my business information',
    description:
      'Changing the business name or vendor kind on an already-verified profile returns ' +
      'it to PENDING_REVIEW.',
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateVendorProfileDto,
  ): Promise<VendorProfileResponse> {
    return this.vendorService.updateProfile(userId, dto);
  }

  @Post('me/logo')
  @Roles('VENDOR')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace my logo / profile picture' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  updateLogo(
    @CurrentUser('id') userId: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<VendorProfileResponse> {
    return this.vendorService.updateLogo(userId, file);
  }

  @Get('me/documents')
  @Roles('VENDOR')
  @ApiOperation({ summary: 'List my verification documents' })
  @ApiOkResponse({ type: [VendorDocumentResponse] })
  listDocuments(@CurrentUser('id') userId: string): Promise<VendorDocumentResponse[]> {
    return this.vendorService.listDocuments(userId);
  }

  @Post('me/documents')
  @Roles('VENDOR')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a verification document',
    description:
      'Re-uploading the same type replaces the previous file. PNG, JPEG, WebP or PDF, ' +
      'up to 5MB.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: {
          type: 'string',
          enum: ['FAYDA_ID', 'BUSINESS_REGISTRATION', 'RENTAL_AGREEMENT', 'TIN_CERTIFICATE', 'OTHER'],
        },
      },
    },
  })
  @ApiCreatedResponse({ type: VendorDocumentResponse })
  uploadDocument(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadVendorDocumentDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<VendorDocumentResponse> {
    return this.vendorService.uploadDocument(userId, dto.type, file);
  }

  @Delete('me/documents/:documentId')
  @Roles('VENDOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a document that has not been verified yet' })
  @ApiNoContentResponse()
  deleteDocument(
    @CurrentUser('id') userId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    return this.vendorService.deleteDocument(userId, documentId);
  }

  @Post('me/submit')
  @Roles('VENDOR')
  @ApiOperation({
    summary: 'Submit my profile for Eskista verification',
    description:
      'Rejects with the outstanding requirements list if anything is still missing, so ' +
      'the client never has to guess why submission failed.',
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  submitForVerification(@CurrentUser('id') userId: string): Promise<VendorProfileResponse> {
    return this.vendorService.submitForVerification(userId);
  }

  @Get('me/dashboard')
  @Roles('VENDOR')
  @ApiOperation({
    summary: 'Vendor home screen',
    description: 'The four KPI tiles plus the "Needs Your Attention" feed.',
  })
  @ApiOkResponse({ type: VendorDashboardResponse })
  getDashboard(@CurrentUser('id') userId: string): Promise<VendorDashboardResponse> {
    return this.vendorService.getDashboard(userId);
  }
}
