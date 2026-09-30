import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminTier, Role } from '@prisma/client';
import type { Response } from 'express';
import type { UploadedFile } from '../../common/upload';
import { CurrentUser } from '../auth/auth.decorators';
import { AdminAccess } from '../admin/core/admin-access';
import {
  AdminInvoiceQuery,
  CombineInvoiceDto,
  InvoiceDetailResponse,
  InvoicePaymentInstructionsResponse,
  InvoiceSummaryResponse,
  PayInvoiceDto,
  PayableBookingResponse,
  SetVatDto,
  VoidInvoiceDto,
} from './dto/invoice.dto';
import { InvoicesService } from './invoices.service';

const NUMBER = { name: 'number', example: 'ESK-INV-2026-000201' };
const PDF_CONTENT = { 'application/pdf': { schema: { type: 'string', format: 'binary' } } };

function sendPdf(res: Response, buffer: Buffer, filename: string): StreamableFile {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(buffer);
}

@ApiTags('customer · invoices')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@Controller({ path: 'customer/invoices', version: '1' })
export class CustomerInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({
    summary: 'My invoices',
    description:
      'Every invoice issued to the customer, newest first — single and combined. Voided ' +
      'invoices (replaced by a combined one, or split) are left out.',
  })
  @ApiOkResponse({ type: [InvoiceSummaryResponse] })
  list(@CurrentUser('id') userId: string): Promise<InvoiceSummaryResponse[]> {
    return this.invoices.listForCustomer(userId);
  }

  @Get('payable')
  @ApiOperation({
    summary: 'Bookings I can pay together',
    description:
      'For the **Pay together** picker: the customer’s bookings awaiting payment that have ' +
      'no payment yet and are not already on a combined invoice — across any vendors and ' +
      'talents.',
  })
  @ApiOkResponse({ type: [PayableBookingResponse] })
  payable(@CurrentUser('id') userId: string): Promise<PayableBookingResponse[]> {
    return this.invoices.payableBookings(userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Pay together — combine bookings into one invoice',
    description: `
Creates one invoice for two or more bookings awaiting payment, from any mix of vendors and
talents. Their single invoices are voided and replaced. One transfer then pays everything.

Each supplier is still paid for their own booking only and never sees the others.

**409** when a booking is not awaiting payment, already has a payment, or is on another
combined invoice (split that one first).
`.trim(),
  })
  @ApiCreatedResponse({ type: InvoiceDetailResponse })
  @ApiBadRequestResponse({ description: 'Fewer than two bookings, or mixed currencies.' })
  @ApiConflictResponse({ description: 'A booking cannot be combined — see `problems`.' })
  combine(
    @CurrentUser('id') userId: string,
    @Body() dto: CombineInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.combine(
      dto.bookingReferences,
      { id: userId, role: Role.CUSTOMER },
      userId,
    );
  }

  @Get(':number')
  @ApiOperation({
    summary: 'One invoice',
    description: `
Lines (one per booking, with its own \`paymentBlocker\`), totals with VAT shown as included
(or exempt), the refundable deposits, payments, \`balanceMinor\`, and whether it can be paid
(\`canPay\` / \`blockers\`) or split (\`canUngroup\`).
`.trim(),
  })
  @ApiParam(NUMBER)
  @ApiOkResponse({ type: InvoiceDetailResponse })
  @ApiNotFoundResponse({ description: 'Not one of your invoices.' })
  get(
    @CurrentUser('id') userId: string,
    @Param('number') number: string,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.getForCustomer(userId, number);
  }

  @Get(':number/payment-instructions')
  @ApiOperation({
    summary: 'How to pay an invoice',
    description:
      'Eskista’s Telebirr and bank details, the amount due (total plus deposits) and the ' +
      'reference to use — the invoice number.',
  })
  @ApiParam(NUMBER)
  @ApiOkResponse({ type: InvoicePaymentInstructionsResponse })
  instructions(
    @CurrentUser('id') userId: string,
    @Param('number') number: string,
  ): Promise<InvoicePaymentInstructionsResponse> {
    return this.invoices.paymentInstructions(userId, number);
  }

  @Post(':number/payments')
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Submit payment for an invoice',
    description: `
One transfer, one receipt, for every booking on the invoice. Recorded as one payment per
booking, split by what each owes, so each booking shows its payment as being verified.

Every booking must be payable — agreement uploaded, nothing already being verified —
or **409** lists which are not. Eskista then verifies the payment; nothing is confirmed here.
`.trim(),
  })
  @ApiParam(NUMBER)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['receipt', 'method', 'transactionReference', 'amountMinor'],
      properties: {
        receipt: {
          type: 'string',
          format: 'binary',
          description: 'PNG, JPEG, WebP or PDF, 10 MB.',
        },
        method: { type: 'string', enum: ['TELEBIRR', 'BANK_TRANSFER', 'CASH'] },
        transactionReference: { type: 'string', example: 'FT26270XYZ12' },
        amountMinor: { type: 'integer', example: 2144500 },
      },
    },
  })
  @ApiCreatedResponse({ type: InvoiceDetailResponse })
  @ApiConflictResponse({ description: 'Not payable yet — see `blockers`.' })
  pay(
    @CurrentUser('id') userId: string,
    @Param('number') number: string,
    @Body() dto: PayInvoiceDto,
    @UploadedFileParam() file: UploadedFile,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.pay(userId, number, dto, file);
  }

  @Get(':number/pdf')
  @ApiOperation({ summary: 'Download the invoice as a PDF' })
  @ApiParam(NUMBER)
  @ApiOkResponse({ content: PDF_CONTENT })
  async pdf(
    @CurrentUser('id') userId: string,
    @Param('number') number: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoices.pdf(number, userId);
    return sendPdf(res, buffer, filename);
  }

  @Delete(':number')
  @ApiOperation({
    summary: 'Split a combined invoice',
    description:
      'Undoes Pay together. Each booking gets its own invoice again when it is next paid. ' +
      'Only before any payment has been sent against it.',
  })
  @ApiParam(NUMBER)
  @ApiOkResponse({ schema: { example: { bookingReferences: ['ESK-10484', 'ESK-TLT-1005'] } } })
  @ApiConflictResponse({ description: 'A payment has been sent against it.' })
  ungroup(
    @CurrentUser('id') userId: string,
    @Param('number') number: string,
  ): Promise<{ bookingReferences: string[] }> {
    return this.invoices.ungroup(userId, number);
  }
}

