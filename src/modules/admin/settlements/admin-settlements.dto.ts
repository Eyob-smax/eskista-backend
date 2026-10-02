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

  @ApiPropertyOptional({
    example: 'STL-0042',
    description: 'STL reference, booking reference, vendor or talent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ example: '5b0c2f9e-6a1d-4c1e-9f0a-2d3e4f5a6b7c' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;
  @ApiPropertyOptional({ example: '9d2f4b6a-1c3e-4a5b-8c7d-6e5f4a3b2c1d' })
  @IsOptional()
  @IsUUID()
  talentProfileId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Created on or after.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Created on or before.' })
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
    example: '7c1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
    description: "One of the payee's payout accounts; their primary one if omitted.",
  })
  @IsOptional()
  @IsUUID()
  payoutAccountId?: string;

  @ApiPropertyOptional({
    example: '2026-10-02T09:30:00.000Z',
    description: 'When it was sent, if not now.',
  })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional({ example: 'Sent via CBE corporate batch.' })
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
  @ApiProperty({ example: true, description: 'true holds the payout, false releases it.' })
  @IsBoolean()
  hold!: boolean;

  @ApiPropertyOptional({ example: 'Damage dispute pending resolution.' })
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
  @ApiProperty({ example: '3f1a2b3c-4d5e-4f6a-8b9c-0d1e2f3a4b5c' }) payeeId!: string;
  @ApiProperty({ example: 'Afro Studio' }) payeeName!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) itemName!: string;
  @ApiProperty({
    example: 900_000,
    description: 'Rental revenue before VAT: supplier price plus commission.',
  })
  grossMinor!: number;
  @ApiProperty({ example: 135_000, description: "Eskista's share." }) commissionMinor!: number;
  @ApiProperty({ example: -50_000, description: 'Signed.' }) adjustmentMinor!: number;
  @ApiProperty({ example: 715_000, description: 'Net payable.' }) netMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ enum: ['PENDING', 'OVERDUE', 'PAID', 'ON_HOLD'] }) status!: string;
  @ApiProperty({ example: 'Overdue' }) statusLabel!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-05T00:00:00.000Z',
    description: 'Due date.',
  })
  expectedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-04T14:20:00.000Z' }) paidAt!:
    string | null;
  @ApiProperty({ example: '2026-09-28T07:12:00.000Z', description: 'Issued.' }) createdAt!: string;
}

export class SettlementsSummaryResponse {
  @ApiProperty({ example: 8 }) pendingCount!: number;
  @ApiProperty({ example: 6_400_000 }) pendingMinor!: number;
  @ApiProperty({ example: 2 }) overdueCount!: number;
  @ApiProperty({ example: 1_800_000 }) overdueMinor!: number;
  @ApiProperty({ example: 12_400_000 }) paidThisMonthMinor!: number;
  @ApiProperty({ example: 1_860_000 }) commissionThisMonthMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
}

export class SettlementDetailResponse extends SettlementRowResponse {
  @ApiProperty({
    example: [
      { label: 'Rental Revenue', amountMinor: 1_035_000 },
      { label: 'Commission', amountMinor: -135_000 },
      { label: 'Settlement', amountMinor: 900_000, emphasis: true },
    ],
    type: 'array',
    items: { type: 'object' },
  })
  breakdown!: { label: string; amountMinor: number; emphasis?: boolean }[];
  @ApiProperty({
    example: [
      {
        id: '5b0c2f9e-6a1d-4c1e-9f0a-2d3e4f5a6b7c',
        amountMinor: 150_000,
        reason: 'Damage compensation withheld from the deposit',
        createdBy: 'Sara Mekonnen',
        createdAt: '2026-10-04T10:00:00.000Z',
      },
    ],
    type: 'array',
    items: { type: 'object' },
  })
  adjustments!: {
    id: string;
    amountMinor: number;
    reason: string;
    createdBy: string | null;
    createdAt: string;
  }[];
  @ApiPropertyOptional({
    example: {
      channel: 'TELEBIRR',
      provider: 'Telebirr',
      accountName: 'Afro Studio',
      accountNumber: '0911000002',
    },
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
    example: [
      {
        id: '7c1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
        channel: 'TELEBIRR',
        provider: 'Telebirr',
        accountName: 'Afro Studio',
        maskedNumber: '•••• 0002',
        isPrimary: true,
      },
    ],
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
  @ApiPropertyOptional({ nullable: true, example: 'FT26281PAY0042' }) payoutReference!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Abel Tesfaye' }) paidByName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Sent via CBE corporate batch.' }) notes!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-05T11:00:00.000Z' }) payeeConfirmedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Amount received is ETB 50 less than expected.' })
  payeeDisputeNote!: string | null;
  @ApiProperty({ example: 'CLOSED' }) bookingStatus!: string;
  @ApiProperty({ example: '/api/v1/admin/settlements/STL-0842/pdf' }) pdfUrl!: string;
}
