import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CollectionAccountResponse } from '../../customer-bookings/dto/lifecycle.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CombineInvoiceDto {
  @ApiProperty({
    type: [String],
    description:
      'The bookings to pay together — two or more, all awaiting payment, none already paid ' +
      'or with a payment being verified.',
    example: ['ESK-10484', 'ESK-TLT-1005'],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  bookingReferences!: string[];
}

export class PayInvoiceDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.BANK_TRANSFER })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({ example: 'FT26270XYZ12', description: 'The bank or Telebirr transaction ID.' })
  @IsString()
  @MinLength(4)
  @MaxLength(80)
  @Transform(trim)
  transactionReference!: string;

  @ApiProperty({
    description:
      'The whole amount transferred, in minor units. Not checked against the invoice: a ' +
      'wrong figure is for Eskista to see on the receipt, not a 400.',
    example: 2144500,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiPropertyOptional({ description: 'Which Eskista account from `accounts` was paid into.' })
  @IsOptional()
  @IsUUID()
  collectionAccountId?: string;
}

export class SetVatDto {
  @ApiProperty({ description: 'Charge no VAT on this invoice.', example: true })
  @IsBoolean()
  vatExempt!: boolean;

  @ApiPropertyOptional({ example: 'Registered VAT-exempt NGO', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  reason?: string;
}

export class VoidInvoiceDto {
  @ApiProperty({ example: 'Issued in error', maxLength: 300 })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  @Transform(trim)
  reason!: string;
}

export class AdminInvoiceQuery {
  @ApiPropertyOptional({ enum: InvoiceStatus, example: InvoiceStatus.ISSUED })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only this customer’s invoices.' })
  @IsOptional()
  @IsString()
  customerId?: string;
}

// ── Responses ────────────────────────────────────────────────────────────────

export class InvoiceLineResponse {
  @ApiProperty({ example: 'ESK-10484' }) bookingReference!: string;
  @ApiProperty({ enum: BookingStatus, example: BookingStatus.AWAITING_PAYMENT })
  bookingStatus!: BookingStatus;
  @ApiProperty({ example: 'Aputure LS 300d II · Sep 30 – Oct 2' }) description!: string;
  @ApiProperty({ example: 1500000 }) subtotalMinor!: number;
  @ApiProperty({ example: 50000 }) deliveryFeeMinor!: number;
  @ApiProperty({ example: 0 }) serviceFeeMinor!: number;
  @ApiProperty({ example: 0 }) discountMinor!: number;
  @ApiProperty({ example: 232500 }) taxMinor!: number;
  @ApiProperty({ example: 300000 }) securityDepositMinor!: number;
  @ApiProperty({ example: 1782500, description: 'Goods and services, as charged.' })
  totalMinor!: number;
  @ApiProperty({ example: 2082500, description: 'This line’s total plus its deposit.' })
  amountDueMinor!: number;
  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: 'Why this booking cannot be paid yet, e.g. its agreement is unsigned.',
  })
  paymentBlocker!: string | null;
}

export class InvoicePaymentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'ESK-10484' }) bookingReference!: string;
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.BANK_TRANSFER })
  method!: PaymentMethod;
  @ApiProperty({ example: 'FT26270XYZ12' }) transactionReference!: string;
  @ApiProperty({ example: 2082500, description: 'This booking’s share of the transfer.' })
  amountMinor!: number;
  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.VERIFIED }) status!: PaymentStatus;
  @ApiProperty({ example: '/api/v1/files/bookings/ESK-10484/receipts/ft26270xyz12.jpg' })
  receiptUrl!: string;
  @ApiProperty({ example: '2026-09-29T11:20:00.000Z' }) submittedAt!: string;
}