@ApiTags('admin · invoices')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Admins only.' })
@AdminAccess()
@Controller({ path: 'admin/invoices', version: '1' })
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'All invoices', description: 'Filter by `status` or `customerId`.' })
  @ApiOkResponse({ type: [InvoiceSummaryResponse] })
  list(@Query() query: AdminInvoiceQuery): Promise<InvoiceSummaryResponse[]> {
    return this.invoices.adminList(query);
  }

  @Post()
  @AdminAccess(AdminTier.FINANCE)
  @ApiOperation({
    summary: 'Combine a customer’s bookings into one invoice',
    description:
      'The same as the customer’s Pay together, done on their behalf. The bookings must all ' +
      'belong to one customer.',
  })
  @ApiCreatedResponse({ type: InvoiceDetailResponse })
  combine(
    @CurrentUser('id') adminId: string,
    @Body() dto: CombineInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.combine(dto.bookingReferences, { id: adminId, role: Role.ADMIN });
  }

  @Get(':number')
  @ApiParam(NUMBER)
  @ApiOperation({ summary: 'One invoice, including voided ones' })
  @ApiOkResponse({ type: InvoiceDetailResponse })
  get(@Param('number') number: string): Promise<InvoiceDetailResponse> {
    return this.invoices.adminGet(number);
  }

  @Patch(':number/vat')
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(NUMBER)
  @ApiOperation({
    summary: 'Charge or waive VAT on this invoice',
    description:
      'The client’s per-invoice exemption. Takes the VAT out of every line (or puts it back). ' +
      'Only before a payment has been sent against it. Audited.',
  })
  @ApiOkResponse({ type: InvoiceDetailResponse })
  setVat(
    @CurrentUser('id') adminId: string,
    @Param('number') number: string,
    @Body() dto: SetVatDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.setVat(adminId, number, dto.vatExempt, dto.reason);
  }

  @Post(':number/void')
  @AdminAccess(AdminTier.FINANCE)
  @HttpCode(HttpStatus.OK)
  @ApiParam(NUMBER)
  @ApiOperation({
    summary: 'Void an invoice',
    description:
      'Its bookings get new invoices when next paid. Refused once a payment is verified.',
  })
  @ApiOkResponse({ type: InvoiceDetailResponse })
  void(
    @CurrentUser('id') adminId: string,
    @Param('number') number: string,
    @Body() dto: VoidInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.void(adminId, number, dto.reason);
  }

  @Get(':number/pdf')
  @ApiParam(NUMBER)
  @ApiOperation({ summary: 'Download any invoice as a PDF' })
  @ApiOkResponse({ content: PDF_CONTENT })
  async pdf(
    @Param('number') number: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoices.pdf(number);
    return sendPdf(res, buffer, filename);
  }
}
