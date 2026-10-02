import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { UploadedFile } from '../../../common/upload';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { CSV_CONTENT, sendCsv } from '../core/admin-http';
import { AdminPaymentsService } from './admin-payments.service';
import {
  AdminPaymentsQuery,
  ConfirmPaymentDto,
  PaymentDecisionDto,
  PaymentDetailResponse,
  PaymentRowResponse,
  PaymentsSummaryResponse,
  RecordPaymentDto,
} from './dto/admin-payments.dto';

const PAY_REF = {
  name: 'reference',
  example: 'PAY-0042',
  description: 'The payment reference. One transfer paying a combined invoice has one reference.',
};

@ApiTags('admin · payments')
@AdminAccess()
@Controller({ path: 'admin', version: '1' })
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  @Get('payments')
  @ApiEndpoint({
    summary: 'Payments Verification — the table',
    does: 'Every payment slip customers uploaded, one row per transfer, newest first.',
    behind: [
      'Read only. A transfer paying a combined invoice is stored as one row per booking sharing one `PAY-NNNN` reference; it is grouped back into one row here.',
    ],
  })
  @ApiPaginatedResponse(PaymentRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminPaymentsQuery): Promise<Paginated<PaymentRowResponse>> {
    return this.payments.list(query);
  }

  @Get('payments/summary')
  @ApiEndpoint({
    summary: 'The tiles above the table',
    does: 'Pending, requested-receipt and confirmed counts and amounts.',
    behind: ['Read only.'],
  })
  @ApiOkResponse({ type: PaymentsSummaryResponse })
  @ApiStandardErrors()
  summary(): Promise<PaymentsSummaryResponse> {
    return this.payments.summary();
  }

  @Get('payments/export')
  @ApiEndpoint({
    summary: 'Export Summary (CSV)',
    does: 'The table as a CSV file, with the same filters.',
    behind: [
      'Read only. Up to 10,000 transfers; amounts in ETB with two decimals; cells starting with = + - @ are escaped so spreadsheets do not run them.',
    ],
    rules: ['Finance and Super Admins.'],
  })
  @AdminAccess(AdminTier.FINANCE)
  @ApiOkResponse({ description: 'A CSV file, one row per transfer.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminPaymentsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.payments.exportCsv(query), 'eskista-payments');
  }

  @Get('payments/:reference')
  @ApiEndpoint({
    summary: 'Payment Metadata / Payment Verification modal',
    does: 'One transfer: expected vs received, method, transaction ID, payer, which Eskista account, the slip, and each booking it pays.',
    behind: [
      'Read only. `expectedAmountMinor` is what the bookings still owed before this transfer; each booking lists what would still block its confirmation.',
    ],
    rules: ['404 when not found.'],
  })
  @ApiParam(PAY_REF)
  @ApiOkResponse({ type: PaymentDetailResponse })
  @ApiStandardErrors({ notFound: 'Payment not found' })
  detail(@Param('reference') reference: string): Promise<PaymentDetailResponse> {
    return this.payments.detail(reference);
  }

  @Post('payments/:reference/confirm')
  @ApiEndpoint({
    summary: 'Confirm Payment',
    does: 'Verifies a transfer against the bank or Telebirr statement.',
    behind: [
      'Every row of the transfer → `VERIFIED`. What arrived (`receivedAmountMinor`, defaulting to what was declared) is split across its bookings by what each owes; the declared figure is kept beside it.',
      'Payer name and account recorded; each booking’s history noted.',
      'Invoice paid amount recomputed: `PARTIALLY_PAID` or `PAID`.',
      'Each booking now paid in full **and** with its signed agreement approved moves to `BOOKING_CONFIRMED`, and its vendor or talent is told.',
      'Notification: customer — Payment Verified. Admin audit log written.',
    ],
    seenBy: [
      'Customer: the payment shows as verified; the booking may confirm.',
      'Vendor: Prepare Equipment / handover once confirmed.',
    ],
    rules: [
      'Finance and Super Admins.',
      '409 when already decided, or a booking on it is no longer awaiting payment.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(PAY_REF)
  @ApiBody({
    type: ConfirmPaymentDto,
    examples: {
      asDeclared: {
        summary: 'Everything arrived',
        value: { payerName: 'Habesha Films PLC', payerAccount: '1000123456789' },
      },
      shortfall: {
        summary: 'Less arrived than declared',
        value: {
          receivedAmountMinor: 1_000_000,
          payerName: 'Habesha Films PLC',
          note: 'Balance to follow',
        },
      },
    },
  })
  @ApiOkResponse({ type: PaymentDetailResponse })
  @ApiStandardErrors({
    notFound: 'Payment not found',
    conflict: 'This payment is already confirmed',
  })
  confirm(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: ConfirmPaymentDto,
  ): Promise<PaymentDetailResponse> {
    return this.payments.confirm(adminId, reference, dto);
  }

  @Post('payments/:reference/request-new-slip')
  @ApiEndpoint({
    summary: 'Request New Slip',
    does: 'Asks for a clearer slip; nothing is wrong with the money.',
    behind: [
      'Rows → `RESUBMISSION_REQUESTED` ("Requested Receipt") with the reason; history noted.',
      'Invoice paid amount recomputed. Notification: customer — New Payment Slip Needed.',
      'Admin audit log written.',
    ],
    seenBy: ['Customer: Complete Payment is available again.'],
    rules: ['Finance and Super Admins.', '409 when already decided.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(PAY_REF)
  @ApiOkResponse({ type: PaymentDetailResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Payment not found',
    conflict: 'This payment is already confirmed',
  })
  requestNewSlip(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: PaymentDecisionDto,
  ): Promise<PaymentDetailResponse> {
    return this.payments.requestNewSlip(adminId, reference, dto.reason);
  }

  @Post('payments/:reference/reject')
  @ApiEndpoint({
    summary: 'Reject Slip',
    does: 'Refuses the payment; the customer pays again.',
    behind: [
      'Rows → `REJECTED` with the reason; history noted; invoice paid amount recomputed.',
      'Notification: customer — Payment Needs Attention, with the reason. Admin audit log written.',
    ],
    rules: ['Finance and Super Admins.', '409 when already decided.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(PAY_REF)
  @ApiOkResponse({ type: PaymentDetailResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Payment not found',
    conflict: 'This payment is already confirmed',
  })
  reject(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: PaymentDecisionDto,
  ): Promise<PaymentDetailResponse> {
    return this.payments.reject(adminId, reference, dto.reason);
  }

  @Post('bookings/:reference/payments')
  @ApiEndpoint({
    summary: 'Record a payment Eskista received directly',
    does: 'Cash at the office, or a transfer the customer never uploaded — recorded as already verified.',
    behind: [
      'Eskista’s receipt (multipart `receipt`) stored privately under the customer.',
      'Payment created `VERIFIED` with a new `PAY-NNNN` reference; invoice issued if needed and its paid amount recomputed.',
      'The booking confirms if now paid in full with its agreement approved.',
      'Notification: customer — Payment Verified. Admin audit log written.',
    ],
    rules: [
      'Finance and Super Admins.',
      '409 unless the booking is awaiting payment.',
      '400 when the receipt is missing or not an image or PDF.',
    ],
  })
  @AdminAccess(AdminTier.FINANCE)
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['receipt', 'method', 'transactionReference', 'amountMinor'],
      properties: {
        receipt: { type: 'string', format: 'binary', description: "Eskista's receipt." },
        method: { type: 'string', enum: ['TELEBIRR', 'BANK_TRANSFER', 'CASH'] },
        transactionReference: { type: 'string' },
        amountMinor: { type: 'integer' },
        payerName: { type: 'string' },
        note: { type: 'string' },
      },
    },
  })
  @ApiParam({ name: 'reference', example: 'ESK-10484', description: 'The booking reference.' })
  @ApiOkResponse({ type: PaymentDetailResponse })
  @ApiStandardErrors({
    badRequest: 'The receipt is missing or not an image/PDF.',
    notFound: 'Booking not found',
    conflict: 'Only a booking awaiting payment can take a payment',
  })
  record(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: RecordPaymentDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<PaymentDetailResponse> {
    return this.payments.recordManual(adminId, reference, dto, file);
  }
}
