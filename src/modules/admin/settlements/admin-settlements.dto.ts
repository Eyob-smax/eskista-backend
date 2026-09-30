import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayeeKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  NotEquals,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const SETTLEMENT_FILTERS = ['PENDING', 'OVERDUE', 'PAID', 'ON_HOLD'] as const;

export class AdminSettlementsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SETTLEMENT_FILTERS })
  @IsOptional()
  @IsIn(SETTLEMENT_FILTERS)
  status?: (typeof SETTLEMENT_FILTERS)[number];

  @ApiPropertyOptional({ enum: PayeeKind, description: 'Vendor Settlements or talent payouts.' })
  @IsOptional()
  @IsEnum(PayeeKind)
  payeeKind?: PayeeKind;

  @ApiPropertyOptional({ description: 'STL reference, booking reference, vendor or talent.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() talentProfileId?: string;

  @ApiPropertyOptional({ description: 'Created on or after.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Created on or before.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class MarkPaidDto {
  @ApiProperty({ example: 'FT26281PAY0042', description: 'The payout transfer reference.' })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Transform(trim)
  payoutReference!: string;

  @ApiPropertyOptional({
    description: "One of the payee's payout accounts; their primary one if omitted.",
  })
  @IsOptional()
  @IsUUID()
  payoutAccountId?: string;

  @ApiPropertyOptional({ description: 'When it was sent, if not now.' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class AdjustmentDto {
  @ApiProperty({
    example: -50000,
    description: 'Signed minor units: negative takes off the payout.',
  })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  amountMinor!: number;

  @ApiProperty({ example: 'Late handover penalty' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Transform(trim)
  reason!: string;
}

export class HoldDto {
  @ApiProperty({ description: 'true holds the payout, false releases it.' })
  @IsBoolean()
  hold!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class SettlementRowResponse {
  @ApiProperty({ example: 'STL-0842' }) reference!: string;
  @ApiProperty({ example: 'ESK-10482' }) bookingReference!: string;
  @ApiProperty({ enum: PayeeKind }) payeeKind!: PayeeKind;
  @ApiProperty() payeeId!: string;
  @ApiProperty({ example: 'Afro Studio' }) payeeName!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) itemName!: string;
  @ApiProperty({ description: 'Rental revenue before VAT: supplier price plus commission.' })
  grossMinor!: number;
  @ApiProperty({ description: "Eskista's share." }) commissionMinor!: number;
  @ApiProperty({ description: 'Signed.' }) adjustmentMinor!: number;
  @ApiProperty({ description: 'Net payable.' }) netMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['PENDING', 'OVERDUE', 'PAID', 'ON_HOLD'] }) status!: string;
  @ApiProperty({ example: 'Overdue' }) statusLabel!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Due date.' }) expectedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: string | null;
  @ApiProperty({ description: 'Issued.' }) createdAt!: string;
}

export class SettlementsSummaryResponse {
  @ApiProperty() pendingCount!: number;
  @ApiProperty() pendingMinor!: number;
  @ApiProperty() overdueCount!: number;
  @ApiProperty() overdueMinor!: number;
  @ApiProperty() paidThisMonthMinor!: number;
  @ApiProperty() commissionThisMonthMinor!: number;
  @ApiProperty() currency!: string;
}

export class SettlementDetailResponse extends SettlementRowResponse {
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  breakdown!: { label: string; amountMinor: number; emphasis?: boolean }[];
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  adjustments!: {
    id: string;
    amountMinor: number;
    reason: string;
    createdBy: string | null;
    createdAt: string;
  }[];
  @ApiPropertyOptional({
    nullable: true,
    type: Object,
    description: 'Where the money went, once paid.',
  })
  destination!: {
    channel: string | null;
    provider: string | null;
    accountName: string | null;
    accountNumber: string | null;
  } | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: "The payee's accounts, to pick from.",
  })
  payoutAccounts!: {
    id: string;
    channel: string;
    provider: string;
    accountName: string;
    accountNumber: string;
    isPrimary: boolean;
  }[];
  @ApiPropertyOptional({ nullable: true }) payoutReference!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidByName!: string | null;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiPropertyOptional({ nullable: true }) payeeConfirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) payeeDisputeNote!: string | null;
  @ApiProperty() bookingStatus!: string;
  @ApiProperty() pdfUrl!: string;
}
