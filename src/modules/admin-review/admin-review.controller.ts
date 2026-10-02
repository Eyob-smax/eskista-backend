import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import { AdminTier } from '@prisma/client';
import { AdminAccess } from '../admin/core/admin-access';
import { AdminReviewService } from './admin-review.service';
import { ApproveDto, PreviewQuery, RejectDto, ReviewItemResponse } from './dto/admin-review.dto';

@ApiTags('admin · review')
@AdminAccess()
@Controller({ path: 'admin/review', version: '1' })
export class AdminReviewController {
  constructor(private readonly review: AdminReviewService) {}

  // ── Listings ───────────────────────────────────────────────────────────────

  @Get('listings')
  @ApiEndpoint({
    summary: 'Equipment waiting for review',
    does: 'Every listing submitted by vendors that Eskista has not yet approved or rejected, oldest first.',
    behind: [
      "Read only. Each row previews the supplier's proposed price with Eskista's default commission already applied, plus VAT → the customer price the admin is about to fix.",
      'Pass `?commissionBps=` to the detail endpoint to preview a different rate before approving.',
    ],
  })
  @ApiOkResponse({ type: [ReviewItemResponse] })
  listListings(): Promise<ReviewItemResponse[]> {
    return this.review.listListings();
  }

  @Get('listings/:id')
  @ApiEndpoint({
    summary: 'One listing, with the pricing preview',
    does: 'The listing details and a live pricing preview: supplier price → commission → VAT → customer price. Pass `?commissionBps=` to preview a different rate.',
    behind: ['Read only. Nothing is saved until Approve.'],
    rules: ['404 when not found.'],
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiStandardErrors({ badRequest: '`commissionBps` out of range.', notFound: 'Listing not found' })
  getListing(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PreviewQuery,
  ): Promise<ReviewItemResponse> {
    return this.review.getListing(id, query.commissionBps);
  }

  @Post('listings/:id/approve')
  @ApiEndpoint({
    summary: 'Approve a listing and fix its commission',
    does: 'Publishes the listing to the catalogue at the agreed commission rate.',
    behind: [
      'Listing status → PUBLISHED; commission rate stored on the listing.',
      'Customer price is computed from supplier price + commission + VAT and stored.',
      'Notification: vendor — Listing Approved.',
      'Admin audit log written.',
    ],
    seenBy: [
      'Vendor: "Your listing is now live on the marketplace".',
      'Customers: the listing appears in search.',
    ],
    rules: [
      '409 when not awaiting review, the vendor is not verified, or no price is proposed (`blockers` explains).',
    ],
  })
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiStandardErrors({
    badRequest: '`commissionBps` out of range.',
    notFound: 'Not found',
    conflict: 'Cannot be approved — see `blockers`',
  })
  approveListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
  ): Promise<ReviewItemResponse> {
    return this.review.approveListing(adminId, id, dto);
  }

  @Post('listings/:id/reject')
  @ApiEndpoint({
    summary: 'Send a listing back to the vendor',
    does: 'Rejects with a reason. The vendor can fix it and resubmit.',
    behind: [
      'Listing status → DRAFT; notification sent with the reason.',
      'Admin audit log written.',
    ],
    seenBy: ['Vendor: "Your listing needs changes" with the reason.'],
    rules: ['409 when not awaiting review.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Not found',
    conflict: 'Not awaiting review',
  })
  rejectListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ): Promise<ReviewItemResponse> {
    return this.review.rejectListing(adminId, id, dto);
  }

  // ── Talent ─────────────────────────────────────────────────────────────────

  @Get('talent')
  @ApiEndpoint({
    summary: 'Talent registrations waiting for review',
    does: 'Every talent who applied and has not yet been verified or rejected, oldest first.',
    behind: [
      'Read only. Each row previews the base rate and every service at the same commission.',
      'Pass `?commissionBps=` to the detail endpoint to preview a different rate.',
    ],
  })
  @ApiOkResponse({ type: [ReviewItemResponse] })
  listTalent(): Promise<ReviewItemResponse[]> {
    return this.review.listTalent();
  }

  @Get('talent/:id')
  @ApiEndpoint({
    summary: 'One talent, with the pricing preview',
    does: 'The talent profile and a live pricing preview for their base rate and services.',
    behind: ['Read only. Nothing is saved until Approve.'],
    rules: ['404 when not found.'],
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiStandardErrors({ badRequest: '`commissionBps` out of range.', notFound: 'Talent not found' })
  getTalent(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PreviewQuery,
  ): Promise<ReviewItemResponse> {
    return this.review.getTalent(id, query.commissionBps);
  }

  @Post('talent/:id/approve')
  @ApiEndpoint({
    summary: 'Verify a talent and fix their commission',
    does: 'Makes the talent bookable at the agreed commission. One rate covers the base rate and all their services.',
    behind: [
      'Talent status → VERIFIED; commission rate stored on the profile.',
      'Customer prices recomputed for every service.',
      'Notification: talent — Your Profile Is Verified.',
      'Admin audit log written.',
    ],
    seenBy: [
      'Talent: they can now receive invitations and be hired.',
      'Clients: the talent appears in search.',
    ],
    rules: ['409 when the talent cannot be approved yet (`blockers` explains).'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiStandardErrors({
    badRequest: '`commissionBps` out of range.',
    notFound: 'Not found',
    conflict: 'Cannot be approved — see `blockers`',
  })
  approveTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
  ): Promise<ReviewItemResponse> {
    return this.review.approveTalent(adminId, id, dto);
  }

  @Post('talent/:id/reject')
  @ApiEndpoint({
    summary: 'Send a talent registration back',
    does: 'Rejects with a reason. The talent can fix and resubmit.',
    behind: [
      'Talent status → back to previous; notification sent with the reason.',
      'Admin audit log written.',
    ],
    seenBy: ['Talent: "Your application needs changes" with the reason.'],
    rules: ['409 when not awaiting review.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Not found',
    conflict: 'Not awaiting review',
  })
  rejectTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ): Promise<ReviewItemResponse> {
    return this.review.rejectTalent(adminId, id, dto);
  }
}
