import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerKind, VerificationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { PayoutAccountResponse } from '../../payout-accounts/payout-accounts';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminVendorsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: VerificationStatus })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({
    example: 'Afro Studio',
    description: 'Business, representative, phone or email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ example: 'Addis Ababa' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  location?: string;
}

export class AdminCustomersQuery extends PaginationQuery {
  @ApiPropertyOptional({ example: 'Yoseph', description: 'Name, organisation, phone or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ enum: VerificationStatus, description: 'The Verified customer badge.' })
  @IsOptional()
  @IsEnum(VerificationStatus)
  verification?: VerificationStatus;

  @ApiPropertyOptional({ enum: CustomerKind })
  @IsOptional()
  @IsEnum(CustomerKind)
  kind?: CustomerKind;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}

export class VerifyVendorDto {
  @ApiPropertyOptional({
    description: "The vendor's commission, in basis points. Omit to keep the default.",
    example: 1500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  commissionRateBps?: number;

  @ApiPropertyOptional({ example: 'All documents verified against originals.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class AccountReasonDto {
  @ApiProperty({ example: 'Documents do not match the business name.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

// ── Responses ────────────────────────────────────────────────────────────────

export class VendorRowResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Afro Studio' }) businessName!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'https://res.cloudinary.com/…/vendors/…/logo.png',
  })
  logoUrl!: string | null;
  @ApiProperty({ example: '2026-05-14T08:00:00.000Z' }) joinedAt!: string;
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Shebelaw Bogale',
    description: 'Contact representative.',
  })
  representative!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911000002' }) phone!: string | null;
  @ApiProperty({ example: 6, description: 'Units in service.' }) inventoryUnits!: number;
  @ApiProperty({ example: 2, description: 'Confirmed through inspection.' }) activeRentals!: number;
  @ApiProperty({ enum: VerificationStatus, example: VerificationStatus.VERIFIED })
  status!: VerificationStatus;
  @ApiProperty({
    example: 'Verified',
    description: 'Verified, Pending, Rejected, Suspended, Incomplete.',
  })
  statusLabel!: string;
  @ApiProperty({ example: false, description: 'The whole account is suspended (Suspend User).' })
  accountBlocked!: boolean;
}

export class VendorDocumentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'BUSINESS_LICENSE' }) type!: string;
  @ApiProperty({ example: 'Business License' }) typeLabel!: string;
  @ApiProperty({ enum: ['PENDING', 'VERIFIED', 'REJECTED'], example: 'PENDING' }) status!: string;
  @ApiProperty({ example: 'trade-license.pdf' }) fileName!: string;
  @ApiProperty({ example: '/api/v1/files/vendors/…/documents/trade-license.pdf' }) url!: string;
  @ApiProperty({ example: '2026-05-14T08:30:00.000Z' }) uploadedAt!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Document expired; please re-upload.' })
  rejectionReason!: string | null;
}

export class VendorAgreementSummaryResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'UNDER_REVIEW' }) status!: string;
  @ApiPropertyOptional({ nullable: true, example: '/api/v1/admin/agreements/…/pdf' }) documentUrl!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '/api/v1/files/vendors/…/agreement-signed.pdf' })
  signedCopyUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-06-01T09:00:00.000Z' }) uploadedAt!:
    string | null;
}

export class VendorRecentBookingResponse {
  @ApiProperty({ example: 'ESK-10485' }) reference!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Sony FX3 Cinema Camera' }) itemName!:
    string | null;
  @ApiProperty({ example: 'IN_PROGRESS' }) status!: string;
  @ApiProperty({ example: '2026-09-26' }) startDate!: string;
  @ApiProperty({ example: '2026-09-29' }) endDate!: string;
  @ApiProperty({ example: 900_000 }) earningsMinor!: number;
}

export class VendorDetailResponse extends VendorRowResponse {
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'], example: 'COMPANY' }) kind!: string;
  @ApiProperty({ example: 'RENTAL_COMPANY' }) vendorType!: string;
  @ApiProperty({ example: 'hello@afrostudio.et' }) email!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Full-service production house in Addis Ababa.' })
  about!: string | null;
  @ApiProperty({ example: 4.7 }) rating!: number;
  @ApiProperty({ example: 23 }) ratingCount!: number;
  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: 'Per-vendor commission; null = default.',
  })
  commissionRateBps!: number | null;
  @ApiProperty({ example: 12_400_000, description: 'Every payout already paid.' })
  lifetimeEarningsMinor!: number;
  @ApiProperty({ example: 14 }) paidBookings!: number;
  @ApiProperty({ example: 900_000, description: 'Pending escrow settlement: owed, not yet paid.' })
  pendingSettlementMinor!: number;
  @ApiProperty({ type: [PayoutAccountResponse] }) payoutAccounts!: PayoutAccountResponse[];
  @ApiPropertyOptional({ type: PayoutAccountResponse, nullable: true })
  primaryPayout!: PayoutAccountResponse | null;
  @ApiPropertyOptional({ type: PayoutAccountResponse, nullable: true })
  alternativePayout!: PayoutAccountResponse | null;
  @ApiProperty({ type: [VendorDocumentResponse] }) documents!: VendorDocumentResponse[];
  @ApiPropertyOptional({
    type: VendorAgreementSummaryResponse,
    nullable: true,
    description: 'The vendor (partnership) agreement.',
  })
  agreement!: VendorAgreementSummaryResponse | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { PUBLISHED: 5, PENDING_REVIEW: 1 },
    description: 'Listing counts by status.',
  })
  listingsByStatus!: Record<string, number>;
  @ApiProperty({ type: [VendorRecentBookingResponse] })
  recentBookings!: VendorRecentBookingResponse[];
  @ApiProperty({
    type: [String],
    example: [],
    description: 'Why Verify would fail now; empty when it can.',
  })
  verificationBlockers!: string[];
  @ApiPropertyOptional({ nullable: true, example: '2026-06-10T11:00:00.000Z' }) verifiedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Abel Tesfaye' }) verifiedBy!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Documents do not match the business name.' })
  rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-08-20T14:00:00.000Z' }) suspendedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Multiple unresolved damage complaints.' })
  suspendedReason!: string | null;
}

