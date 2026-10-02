import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerDocumentType } from '@prisma/client';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import { CurrentUser } from '../auth/auth.decorators';
import type { UploadedFile } from '../../common/upload';
import {
  CustomerProfileResponse,
  CustomerStatsResponse,
  UpdateCustomerProfileDto,
  UploadVerificationDocumentDto,
} from './dto/customer.dto';
import { CustomerService } from './customer.service';

@ApiTags('customer · profile')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'customer', version: '1' })
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('me')
  @ApiEndpoint({
    summary: 'Get my customer profile',
    does: 'Returns the customer profile, contact details, verification badge status, and wizard readiness checklist.',
    behind: [
      'Queries the customer profile for the authenticated user ID.',
      'Auto-creates an initial profile populated from Telegram or Better Auth session details if this is the first visit.',
      'Computes isBookingReady and outstandingRequirements (e.g., missing phone or delivery address) without enforcing verification.',
    ],
    seenBy: [
      'Customer sees the Profile tab, the Customer & Contact step in the booking wizards, and the Verified Customer badge if approved.',
    ],
    rules: [
      '401 if not authenticated with an active session token.',
      'Never returns 404 for an authenticated user; profile is lazily provisioned on demand.',
    ],
  })
  @ApiOkResponse({
    type: CustomerProfileResponse,
    description: 'The profile, with the outstanding-requirements checklist.',
  })
  getProfile(@CurrentUser('id') userId: string): Promise<CustomerProfileResponse> {
    return this.customerService.getProfile(userId);
  }

  @Patch('me')
  @ApiEndpoint({
    summary: 'Update my contact and billing details',
    does: 'Updates commercial contact details, organization name, kind, phone numbers, and default delivery address.',
    behind: [
      'Updates the CustomerProfile record for the authenticated user.',
      'Does not reset verification status for basic contact edits (phone, email, organization name).',
      'Recomputes isBookingReady and returns the refreshed profile.',
    ],
    seenBy: [
      'Customer sees updated contact details reflected in the profile screen and pre-filled in future booking drafts.',
      'Eskista operations and invoices reflect updated billing details.',
    ],
    rules: [
      '400 if validation fails on string lengths, email format, or invalid enum values.',
      '401 if not authenticated.',
      'verificationStatus cannot be altered directly via this endpoint.',
    ],
  })
  @ApiOkResponse({ type: CustomerProfileResponse })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileResponse> {
    return this.customerService.updateProfile(userId, dto);
  }

  @Post('me/verification-document')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint({
    summary: 'Upload the document that earns the Verified badge',
    does: 'Uploads a commercial registration, business license, or TIN certificate to earn the Verified Customer badge.',
    behind: [
      'Stores the uploaded file into secure storage and sets verificationStatus to PENDING_REVIEW.',
      'Deletes any previously uploaded customer verification file to prevent orphaned storage.',
      'Creates a notification for Eskista admin reviewers in the verification queue.',
    ],
    seenBy: [
      'Customer sees status change to "Under Review" on the Profile screen.',
      'Eskista compliance officers see the document in the admin review queue.',
    ],
    rules: [
      '400 if missing file, unsupported mime type (only PNG, JPEG, WebP, PDF), or file exceeds 5 MB.',
      '400 if documentType is not one of BUSINESS_LICENSE, COMMERCIAL_REGISTRATION, TIN_CERTIFICATE.',
      '401 if not authenticated.',
      'Optional badge only: failure or absence of verification never blocks booking placement.',
    ],
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'documentType'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PNG, JPEG, WebP or PDF. Max 5 MB.',
        },
        documentType: {
          type: 'string',
          enum: Object.values(CustomerDocumentType),
          description: 'Which of the three accepted documents this is.',
          example: CustomerDocumentType.BUSINESS_LICENSE,
        },
      },
    },
  })
  @ApiOkResponse({
    type: CustomerProfileResponse,
    description: 'The updated profile, now with `document` populated.',
  })
  uploadVerificationDocument(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadVerificationDocumentDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<CustomerProfileResponse> {
    return this.customerService.uploadVerificationDocument(userId, dto.documentType, file);
  }

  @Get('me/stats')
  @ApiEndpoint({
    summary: 'Get my Profile-tab counters',
    does: 'Returns the customer Profile tab summary metrics: closed booking count and distinct suppliers worked with.',
    behind: [
      'Counts all bookings for this customer in CLOSED status.',
      'Calculates the count of distinct vendor suppliers associated with closed bookings.',
    ],
    seenBy: [
      'Customer sees the stats counters at the top of the Profile screen in the Mini App.',
    ],
    rules: [
      '401 if not authenticated.',
      'Excludes drafts, cancelled requests, and in-flight active rentals from the booking counter.',
    ],
  })
  @ApiOkResponse({ type: CustomerStatsResponse })
  getStats(@CurrentUser('id') userId: string): Promise<CustomerStatsResponse> {
    return this.customerService.getStats(userId);
  }
}
