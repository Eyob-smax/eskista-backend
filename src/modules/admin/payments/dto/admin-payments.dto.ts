import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The design's chips: Confirmed, Pending, Requested Receipt — plus Rejected. */
export const PAYMENT_FILTERS = ['PENDING', 'CONFIRMED', 'REQUESTED_RECEIPT', 'REJECTED'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export const FILTER_STATUS: Record<PaymentFilter, PaymentStatus> = {
  PENDING: PaymentStatus.SUBMITTED,
  CONFIRMED: PaymentStatus.VERIFIED,
  REQUESTED_RECEIPT: PaymentStatus.RESUBMISSION_REQUESTED,
  REJECTED: PaymentStatus.REJECTED,
};

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  SUBMITTED: 'Pending',
  VERIFIED: 'Confirmed',
  RESUBMISSION_REQUESTED: 'Requested Receipt',
  REJECTED: 'Rejected',
};

export class AdminPaymentsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: PAYMENT_FILTERS })
  @IsOptional()
  @IsIn(PAYMENT_FILTERS)
  status?: PaymentFilter;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'PAY reference, booking reference, invoice number, transaction ID or customer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ description: 'Submitted on or after (ISO date).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Submitted on or before (ISO date).' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ConfirmPaymentDto {
  @ApiPropertyOptional({
    description:
      'What actually arrived, from the statement, in minor units. Defaults to what the ' +
      'customer declared. A shortfall leaves the booking awaiting the rest.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  receivedAmountMinor?: number;

  @ApiPropertyOptional({
    example: 'Habesha Films PLC',
    description: 'Payer name on the statement.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  payerName?: string;

  @ApiPropertyOptional({ example: '1000123456789', description: 'Payer account or phone.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  payerAccount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class PaymentDecisionDto {
  @ApiProperty({ example: 'The transaction ID does not match any transfer we received.' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class RecordPaymentDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({ example: 'CASH-2026-0012', description: 'Receipt or transaction number.' })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Transform(trim)
  transactionReference!: string;

  @ApiProperty({ description: 'Minor units received.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  payerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class PaymentCustomerResponse {
  @ApiProperty({ format: 'uuid', description: 'The customer’s user id.' }) id!: string;
  @ApiProperty({ example: 'Yoseph Alemu' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Habesha Films' }) organisation!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'yoseph@habeshafilms.et' }) email!: string | null;
}

export class PaymentRowResponse {
  @ApiProperty({ example: 'PAY-0842' }) reference!: string;
  @ApiProperty({ type: [String], example: ['ESK-10482'] }) bookingReferences!: string[];
  @ApiPropertyOptional({ nullable: true, example: 'ESK-INV-2026-000148' }) invoiceNumber!:
    string | null;
  @ApiProperty({ type: PaymentCustomerResponse }) customer!: PaymentCustomerResponse;
  @ApiProperty({
    example: 1_585_000,
    description: 'The whole transfer the customer declared, in minor units.',
  })
  amountMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ example: 'Bank Transfer' }) methodLabel!: string;
  @ApiProperty({ example: 'FT26271SEED42' }) transactionReference!: string;
  @ApiProperty({ example: '2026-09-28T07:12:00.000Z' }) submittedAt!: string;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ example: 'Pending' }) statusLabel!: string;
  @ApiProperty({
    example: '/api/v1/files/customers/7c1e…/slip.pdf',
    description: 'View or download the slip.',
  })
  receiptUrl!: string;
}

export class PaymentsSummaryResponse {
  @ApiProperty() pendingCount!: number;
  @ApiProperty() pendingAmountMinor!: number;
  @ApiProperty() requestedReceiptCount!: number;
  @ApiProperty() confirmedTodayCount!: number;
  @ApiProperty() confirmedThisMonthMinor!: number;
  @ApiProperty() currency!: string;
}

export class PaymentBookingShareResponse {
  @ApiProperty() reference!: string;
  @ApiProperty() itemName!: string;
  @ApiProperty({ enum: ['EQUIPMENT', 'TALENT'] }) type!: 'EQUIPMENT' | 'TALENT';
  @ApiProperty() status!: string;
  @ApiProperty({ description: "This booking's part of the transfer." }) amountMinor!: number;
  @ApiProperty() dueMinor!: number;
  @ApiProperty({ description: 'Verified so far, other transfers included.' }) paidMinor!: number;
  @ApiProperty({ type: [String], description: 'Why it is not confirmed yet, after this payment.' })
  confirmationBlockers!: string[];
}

export class PaidIntoResponse {
  @ApiProperty({ example: 'Commercial Bank of Ethiopia' }) provider!: string;
  @ApiProperty({ example: 'Eskista Marketplace PLC' }) accountName!: string;
  @ApiProperty({ example: '1000234567890' }) accountNumber!: string;
}

export class ReceiptFileResponse {
  @ApiProperty({ example: '/api/v1/files/customers/7c1e…/payments/ESK-10484/slip.pdf' })
  url!: string;
  @ApiPropertyOptional({ nullable: true, example: 'cbe-transfer.pdf' }) fileName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'application/pdf' }) mimeType!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 184000 }) sizeBytes!: number | null;
}

export class PaymentDetailResponse extends PaymentRowResponse {
  @ApiProperty({ description: 'What these bookings still owed before this transfer.' })
  expectedAmountMinor!: number;
  @ApiPropertyOptional({ nullable: true }) receivedAmountMinor!: number | null;
  @ApiPropertyOptional({ nullable: true }) payerName!: string | null;
  @ApiPropertyOptional({ nullable: true }) payerAccount!: string | null;
  @ApiPropertyOptional({
    type: PaidIntoResponse,
    nullable: true,
    description: 'Which Eskista account the customer says they paid into.',
  })
  paidInto!: PaidIntoResponse | null;
  @ApiPropertyOptional({ nullable: true }) reviewNote!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) verifiedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) verifiedByName!: string | null;
  @ApiProperty({ type: ReceiptFileResponse, description: 'The uploaded slip — View Full Receipt.' })
  receipt!: ReceiptFileResponse;
  @ApiProperty({ type: [PaymentBookingShareResponse] }) bookings!: PaymentBookingShareResponse[];
  @ApiProperty({ type: [PaymentRowResponse], description: 'Other transfers on these bookings.' })
  history!: PaymentRowResponse[];
  @ApiProperty() canDecide!: boolean;
}