export class CustomerRowResponse {
  @ApiProperty({ format: 'uuid', description: 'The customer’s user id.' }) id!: string;
  @ApiProperty({ example: 'Yoseph Alemu' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Habesha Films' }) organisation!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'https://res.cloudinary.com/…/customers/…/avatar.jpg',
  })
  avatarUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Addis Ababa' }) location!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'yoseph@habeshafilms.et' }) email!: string | null;
  @ApiProperty({ example: 7, description: 'Bookings, drafts excluded.' }) bookings!: number;
  @ApiProperty({ enum: VerificationStatus, example: VerificationStatus.VERIFIED })
  verification!: VerificationStatus;
  @ApiProperty({ example: 'Verified', description: 'Verified, Pending, Unverified.' })
  verificationLabel!: string;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'], example: 'ACTIVE' }) status!: string;
  @ApiProperty({ example: 'Active' }) statusLabel!: string;
  @ApiProperty({ example: '2026-04-12T10:00:00.000Z' }) joinedAt!: string;
}

export class CustomerDocumentResponse {
  @ApiPropertyOptional({ nullable: true, example: 'BUSINESS_LICENSE' }) type!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Business License' }) typeLabel!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'license.pdf' }) fileName!: string | null;
  @ApiProperty({ example: '/api/v1/files/customers/…/license.pdf' }) url!: string;
  @ApiPropertyOptional({ nullable: true, example: '2026-04-20T12:00:00.000Z' }) uploadedAt!:
    string | null;
}

export class CustomerActiveBookingResponse {
  @ApiProperty({ example: 'ESK-10484' }) reference!: string;
  @ApiProperty({ enum: ['EQUIPMENT', 'TALENT'] }) type!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) itemName!: string;
  @ApiProperty({ example: 'AWAITING_PAYMENT' }) status!: string;
  @ApiProperty({ example: 'Awaiting Payment' }) statusLabel!: string;
  @ApiProperty({ example: '2026-10-01' }) startDate!: string;
  @ApiProperty({ example: '2026-10-03' }) endDate!: string;
  @ApiProperty({ example: 1_085_000 }) totalMinor!: number;
}

export class CustomerPastBookingResponse {
  @ApiProperty({ example: 'ESK-10486' }) reference!: string;
  @ApiProperty({ example: 'Aputure 600d' }) itemName!: string;
  @ApiProperty({ example: 'CLOSED' }) status!: string;
  @ApiProperty({ example: '2026-08-18' }) startDate!: string;
}

export class CustomerDetailResponse extends CustomerRowResponse {
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'], example: 'COMPANY' }) kind!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251922334455' }) additionalPhone!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Bole, Atlas area' }) address!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '0001234567' }) tinNumber!: string | null;
  @ApiProperty({ example: false }) vatExempt!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'yoseph_a' }) telegramUsername!: string | null;
  @ApiPropertyOptional({
    type: CustomerDocumentResponse,
    nullable: true,
    description: 'The verification document.',
  })
  document!: CustomerDocumentResponse | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-05-01T08:00:00.000Z' }) verifiedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Abel Tesfaye' }) verifiedBy!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'ID photo is blurred; please re-upload.' })
  verificationRejection!: string | null;
  @ApiProperty({ example: 4_200_000, description: 'Verified payments, all time.' })
  totalSpendMinor!: number;
  @ApiProperty({ example: 5 }) completedBookings!: number;
  @ApiProperty({ example: 1, description: 'Issues ever reported on their bookings.' })
  incidents!: number;
  @ApiProperty({ type: [CustomerActiveBookingResponse], description: 'Open Booking File.' })
  activeBookings!: CustomerActiveBookingResponse[];
  @ApiProperty({
    type: [CustomerPastBookingResponse],
    description: 'The last ten finished bookings.',
  })
  pastBookings!: CustomerPastBookingResponse[];
  @ApiPropertyOptional({ nullable: true, example: '2026-09-15T16:00:00.000Z' }) blockedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Repeated late returns and unresponsive.' })
  blockedReason!: string | null;
}
