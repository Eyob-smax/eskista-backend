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
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import { AdminTier } from '@prisma/client';
import { AdminAccess } from '../admin/core/admin-access';
import { AdminReviewService } from './admin-review.service';
import { ApproveDto, PreviewQuery, RejectDto, ReviewItemResponse } from './dto/admin-review.dto';

const FLOW = `
**The review flow.** The supplier proposed a price. The review form shows it with Eskista's
**default commission already filled in** and the customer price that results, VAT added
automatically. The admin may change the commission for this item before approving.

Change the figure and call the preview again (\`?commissionBps=\`) for the live customer
price — nothing is saved until **Approve**.

The rate agreed at approval is stored on the item. A later change to the global default
(\`PATCH /admin/pricing\`) pre-fills future reviews but never moves something already
approved.
`.trim();

@ApiTags('admin · review')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Admins only.' })
@AdminAccess()
@Controller({ path: 'admin/review', version: '1' })
export class AdminReviewController {
  constructor(private readonly review: AdminReviewService) {}

  // ── Listings ───────────────────────────────────────────────────────────────

  @Get('listings')
  @ApiOperation({
    summary: 'Equipment waiting for review',
    description: `Oldest first.\n\n${FLOW}`,
  })
  @ApiOkResponse({ type: [ReviewItemResponse] })
  listListings(): Promise<ReviewItemResponse[]> {
    return this.review.listListings();
  }

  @Get('listings/:id')
  @ApiOperation({
    summary: 'One listing, with the pricing preview',
    description: FLOW,
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiNotFoundResponse({ description: 'No such listing.' })
  getListing(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PreviewQuery,
  ): Promise<ReviewItemResponse> {
    return this.review.getListing(id, query.commissionBps);
  }

  @Post('listings/:id/approve')
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a listing and fix its commission',
    description: `Publishes it to the catalogue at the agreed commission.\n\n${FLOW}\n\nA **409** carries \`blockers\`: not awaiting review, the vendor not verified, or no price proposed.`,
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiConflictResponse({ description: 'Cannot be approved — see `blockers`.' })
  approveListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
  ): Promise<ReviewItemResponse> {
    return this.review.approveListing(adminId, id, dto);
  }

  @Post('listings/:id/reject')
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a listing back to the vendor',
    description: 'The reason is shown to the vendor so they can fix it and resubmit.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiConflictResponse({ description: 'Not awaiting review.' })
  rejectListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ): Promise<ReviewItemResponse> {
    return this.review.rejectListing(adminId, id, dto);
  }

  // ── Talent ─────────────────────────────────────────────────────────────────

  @Get('talent')
  @ApiOperation({
    summary: 'Talent registrations waiting for review',
    description: `Oldest first. Each shows the base rate and every service, all previewed at the same commission.\n\n${FLOW}`,
  })
  @ApiOkResponse({ type: [ReviewItemResponse] })
  listTalent(): Promise<ReviewItemResponse[]> {
    return this.review.listTalent();
  }

  @Get('talent/:id')
  @ApiOperation({ summary: 'One talent, with the pricing preview', description: FLOW })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiNotFoundResponse({ description: 'No such talent.' })
  getTalent(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PreviewQuery,
  ): Promise<ReviewItemResponse> {
    return this.review.getTalent(id, query.commissionBps);
  }

  @Post('talent/:id/approve')
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a talent and fix their commission',
    description: `Makes them bookable at the agreed commission. One rate covers the base rate and all their services.\n\n${FLOW}`,
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiConflictResponse({ description: 'Cannot be approved — see `blockers`.' })
  approveTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
  ): Promise<ReviewItemResponse> {
    return this.review.approveTalent(adminId, id, dto);
  }

  @Post('talent/:id/reject')
  @AdminAccess(AdminTier.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a talent registration back',
    description: 'The reason is shown to the talent so they can fix it and resubmit.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemResponse })
  @ApiConflictResponse({ description: 'Not awaiting review.' })
  rejectTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
  ): Promise<ReviewItemResponse> {
    return this.review.rejectTalent(adminId, id, dto);
  }
}
