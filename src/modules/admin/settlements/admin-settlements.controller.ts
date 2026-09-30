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
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
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

const FLOW = `
A settlement is created when a booking reaches Settlement: an equipment rental after its
return inspection, a talent engagement once the service is complete. It pays the
supplier's own price in full — commission and VAT were on the customer's side — plus any
adjustments, such as damage compensation withheld from the customer's deposit.

**Mark as Paid** records the transfer and where it went. The vendor or talent then
confirms it arrived in their app, and the booking closes (or an admin closes it).
`.trim();

@ApiTags('admin · settlements')
@AdminAccess()
@Controller({ path: 'admin/settlements', version: '1' })
export class AdminSettlementsController {
  constructor(private readonly settlements: AdminSettlementsService) {}

  @Get()
  @ApiOperation({ summary: 'Vendor Payouts & Settlements — the table', description: FLOW })
  @ApiPaginatedResponse(SettlementRowResponse, 'One page, earliest due first.')
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminSettlementsQuery): Promise<Paginated<SettlementRowResponse>> {
    return this.settlements.list(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'The tiles above the table' })
  @ApiOkResponse({ type: SettlementsSummaryResponse })
  @ApiStandardErrors()
  summary(): Promise<SettlementsSummaryResponse> {
    return this.settlements.summary();
  }

  @Get('export')
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({ summary: 'Export (CSV)', description: 'Same filters as the table.' })
  @ApiOkResponse({ description: 'A CSV file, one row per settlement.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminSettlementsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.settlements.exportCsv(query), 'eskista-settlements');
  }

  @Get(':reference')
  @ApiOperation({ summary: 'Settlement Breakdown' })
  @ApiParam(REF)
  @ApiOkResponse({ type: SettlementDetailResponse })
  @ApiStandardErrors({ notFound: 'Settlement not found' })
  detail(@Param('reference') reference: string): Promise<SettlementDetailResponse> {
    return this.settlements.detail(reference);
  }

  @Get(':reference/pdf')
  @ApiOperation({ summary: 'Settlement record PDF' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({ summary: 'Mark as Paid', description: FLOW })
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
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({ summary: 'Add an adjustment (± minor units, with a reason)' })
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
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({ summary: 'Remove an adjustment added by mistake' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({ summary: 'Hold or release a payout — e.g. while a dispute is open' })
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
