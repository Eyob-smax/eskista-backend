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
    example: 'PAY-0042',
    description: 'PAY reference, booking reference, invoice number, transaction ID or customer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Submitted on or after (ISO date).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Submitted on or before (ISO date).' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ConfirmPaymentDto {
  @ApiPropertyOptional({
    example: 1_585_000,
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

  @ApiPropertyOptional({ example: 'Verified against CBE statement ref FT26271SEED42.' })
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

  @ApiProperty({ example: 1_585_000, description: 'Minor units received.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiPropertyOptional({ example: 'Habesha Films PLC' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  payerName?: string;

  @ApiPropertyOptional({ example: 'Cash collected at Hub reception.' })
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
  @ApiProperty({ example: 12 }) pendingCount!: number;
  @ApiProperty({ example: 18_900_000 }) pendingAmountMinor!: number;
  @ApiProperty({ example: 3 }) requestedReceiptCount!: number;
  @ApiProperty({ example: 5 }) confirmedTodayCount!: number;
  @ApiProperty({ example: 42_500_000 }) confirmedThisMonthMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
}

export class PaymentBookingShareResponse {
  @ApiProperty({ example: 'ESK-10484' }) reference!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) itemName!: string;
  @ApiProperty({ enum: ['EQUIPMENT', 'TALENT'] }) type!: 'EQUIPMENT' | 'TALENT';
  @ApiProperty({ example: 'AWAITING_PAYMENT' }) status!: string;
  @ApiProperty({ example: 1_085_000, description: "This booking's part of the transfer." })
  amountMinor!: number;
  @ApiProperty({ example: 1_085_000 }) dueMinor!: number;
  @ApiProperty({ example: 500_000, description: 'Verified so far, other transfers included.' })
  paidMinor!: number;
  @ApiProperty({
    type: [String],
    example: ['Shortfall: ETB 5,850.00 still owed'],
    description: 'Why it is not confirmed yet, after this payment.',
  })
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
  @ApiProperty({
    example: 1_585_000,
    description: 'What these bookings still owed before this transfer.',
  })
  expectedAmountMinor!: number;
  @ApiPropertyOptional({ nullable: true, example: 1_585_000 }) receivedAmountMinor!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 'Habesha Films PLC' }) payerName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '1000123456789' }) payerAccount!: string | null;
  @ApiPropertyOptional({
    type: PaidIntoResponse,
    nullable: true,
    description: 'Which Eskista account the customer says they paid into.',
  })
  paidInto!: PaidIntoResponse | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Verified against CBE statement ref FT26271SEED42.',
  })
  reviewNote!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'The transaction ID does not match any transfer we received.',
  })
  rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-29T10:15:00.000Z' }) verifiedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Abel Tesfaye' }) verifiedByName!: string | null;
  @ApiProperty({ type: ReceiptFileResponse, description: 'The uploaded slip — View Full Receipt.' })
  receipt!: ReceiptFileResponse;
  @ApiProperty({ type: [PaymentBookingShareResponse] }) bookings!: PaymentBookingShareResponse[];
  @ApiProperty({ type: [PaymentRowResponse], description: 'Other transfers on these bookings.' })
  history!: PaymentRowResponse[];
  @ApiProperty({ example: true }) canDecide!: boolean;
}
