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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CustomerDocumentType } from '@prisma/client';
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
@ApiUnauthorizedResponse({
  description: 'No valid session. Sign in through the Telegram Mini App.',
})
@Controller({ path: 'customer', version: '1' })
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get my customer profile',
    description: `
Returns the commercial identity behind this customer's bookings — the details that appear
on the **Customer & Contact** step of both request wizards, and on the **Profile** tab.

The profile is created on first access, so this never 404s for a signed-in user. On a brand
new account it comes back pre-filled from the Telegram sign-in (name, email, phone) with
\`isBookingReady: false\`.

**Use \`outstandingRequirements\` to drive the wizard.** It lists exactly what is still
missing before a booking can be submitted, so the client does not have to re-implement the
rule. When it is empty, the Customer & Contact step can be pre-filled and collapsed.

\`verificationStatus\` is admin-controlled — a customer may upload an ID but can never
verify themselves. Render the "Verified customer" badge only when it is \`VERIFIED\`.
`.trim(),
  })
  @ApiOkResponse({
    type: CustomerProfileResponse,
    description: 'The profile, with the outstanding-requirements checklist.',
  })
  getProfile(@CurrentUser('id') userId: string): Promise<CustomerProfileResponse> {
    return this.customerService.getProfile(userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update my contact and billing details',
    description: `
Partial update — send only the fields that changed.

Editing is allowed after verification: the details on file are what an invoice needs to be
current, and re-running the ID check because someone corrected a phone number would achieve
nothing. Replacing the **verification document** does reset it; see
\`POST /customer/me/verification-document\`.

\`verificationStatus\` cannot be set here under any circumstances. It is Eskista's decision.
`.trim(),
  })
  @ApiOkResponse({ type: CustomerProfileResponse })
  @ApiBadRequestResponse({ description: 'A field failed validation — see `message` for which.' })
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
  @ApiOperation({
    summary: 'Upload the document that earns the Verified badge',
    description: `
Accepts a **Business License**, **Commercial Registration** or **TIN certificate** — the
three documents that earn the "Verified customer" badge.

**Entirely optional.** Verification is a badge, never a gate: an unverified individual
places bookings exactly like a verified company. Do not disable anything on the absence of
this document, and do not prompt for it inside the booking wizard.

PNG, JPEG, WebP or PDF, up to **5 MB**.

Uploading **always** moves \`verificationStatus\` to \`PENDING_REVIEW\` and clears any
previous rejection reason, including for an already-verified customer — swapping the
paperwork has to be re-checked or the check means nothing. The superseded file is deleted.

The returned \`document.url\` is **not public**: readable only by this customer and by
Eskista staff. Anyone else gets a 404.
`.trim(),
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
  @ApiBadRequestResponse({
    description:
      'Missing or unknown `documentType`, missing file, unsupported type, empty file, ' +
      'or larger than 5 MB.',
  })
  uploadVerificationDocument(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadVerificationDocumentDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<CustomerProfileResponse> {
    return this.customerService.uploadVerificationDocument(userId, dto.documentType, file);
  }

  @Get('me/stats')
  @ApiOperation({
    summary: 'Get my Profile-tab counters',
    description: `
The three numbers across the top of the **Profile** screen.

- **bookings** — bookings that reached \`CLOSED\`. Drafts, cancellations and in-flight
  bookings are excluded, so the number only ever goes up.
- **rating** — the average a customer has *received* from vendors, to one decimal place.
  \`null\` when nobody has rated them yet; render a dash rather than \`0.0\`, which reads
  as a bad score rather than no score.
- **vendors** — *distinct* vendors with at least one closed booking. Two rentals from the
  same vendor count once, because the design labels this as a relationship count.
`.trim(),
  })
  @ApiOkResponse({ type: CustomerStatsResponse })
  getStats(@CurrentUser('id') userId: string): Promise<CustomerStatsResponse> {
    return this.customerService.getStats(userId);
  }
}
