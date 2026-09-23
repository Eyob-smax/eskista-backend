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
import {
  AgreementBodyResponse,
  AgreementResponse,
  UploadSignedAgreementDto,
} from '../agreements/dto/agreement.dto';
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
      'up to 5MB. Fayda ID is required for every vendor; business registration only ' +
      'for company vendors. The rental agreement is not uploaded here - Eskista ' +
      'generates it for signature at /vendor/me/agreement.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: {
          type: 'string',
          enum: ['FAYDA_ID', 'BUSINESS_REGISTRATION', 'TIN_CERTIFICATE', 'OTHER'],
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

  @Get('me/agreement')
  @Roles('VENDOR')
  @ApiOperation({
    summary: 'Read the Eskista vendor agreement',
    description:
      'Returns the agreement between Eskista and this vendor, including the exact text ' +
      'frozen when it was issued. Render `body` for the signer — re-rendering from the ' +
      'template would not match `contentHash`. Issued when the profile is submitted; the ' +
      'wording differs for individual and company vendors.',
  })
  @ApiOkResponse({ type: AgreementBodyResponse })
  getAgreement(@CurrentUser('id') userId: string): Promise<AgreementBodyResponse> {
    return this.vendorService.getOnboardingAgreement(userId);
  }

  @Post('me/agreement/signed-copy')
  @Roles('VENDOR')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload the signed Eskista vendor agreement',
    description: `
Contracts are signed **on paper**: download the agreement, print it, sign it by hand, and
upload the scan here. There is no in-app signature pad.

The upload moves the agreement to \`UNDER_REVIEW\`. Eskista then checks the scan is the
right document, legible and actually signed, and either approves or rejects it. Approval is
required before the vendor profile can be verified.

Re-uploading over a **rejected** scan is expected — that is how a blurred photo gets fixed.
Re-uploading over an **approved** one returns 409.

PNG, JPEG, WebP or PDF, up to 10 MB.
`.trim(),
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'signerName'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'The scan. Max 10 MB.' },
        signerName: {
          type: 'string',
          description: 'Who physically signed it.',
          example: 'Shebelaw Bogale',
        },
        signerPhone: { type: 'string', example: '+251911234567' },
      },
    },
  })
  @ApiOkResponse({ type: AgreementResponse })
  uploadSignedAgreement(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadSignedAgreementDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<AgreementResponse> {
    return this.vendorService.uploadSignedOnboardingAgreement(userId, dto, file);
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
