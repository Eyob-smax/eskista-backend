import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import type { Paginated } from '../../../common/dto/pagination.dto';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { CSV_CONTENT, PDF_CONTENT, sendCsv, sendPdf } from '../core/admin-http';
import {
  AdjustmentDto,
  AdminSettlementsQuery,
  HoldDto,
  MarkPaidDto,
  SettlementDetailResponse,
  SettlementRowResponse,
  SettlementsSummaryResponse,
} from './admin-settlements.dto';
import { AdminSettlementsService } from './admin-settlements.service';

const REF = {
  name: 'reference',
  example: 'STL-0842',
  description: 'The settlement reference, or the booking reference it pays for.',
};

@ApiTags('admin · settlements')
@AdminAccess()
@Controller({ path: 'admin/settlements', version: '1' })
export class AdminSettlementsController {
  constructor(private readonly settlements: AdminSettlementsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Vendor Payouts & Settlements — the table',
    does: 'What Eskista owes each vendor and talent, per booking: "Rental Revenue − Commission ± Adjustments = Settlement".',
    behind: ['Read only. Overdue is derived: not paid and past its due date.'],
  })
  @ApiPaginatedResponse(SettlementRowResponse, 'One page, earliest due first.')
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminSettlementsQuery): Promise<Paginated<SettlementRowResponse>> {
    return this.settlements.list(query);
  }

  @Get('summary')
  @ApiEndpoint({
    summary: 'The tiles above the table',
    does: 'Pending and overdue totals, and what was paid and earned in commission this month.',
    behind: ['Read only.'],
  })
  @ApiOkResponse({ type: SettlementsSummaryResponse })
  @ApiStandardErrors()
  summary(): Promise<SettlementsSummaryResponse> {
    return this.settlements.summary();
  }

  @Get('export')
  @ApiEndpoint({
    summary: 'Export (CSV)',
    does: 'The table as a CSV file, with the same filters.',
    behind: ['Read only. Up to 10,000 settlements, with the payout reference and account used.'],
    rules: ['Finance and Super Admins.'],
  })
  @AdminAccess(AdminTier.FINANCE)
  @ApiOkResponse({ description: 'A CSV file, one row per settlement.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminSettlementsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.settlements.exportCsv(query), 'eskista-settlements');
  }

  @Get(':reference')
  @ApiEndpoint({
    summary: 'Settlement Breakdown',
    does: 'One settlement: the breakdown, adjustments, due and paid dates, destination, and the payee’s accounts to choose from.',
    behind: ['Read only.'],
    rules: ['404 when not found — the `STL-` reference or the booking reference both work.'],
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: SettlementDetailResponse })
  @ApiStandardErrors({ notFound: 'Settlement not found' })
  detail(@Param('reference') reference: string): Promise<SettlementDetailResponse> {
    return this.settlements.detail(reference);
  }

  @Get(':reference/pdf')
  @ApiEndpoint({
    summary: 'Settlement record PDF',
    does: 'The settlement record the payee also sees, as a PDF.',
    behind: ['Rendered on demand from the settlement. Nothing is stored.'],
  })
  @ApiParam(REF)
  @ApiOkResponse({ description: 'The PDF.', content: PDF_CONTENT })
  @ApiStandardErrors({ notFound: 'Settlement not found' })
  async pdf(
    @Param('reference') reference: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.settlements.pdf(reference);
    return sendPdf(res, buffer, filename);
  }

  @Post(':reference/pay')
  @ApiEndpoint({
    summary: 'Mark as Paid',
    does: 'Records that Eskista sent the payout.',
    behind: [
      'Settlement → `PAID` with the transfer reference and who paid it.',
      'Destination copied from the payee’s primary payout account (or `payoutAccountId`), so the record keeps showing where the money went after they change their details.',
      'A payout the payee reported missing can be paid again; this clears the dispute.',
      'Booking history noted. Notification: vendor or talent — Payout Sent. Admin audit log written.',
    ],
    seenBy: ['Vendor and talent: Confirm Payment, which closes the booking now or after 24 hours.'],
    rules: [
      'Finance and Super Admins.',
      '409 when already paid and not disputed.',
      '404 for a payout account that is not the payee’s.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(REF)
  @ApiOkResponse({ type: SettlementDetailResponse })
  @ApiStandardErrors({
    badRequest: '`payoutReference` missing.',
    notFound: 'That payout account does not belong to this payee',
    conflict: 'This settlement is already paid',
  })
  pay(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: MarkPaidDto,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.markPaid(adminId, reference, dto);
  }

  @Post(':reference/adjustments')
  @ApiEndpoint({
    summary: 'Add an adjustment',
    does: 'Adds a signed line to the payout — a penalty (negative) or a correction or bonus (positive).',
    behind: [
      'Adjustment stored with its reason and author; adjustment total, deductions and net recomputed (net never below zero). Admin audit log written.',
    ],
    rules: ['Finance and Super Admins.', '409 once paid.', '400 for a zero amount.'],
  })
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(REF)
  @ApiOkResponse({ type: SettlementDetailResponse })
  @ApiStandardErrors({
    badRequest: 'An adjustment cannot be zero.',
    notFound: 'Settlement not found',
    conflict: 'A paid settlement cannot be adjusted',
  })
  adjust(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: AdjustmentDto,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.adjust(adminId, reference, dto);
  }

  @Delete(':reference/adjustments/:adjustmentId')
  @ApiEndpoint({
    summary: 'Remove an adjustment added by mistake',
    does: 'Deletes one adjustment line before payment.',
    behind: ['Line deleted; totals recomputed; admin audit log written.'],
    rules: [
      'Finance and Super Admins.',
      '409 once paid.',
      '404 when the line is not on this settlement.',
    ],
  })
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(REF)
  @ApiParam({ name: 'adjustmentId', format: 'uuid' })
  @ApiOkResponse({ type: SettlementDetailResponse })
  @ApiStandardErrors({
    notFound: 'Adjustment not found',
    conflict: 'A paid settlement cannot be adjusted',
  })
  removeAdjustment(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.removeAdjustment(adminId, reference, adjustmentId);
  }

  @Post(':reference/hold')
  @ApiEndpoint({
    summary: 'Hold or release a payout',
    does: 'Pauses a payout — while a dispute is open, say — or releases it.',
    behind: [
      'Status `ON_HOLD` or back to `PENDING`, with an optional note; admin audit log written.',
    ],
    rules: ['Finance and Super Admins.', '409 once paid.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(REF)
  @ApiOkResponse({ type: SettlementDetailResponse })
  @ApiStandardErrors({
    notFound: 'Settlement not found',
    conflict: 'This settlement is already paid',
  })
  hold(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: HoldDto,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.hold(adminId, reference, dto);
  }
}
