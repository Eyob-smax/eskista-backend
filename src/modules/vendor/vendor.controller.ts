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
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import type { UploadedFile } from '../../common/upload';
import {
  AgreementBodyResponse,
  AgreementResponse,
  UploadSignedAgreementDto,
} from '../agreements/dto/agreement.dto';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  CreateVendorProfileDto,
  UpdateVendorProfileDto,
  UploadVendorDocumentDto,
  VendorDashboardResponse,
  VendorDocumentResponse,
  VendorProfileResponse,
} from './dto/vendor.dto';
import { VendorService } from './vendor.service';

@ApiTags('vendor · profile')
@ApiBearerAuth()
@Controller({ path: 'vendor', version: '1' })
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post('onboarding')
  @ApiEndpoint({
    summary: 'Create Your Vendor Account',
    does: 'Registers the signed-in user as a vendor with business contact details and location, switching active role to VENDOR.',
    behind: [
      'Grants the VENDOR role to the user and switches activeRole to VENDOR.',
      'Creates a VendorProfile in DRAFT status.',
      'Derives kind (INDIVIDUAL vs COMPANY) automatically from vendorType: INDIVIDUAL is INDIVIDUAL; PRODUCTION_COMPANY, RENTAL_COMPANY, CREATIVE_STUDIO are COMPANY.',
      'Prepares the onboarding agreement template.',
    ],
    seenBy: [
      'Vendor Mini App: unlocks vendor dashboard, inventory tab, and onboarding checklist in draft mode.',
      'Admin dashboard: profile appears under /admin/users/vendors in DRAFT status.',
    ],
    rules: [
      '400 if validation fails or acceptTerms is false.',
      '401 if not authenticated.',
      '409 if the user already has a vendor profile.',
    ],
  })
  @ApiCreatedResponse({ type: VendorProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Validation failure or terms not accepted.',
    conflict: 'A vendor profile already exists for this account.',
  })
  createProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateVendorProfileDto,
  ): Promise<VendorProfileResponse> {
    return this.vendorService.createProfile(userId, dto);
  }

  @Get('me')
  @Roles('VENDOR')
  @ApiEndpoint({
    summary: 'Get my vendor profile',
    does: 'Profile and Business Information tab: identity, rating, equipment counts, verification status, and pending requirements.',
    behind: [
      'Read only: reads VendorProfile, aggregates completed bookings, active equipment count, and average review score.',
      'Groups verification status: ID (front and back) and Business License with verified flags.',
      'Calculates outstandingRequirements and canSubmitForVerification in real time.',
    ],
    rules: ['401 if unauthenticated.', '404 if no vendor profile exists yet.'],
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  @ApiStandardErrors({ notFound: 'No vendor profile exists for this account.' })
  getProfile(@CurrentUser('id') userId: string): Promise<VendorProfileResponse> {
    return this.vendorService.getProfile(userId);
  }

  @Patch('me')
  @Roles('VENDOR')
  @ApiEndpoint({
    summary: 'Update my business information',
    does: 'Updates contact name, business phone, email, location, or about text.',
    behind: [
      'Updates VendorProfile record.',
      'If an already VERIFIED profile changes businessName or vendorType, its status reverts to PENDING_REVIEW and Eskista is notified to re-verify.',
    ],
    seenBy: ['Vendor app: updates profile tab immediately.', 'Admin dashboard: reflects modified details.'],
    rules: ['400 if email or phone is invalid.', '401 if unauthenticated.', '404 if no profile exists.'],
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid email, phone number, or text length.',
    notFound: 'Vendor profile not found.',
  })
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
  @ApiEndpoint({
    summary: 'Upload or replace vendor logo / avatar',
    does: 'Uploads a business logo or profile avatar displayed on public equipment listings.',
    behind: [
      'Validates uploaded file: image/jpeg, image/png, image/webp up to 5 MB.',
      'Stores file in media storage, updates logoUrl on VendorProfile.',
    ],
    seenBy: ['Public catalog: shows beside equipment brand and vendor title.', 'Vendor app header.'],
    rules: ['400 if file is not an image or exceeds 5 MB.'],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  @ApiStandardErrors({ badRequest: 'File must be an image (JPEG, PNG, WebP) up to 5 MB.' })
  updateLogo(
    @CurrentUser('id') userId: string,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<VendorProfileResponse> {
    return this.vendorService.updateLogo(userId, file);
  }

  @Get('me/documents')
  @Roles('VENDOR')
  @ApiEndpoint({
    summary: 'List my verification documents',
    does: 'Returns uploaded ID cards, passports, business licenses, and their Eskista verification statuses.',
    behind: ['Read only: reads VendorDocument records for this vendor.'],
    rules: ['401 if unauthenticated.', '404 if vendor profile not found.'],
  })
  @ApiOkResponse({ type: [VendorDocumentResponse] })
  @ApiStandardErrors({ notFound: 'Vendor profile not found.' })
  listDocuments(@CurrentUser('id') userId: string): Promise<VendorDocumentResponse[]> {
    return this.vendorService.listDocuments(userId);
  }

  @Post('me/documents')
  @Roles('VENDOR')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Upload ID or business document',
    does: 'Uploads Fayda ID, passport, or business registration certificate for verification.',
    behind: [
      'Validates file: JPEG, PNG, WebP, PDF up to 5 MB.',
      'For FAYDA_ID and PASSPORT: at most two files (front and back). A third is rejected with 409 until one is removed.',
      'For BUSINESS_LICENSE and other types: replaces previous document of the same type.',
      'Stores file privately with restricted access token.',
    ],
    seenBy: ['Vendor app: adds document card with PENDING badge.', 'Admin dashboard: documents queue under Admin Review.'],
    rules: [
      '400 if unsupported MIME type or over 5 MB.',
      '409 if trying to upload more than two ID files.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: {
          type: 'string',
          enum: [
            'FAYDA_ID',
            'PASSPORT',
            'BUSINESS_LICENSE',
            'BUSINESS_REGISTRATION',
            'TIN_CERTIFICATE',
            'OTHER',
          ],
          example: 'FAYDA_ID',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: VendorDocumentResponse })
  @ApiStandardErrors({
    badRequest: 'Invalid document type or file size.',
    conflict: 'Maximum of two ID files allowed. Remove one to replace.',
  })
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
  @ApiEndpoint({
    summary: 'Remove an unverified document',
    does: 'Deletes an uploaded document before it has been approved by Eskista.',
    behind: [
      'Deletes file from storage.',
      'Removes VendorDocument record from database.',
    ],
    rules: [
      '404 if document does not exist.',
      '409 if document has already been VERIFIED (cannot delete approved documents).',
    ],
  })
  @ApiParam({
    name: 'documentId',
    format: 'uuid',
    description: 'The document ID to delete.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @ApiNoContentResponse({ description: 'Document deleted successfully.' })
  @ApiStandardErrors({
    notFound: 'Document not found.',
    conflict: 'Cannot delete a document that has already been verified.',
  })
  deleteDocument(
    @CurrentUser('id') userId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    return this.vendorService.deleteDocument(userId, documentId);
  }

  @Post('me/submit')
  @Roles('VENDOR')
  @ApiEndpoint({
    summary: 'Submit profile for Eskista verification',
    does: 'Submits the complete vendor profile and documents for Eskista admin review and approval.',
    behind: [
      'Validates completeness: contact name, business name, phone, location, vendor type, required ID documents (plus business license for company vendors).',
      'Issues official onboarding agreement text with SHA-256 hash if not already generated.',
      'Transitions VendorProfile status DRAFT -> PENDING_REVIEW.',
      'Notifies Eskista operations team of pending review.',
    ],
    seenBy: ['Vendor app: status banner changes to "Under Review".', 'Admin dashboard: appears in Vendor Review queue.'],
    rules: [
      '400 with outstandingRequirements if required profile fields or documents are missing.',
      '409 if already VERIFIED or currently PENDING_REVIEW.',
    ],
  })
  @ApiOkResponse({ type: VendorProfileResponse })
  @ApiStandardErrors({
    badRequest: 'Profile has outstanding requirements before submission.',
    conflict: 'Profile is already submitted or verified.',
  })
  submitForVerification(@CurrentUser('id') userId: string): Promise<VendorProfileResponse> {
    return this.vendorService.submitForVerification(userId);
  }

  @Get('me/agreement')
  @Roles('VENDOR')
  @ApiEndpoint({
    summary: 'Read the Eskista vendor agreement',
    does: 'Retrieves the frozen onboarding agreement text and SHA-256 content hash for offline signing.',
    behind: [
      'Read only: reads the vendor Agreement record. Agreement text is frozen to guarantee audit integrity.',
    ],
    rules: ['404 if agreement has not been issued yet (submit profile first).'],
  })
  @ApiOkResponse({ type: AgreementBodyResponse })
  @ApiStandardErrors({ notFound: 'Agreement not yet issued. Submit profile first.' })
  getAgreement(@CurrentUser('id') userId: string): Promise<AgreementBodyResponse> {
    return this.vendorService.getOnboardingAgreement(userId);
  }

  @Post('me/agreement/signed-copy')
  @Roles('VENDOR')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Upload the signed Eskista vendor agreement',
    does: 'Uploads the hand-signed agreement scan (PDF or image) after printing and signing.',
    behind: [
      'Stores signed copy file in private storage.',
      'Updates Agreement record status to UNDER_REVIEW, stores signerName and signerPhone.',
      'Notifies Eskista admin review team.',
    ],
    seenBy: ['Vendor app: agreement card shows "Under Review".', 'Admin dashboard: appears under Agreements review.'],
    rules: [
      '400 if signerName is missing or file is not PDF/image.',
      '409 if agreement is already APPROVED.',
    ],
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
  @ApiStandardErrors({
    badRequest: 'Invalid signer details or file type.',
    conflict: 'Agreement has already been approved.',
  })
  uploadSignedAgreement(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadSignedAgreementDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<AgreementResponse> {
    return this.vendorService.uploadSignedOnboardingAgreement(userId, dto, file);
  }

  @Get('me/dashboard')
  @Roles('VENDOR')
  @ApiEndpoint({
    summary: 'Vendor home screen dashboard',
    does: 'Home screen KPIs: Addis Ababa greeting, business verification status, 4 summary tiles, Needs Attention feed, and upcoming rentals.',
    behind: [
      'Read only: computes greeting based on East Africa Time (UTC+3).',
      'Aggregates active rentals, available equipment, pending requests, and current calendar month earnings.',
      'Gathers urgent action items: new requests awaiting acceptance, bookings needing preparation, return handovers to confirm, and draft equipment listings.',
      'Lists upcoming rentals with customer organization name and status chips.',
    ],
    rules: ['401 if unauthenticated.', '404 if vendor profile not found.'],
  })
  @ApiOkResponse({ type: VendorDashboardResponse })
  @ApiStandardErrors({ notFound: 'Vendor profile not found.' })
  getDashboard(@CurrentUser('id') userId: string): Promise<VendorDashboardResponse> {
    return this.vendorService.getDashboard(userId);
  }
}
