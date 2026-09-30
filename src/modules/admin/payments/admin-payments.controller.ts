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
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
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

const FLOW = `
**The flow.** The customer transfers to one of Eskista's operating accounts and uploads the
slip (\`Pending\`). Finance checks it against the statement, then:

- **Confirm Payment** — records what arrived and from whom. Each booking that is now paid
  in full *and* whose signed agreement is approved moves to **Booking Confirmed**; one still
  waiting on its agreement confirms the moment the agreement is approved.
- **Request New Slip** — the slip is unreadable; the customer uploads again (\`Requested Receipt\`).
- **Reject Slip** — the payment is not accepted.

A combined-invoice transfer is one payment here, decided as a whole.
`.trim();

@ApiTags('admin · payments')
@AdminAccess()
@Controller({ path: 'admin', version: '1' })
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  @Get('payments')
  @ApiOperation({
    summary: 'Payments Verification — the table',
    description: `${FLOW}\n\nOne row per transfer, newest first.`,
  })
  @ApiPaginatedResponse(PaymentRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminPaymentsQuery): Promise<Paginated<PaymentRowResponse>> {
    return this.payments.list(query);
  }

  @Get('payments/summary')
  @ApiOperation({ summary: 'The tiles above the table' })
  @ApiOkResponse({ type: PaymentsSummaryResponse })
  @ApiStandardErrors()
  summary(): Promise<PaymentsSummaryResponse> {
    return this.payments.summary();
  }

  @Get('payments/export')
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({ summary: 'Export Summary (CSV)', description: 'Same filters as the table.' })
  @ApiOkResponse({ description: 'A CSV file, one row per transfer.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminPaymentsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.payments.exportCsv(query), 'eskista-payments');
  }

  @Get('payments/:reference')
  @ApiOperation({
    summary: 'Payment Metadata / Payment Verification modal',
    description:
      'Expected vs received, method, transaction ID, payer, which Eskista account, the slip, ' +
      'and each booking it pays with what still blocks its confirmation.',
  })
  @ApiParam(PAY_REF)
  @ApiOkResponse({ type: PaymentDetailResponse })
  @ApiStandardErrors({ notFound: 'Payment not found' })
  detail(@Param('reference') reference: string): Promise<PaymentDetailResponse> {
    return this.payments.detail(reference);
  }

  @Post('payments/:reference/confirm')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({ summary: 'Confirm Payment', description: FLOW })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({
    summary: 'Request New Slip',
    description:
      'The slip is unreadable or incomplete; nothing is wrong with the money. The status becomes ' +
      '`RESUBMISSION_REQUESTED` ("Requested Receipt") and the customer is asked to upload again.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({
    summary: 'Reject Slip',
    description:
      'The payment is not accepted. The reason is shown to the customer, who pays again.',
  })
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
  @AdminAccess(AdminTier.FINANCE)
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Record a payment Eskista received directly',
    description:
      'Cash at the office, or a transfer the customer never uploaded. Recorded as verified.',
  })
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