export class BilledToResponse {
  @ApiProperty({ example: 'Habesha Films' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Bole Sub-City, Woreda 03, Addis Ababa' })
  address!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) tin!: string | null;
}

export class InvoiceSummaryResponse {
  @ApiProperty({ example: 'ESK-INV-2026-000148' }) number!: string;
  @ApiProperty({ enum: InvoiceStatus, example: InvoiceStatus.ISSUED }) status!: InvoiceStatus;
  @ApiProperty({ example: true, description: 'Several bookings paid together.' })
  combined!: boolean;
  @ApiProperty({ example: 2 }) bookingCount!: number;
  @ApiProperty({ type: [String], example: ['ESK-10484', 'ESK-TLT-1005'] })
  bookingReferences!: string[];
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ example: 3162500 }) totalMinor!: number;
  @ApiProperty({ example: 3462500, description: 'Total plus deposits — what to transfer.' })
  amountDueMinor!: number;
  @ApiProperty({ example: 0 }) amountPaidMinor!: number;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-28T09:00:00.000Z' }) issuedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-05T21:00:00.000Z' }) dueAt!:
    string | null;
}

export class InvoiceDetailResponse extends InvoiceSummaryResponse {
  @ApiProperty({ type: BilledToResponse }) billedTo!: BilledToResponse;
  @ApiProperty({ type: [InvoiceLineResponse] }) lines!: InvoiceLineResponse[];
  @ApiProperty({ example: 2700000 }) subtotalMinor!: number;
  @ApiProperty({ example: 50000 }) deliveryFeeMinor!: number;
  @ApiProperty({ example: 0 }) serviceFeeMinor!: number;
  @ApiProperty({ example: 0 }) discountMinor!: number;
  @ApiProperty({ example: 300000 }) securityDepositMinor!: number;
  @ApiProperty({ example: 412500 }) taxMinor!: number;
  @ApiProperty({ example: 1500 }) taxRateBps!: number;
  @ApiProperty({ example: false }) vatExempt!: boolean;
  @ApiPropertyOptional({ nullable: true, example: null }) vatExemptionReason!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Inc. 15% VAT' }) taxNote!: string | null;
  @ApiProperty({ example: 3462500, description: 'Due minus verified payments.' })
  balanceMinor!: number;
  @ApiProperty({ type: [InvoicePaymentResponse] }) payments!: InvoicePaymentResponse[];
  @ApiProperty({ example: false, description: 'Pay Now is available.' }) canPay!: boolean;
  @ApiProperty({
    type: [String],
    example: ['ESK-10484: Download, sign and upload the agreement first.'],
    description:
      'Why not, per booking — "ESK-10484: Download, sign and upload the agreement first."',
  })
  blockers!: string[];
  @ApiProperty({
    example: true,
    description: 'The customer may split it back into single bookings.',
  })
  canUngroup!: boolean;
  @ApiProperty({ example: '/api/v1/customer/invoices/ESK-INV-2026-000148/pdf' }) pdfUrl!: string;
  @ApiPropertyOptional({ nullable: true, example: null }) voidReason!: string | null;
}

export class InvoicePaymentInstructionsResponse {
  @ApiProperty({ example: 'ESK-INV-2026-000201' }) invoiceNumber!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() amountDueMinor!: number;
  @ApiProperty() amountPaidMinor!: number;
  @ApiPropertyOptional({ nullable: true, type: Object })
  telebirr!: { number: string; accountName: string } | null;
  @ApiPropertyOptional({ nullable: true, type: Object })
  bank!: { bank: string; accountName: string; accountNumber: string } | null;
  @ApiProperty({
    type: () => [CollectionAccountResponse],
    description: 'Every account to pay into.',
  })
  accounts!: CollectionAccountResponse[];
  @ApiProperty({ description: 'Use the invoice number as the transfer reference.' })
  paymentReference!: string;
  @ApiProperty() canSubmit!: boolean;
  @ApiProperty({ type: [String] }) blockers!: string[];
}

export class PayableBookingResponse {
  @ApiProperty({ example: 'ESK-10484' }) reference!: string;
  @ApiProperty() description!: string;
  @ApiProperty() amountDueMinor!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Its current single invoice, if any.' })
  invoiceNumber!: string | null;
}
