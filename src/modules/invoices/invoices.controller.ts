import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
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
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
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

const NUMBER = {
  name: 'number',
  example: 'ESK-INV-2026-000201',
  description: 'The invoice number, `ESK-INV-YYYY-NNNNNN`.',
};
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
@ApiStandardErrors({ notFound: 'Not one of your invoices.' })
@Controller({ path: 'customer/invoices', version: '1' })
export class CustomerInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiEndpoint({
    summary: 'My invoices',
    does: 'Returns all invoices issued to the customer, both single and combined, newest first.',
    behind: [
      'Queries invoices for the authenticated user ID.',
      'Excludes voided invoices that were replaced by combined invoices.',
    ],
    seenBy: [
      'Customer sees the Invoices list in the billing tab.',
    ],
    rules: [
      '401 if not authenticated.',
    ],
  })
  @ApiOkResponse({ type: [InvoiceSummaryResponse] })
  list(@CurrentUser('id') userId: string): Promise<InvoiceSummaryResponse[]> {
    return this.invoices.listForCustomer(userId);
  }

  @Get('payable')
  @ApiEndpoint({
    summary: 'Bookings I can pay together',
    does: 'Returns bookings currently awaiting payment that can be combined into a consolidated invoice.',
    behind: [
      'Queries bookings in AWAITING_PAYMENT with no verified or submitted payments.',
      'Excludes bookings that are already part of a combined invoice.',
    ],
    seenBy: [
      'Customer sees the selectable bookings list in the "Pay Together" wizard.',
    ],
    rules: [
      '401 if not authenticated.',
    ],
  })
  @ApiOkResponse({ type: [PayableBookingResponse] })
  payable(@CurrentUser('id') userId: string): Promise<PayableBookingResponse[]> {
    return this.invoices.payableBookings(userId);
  }

  @Post()
  @ApiEndpoint({
    summary: 'Pay together — combine bookings into one invoice',
    does: 'Combines two or more bookings awaiting payment into a single consolidated invoice.',
    behind: [
      'Voids individual invoices and creates a single consolidated Invoice with combined line items.',
      'Sums up subtotals, VAT, and deposits into a single balance due.',
    ],
    seenBy: [
      'Customer sees a single combined invoice with one consolidated payment reference.',
    ],
    rules: [
      '400 if fewer than 2 bookings or mixed currencies.',
      '401 if not authenticated.',
      '409 if any booking is not in AWAITING_PAYMENT, already paid, or part of another combined invoice.',
    ],
  })
  @ApiCreatedResponse({ type: InvoiceDetailResponse })
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
  @ApiParam(NUMBER)
  @ApiEndpoint({
    summary: 'One invoice',
    does: 'Returns full invoice breakdown including line items, VAT calculation, security deposits, payment blockers, and ungroup eligibility.',
    behind: [
      'Queries invoice by number for the authenticated customer.',
      'Derives blockers, payment instructions, balance due, and ungroup eligibility.',
    ],
    seenBy: [
      'Customer views the Invoice Details screen.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if invoice number not found for this customer.',
    ],
  })
  @ApiOkResponse({ type: InvoiceDetailResponse })
  get(
    @CurrentUser('id') userId: string,
    @Param('number') number: string,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.getForCustomer(userId, number);
  }

  @Get(':number/payment-instructions')
  @ApiParam(NUMBER)
  @ApiEndpoint({
    summary: 'How to pay an invoice',
    does: 'Returns Eskista bank accounts, Telebirr merchant code, exact transfer amount, and invoice reference for offline payment.',
    behind: [
      'Fetches active bank and Telebirr collection accounts from platform settings.',
      'Confirms amountDueMinor and checks blockers.',
    ],
    seenBy: [
      'Customer views payment transfer instructions and account numbers.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if invoice not found.',
    ],
  })
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
  @ApiParam(NUMBER)
  @ApiEndpoint({
    summary: 'Submit payment for an invoice',
    does: 'Uploads transfer receipt proof for an invoice, splitting payment proportionally across constituent bookings.',
    behind: [
      'Uploads receipt image or PDF to private storage.',
      'Creates Payment record for each booking on the invoice and marks status as SUBMITTED.',
      'Queues for Eskista finance team verification.',
    ],
    seenBy: [
      'Customer sees invoice and bookings transition to "Payment Pending Verification".',
    ],
    rules: [
      '400 if missing receipt file, missing transactionReference, or invalid amount.',
      '401 if not authenticated.',
      '404 if invoice not found.',
      '409 if any booking on the invoice has unsigned agreements or existing pending payment.',
    ],
  })
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
  @ApiParam(NUMBER)
  @ApiEndpoint({
    summary: 'Download the invoice as a PDF',
    does: 'Renders and streams an official Ethiopian VAT tax invoice PDF with QR code and line item breakdowns.',
    behind: [
      'Renders printable tax invoice PDF with company TIN, customer details, line items, and VAT breakdown.',
      'Sets Content-Disposition attachment header.',
    ],
    seenBy: [
      'Customer downloads and saves or prints the official tax invoice PDF.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if invoice not found.',
    ],
  })
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
  @ApiParam(NUMBER)
  @ApiEndpoint({
    summary: 'Split a combined invoice',
    does: 'Splits a combined invoice back into individual single-booking invoices before any payment is made.',
    behind: [
      'Voids the combined invoice and reactivates individual booking invoices.',
      'Verifies no payments have been recorded against the combined invoice.',
    ],
    seenBy: [
      'Customer sees the bookings separated back into individual payable items.',
    ],
    rules: [
      '401 if not authenticated.',
      '404 if invoice not found.',
      '409 if a payment has already been submitted or verified against the combined invoice.',
    ],
  })
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
@AdminAccess()
@Controller({ path: 'admin/invoices', version: '1' })
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiEndpoint({
    summary: 'All invoices',
    does: 'Every invoice Eskista has issued. Filter by `status` or `customerId`.',
    behind: ['Read only.'],
  })
  @ApiOkResponse({ type: [InvoiceSummaryResponse] })
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminInvoiceQuery): Promise<InvoiceSummaryResponse[]> {
    return this.invoices.adminList(query);
  }

  @Post()
  @ApiEndpoint({
    summary: "Combine a customer's bookings into one invoice",
    does: "The same as the customer's Pay Together, done on their behalf. The bookings must all belong to one customer.",
    behind: [
      "A new combined invoice is created covering the selected bookings; each booking's individual invoice is voided.",
      'Actor recorded as the admin.',
      'Admin audit log written.',
    ],
    rules: [
      'Finance and Super Admins.',
      '400 when the bookings belong to different customers.',
      '409 when a booking is not awaiting payment.',
    ],
  })
  @AdminAccess(AdminTier.FINANCE)
  @ApiCreatedResponse({ type: InvoiceDetailResponse })
  @ApiStandardErrors({
    badRequest: 'The bookings belong to different customers, or fewer than two were sent.',
    notFound: 'Booking not found',
    conflict: 'A booking is not awaiting payment, or already has a payment sent',
  })
  combine(
    @CurrentUser('id') adminId: string,
    @Body() dto: CombineInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.combine(dto.bookingReferences, { id: adminId, role: Role.ADMIN });
  }

  @Get(':number')
  @ApiEndpoint({
    summary: 'One invoice, including voided ones',
    does: 'The full invoice with all its lines and payment history.',
    behind: ['Read only.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(NUMBER)
  @ApiOkResponse({ type: InvoiceDetailResponse })
  @ApiStandardErrors({ notFound: 'Invoice not found' })
  get(@Param('number') number: string): Promise<InvoiceDetailResponse> {
    return this.invoices.adminGet(number);
  }

  @Patch(':number/vat')
  @ApiEndpoint({
    summary: 'Charge or waive VAT on this invoice',
    does: "The client's per-invoice exemption. Takes the VAT out of every line (or puts it back).",
    behind: [
      "Every line's VAT, total and the invoice grand total recomputed.",
      'Admin audit log written.',
    ],
    rules: ['Finance and Super Admins.', '409 once a payment has been sent against it.'],
  })
  @AdminAccess(AdminTier.FINANCE)
  @ApiParam(NUMBER)
  @ApiOkResponse({ type: InvoiceDetailResponse })
  @ApiStandardErrors({
    badRequest: '`vatExempt` missing.',
    notFound: 'Invoice not found',
    conflict: 'A payment has already been sent against this invoice',
  })
  setVat(
    @CurrentUser('id') adminId: string,
    @Param('number') number: string,
    @Body() dto: SetVatDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.setVat(adminId, number, dto.vatExempt, dto.reason);
  }

  @Post(':number/void')
  @ApiEndpoint({
    summary: 'Void an invoice',
    does: 'Its bookings get new invoices when next paid. Refused once a payment is verified.',
    behind: [
      "Invoice status → VOID; each booking's invoice link cleared.",
      'Admin audit log written.',
    ],
    rules: ['Finance and Super Admins.', '409 once a payment is verified against it.'],
  })
  @AdminAccess(AdminTier.FINANCE)
  @HttpCode(HttpStatus.OK)
  @ApiParam(NUMBER)
  @ApiOkResponse({ type: InvoiceDetailResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Invoice not found',
    conflict: 'A verified payment is recorded against this invoice',
  })
  void(
    @CurrentUser('id') adminId: string,
    @Param('number') number: string,
    @Body() dto: VoidInvoiceDto,
  ): Promise<InvoiceDetailResponse> {
    return this.invoices.void(adminId, number, dto.reason);
  }

  @Get(':number/pdf')
  @ApiEndpoint({
    summary: 'Download any invoice as a PDF',
    does: 'The issued invoice as a PDF, with company details, lines and totals.',
    behind: ['Rendered on demand from the invoice record. Nothing is stored.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(NUMBER)
  @ApiOkResponse({ description: 'The PDF.', content: PDF_CONTENT })
  @ApiStandardErrors({ notFound: 'Invoice not found' })
  async pdf(
    @Param('number') number: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoices.pdf(number);
    return sendPdf(res, buffer, filename);
  }
}
