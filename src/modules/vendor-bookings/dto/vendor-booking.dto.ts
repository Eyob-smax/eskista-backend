import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import {
  BookingStatus,
  CollectionMethod,
  HandoverCondition,
  SettlementStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery, SortQuery } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The vendor Bookings screen tabs: Pending · Upcoming · Active · Completed. */
export const BOOKING_TABS = ['pending', 'upcoming', 'active', 'completed', 'all'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

export class VendorBookingListQuery extends IntersectionType(PaginationQuery, SortQuery) {
  @ApiPropertyOptional({ enum: BOOKING_TABS, default: 'all' })
  @IsOptional()
  @IsIn(BOOKING_TABS)
  tab: BookingTab = 'all';
}

// ─────────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────────

export class DeclineBookingDto {
  @ApiProperty({
    description: 'Shown to Eskista, not the customer. Required so declines are auditable.',
    example: 'Camera is in for sensor cleaning that week.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class AcceptBookingDto {
  @ApiPropertyOptional({ description: 'Optional note for the Eskista team.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ChecklistTickDto {
  @ApiProperty({ example: 'tested', description: 'The `key` of a checklist item.' })
  @IsString()
  @MaxLength(60)
  key!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  done!: boolean;
}

export class UpdatePreparationDto {
  @ApiPropertyOptional({
    type: [ChecklistTickDto],
    description: 'Items to tick or untick. Items not sent keep their state.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChecklistTickDto)
  checklist?: ChecklistTickDto[];

  @ApiPropertyOptional({
    enum: HandoverCondition,
    description: '"Equipment condition": Excellent · Good · Fair · Needs Attention.',
  })
  @IsOptional()
  @IsEnum(HandoverCondition)
  condition?: HandoverCondition;
}

export class HandoverMethodDto {
  @ApiProperty({
    enum: CollectionMethod,
    description:
      '`DELIVERY` — the vendor brings the equipment to `address`. `PICKUP` — Eskista ' +
      'collects it and calls `contactPhone` to arrange it.',
  })
  @IsEnum(CollectionMethod)
  method!: CollectionMethod;

  @ApiPropertyOptional({
    example: 'Bole, Addis Ababa',
    description: 'Required for DELIVERY. Defaults to the booking’s delivery address.',
  })
  @ValidateIf((o: HandoverMethodDto) => o.method === CollectionMethod.DELIVERY)
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trim)
  address?: string;

  @ApiPropertyOptional({
    example: '+251912345678',
    description: 'Required for PICKUP: "We will use this to confirm your Pickup from Eskista."',
  })
  @ValidateIf((o: HandoverMethodDto) => o.method === CollectionMethod.PICKUP)
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Transform(trim)
  contactPhone?: string;
}

export class ConfirmReceiptDto {
  @ApiProperty({
    description: '`true` — Confirm. `false` — Not-Confirmed: Eskista is alerted and follows up.',
  })
  @IsBoolean()
  confirmed!: boolean;

  @ApiPropertyOptional({ description: 'What is wrong, when not confirming.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Responses
// ─────────────────────────────────────────────────────────────────────────────

export class BadgeResponse {
  @ApiProperty({ example: 'Pending' }) label!: string;
  @ApiProperty({ enum: ['WARNING', 'INFO', 'SUCCESS', 'DANGER', 'NEUTRAL'] }) tone!: string;
}

export class VendorBookingSummaryResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ type: BadgeResponse }) badge!: BadgeResponse;
  @ApiProperty({ description: 'PENDING | ACCEPTED | DECLINED' }) supplierResponse!: string;
  @ApiProperty({ example: 'Canon EOS R5' }) productName!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Digital Cinema' })
  productCategory!: string | null;
  @ApiPropertyOptional({ nullable: true }) productImageUrl!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'The client’s organisation, as on Upcoming Rentals ("Habesha Films"). Never their ' +
      'contact details — all communication goes through Eskista.',
    example: 'Habesha Films',
  })
  customerOrganisation!: string | null;
  @ApiProperty({ example: '2026-08-28' }) startDate!: string;
  @ApiProperty({ example: '2026-08-31' }) endDate!: string;
  @ApiProperty({ description: '"Total Days".', example: 3 }) periods!: number;
  @ApiProperty({ example: 1 }) quantity!: number;
  @ApiPropertyOptional({ nullable: true, enum: CollectionMethod })
  collectionMethod!: CollectionMethod | null;
  @ApiPropertyOptional({ nullable: true, example: 'Bole, Addis Ababa' }) location!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '"Purpose".' })
  projectDescription!: string | null;
  @ApiProperty({ description: '"Your earnings" — exactly what the vendor listed.' })
  earningsMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() createdAt!: string;
}

export class VendorTimelineStepResponse {
  @ApiProperty({ example: 'HANDOVER' }) key!: string;
  @ApiProperty({ example: 'Handover' }) label!: string;
  @ApiProperty({ enum: ['DONE', 'IN_PROGRESS', 'PENDING'] }) state!: string;
}

export class VendorActionResponse {
  @ApiProperty({ example: 'CONFIRM_HANDOVER' }) key!: string;
  @ApiProperty({ example: 'Confirm Handover' }) label!: string;
  @ApiProperty() primary!: boolean;
  @ApiProperty() enabled!: boolean;
  @ApiPropertyOptional({ nullable: true }) disabledReason!: string | null;
}

export class NextStepResponse {
  @ApiProperty({ example: 'Prepare the equipment' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: '2026-08-27' }) dueDate!: string | null;
  @ApiProperty({ example: 'Your next step: Prepare the equipment before Aug 27.' })
  message!: string;
}

export class VendorMoneyResponse {
  @ApiProperty({
    description:
      '"Gross rental": the rental before VAT — your earnings plus Eskista’s commission. ' +
      'Eskista adds its commission on top of your price, so you are paid your price in full.',
    example: 1035000,
  })
  grossRentalMinor!: number;
  @ApiProperty({ description: '"Eskista commission", shown negative.' }) commissionMinor!: number;
  @ApiProperty() commissionRateBps!: number;
  @ApiProperty({ description: '"Your estimated earnings".' }) earningsMinor!: number;
  @ApiProperty({ description: '"Rented Item Quantity".' }) quantity!: number;
  @ApiProperty({ description: '"Estimated total" — what the client pays, VAT included.' })
  customerTotalMinor!: number;
  @ApiProperty({ example: 'Payment is managed by Eskista.' }) note!: string;
  @ApiProperty() currency!: string;
}

export class ChecklistItemResponse {
  @ApiProperty({ example: 'tested' }) key!: string;
  @ApiProperty({ example: 'Equipment tested' }) label!: string;
  @ApiProperty() done!: boolean;
}

export class HandoverPhotoResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() fileName!: string;
}

export class PreparationResponse {
  @ApiProperty({ type: [ChecklistItemResponse] }) checklist!: ChecklistItemResponse[];
  @ApiProperty({ description: '"2/7".', example: 2 }) doneCount!: number;
  @ApiProperty({ example: 7 }) totalCount!: number;
  @ApiPropertyOptional({ enum: HandoverCondition, nullable: true })
  condition!: HandoverCondition | null;
  @ApiProperty({ type: [HandoverPhotoResponse] }) photos!: HandoverPhotoResponse[];
  @ApiPropertyOptional({ nullable: true }) preparedAt!: string | null;
  @ApiProperty({ description: 'Mark as Ready is available.' }) canMarkReady!: boolean;
  @ApiProperty({ type: [String], description: 'What still blocks Mark as Ready.' })
  blockers!: string[];
}

export class HandoverResponse {
  @ApiPropertyOptional({ enum: CollectionMethod, nullable: true })
  method!: CollectionMethod | null;
  @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @ApiPropertyOptional({ nullable: true }) contactPhone!: string | null;
  @ApiPropertyOptional({ nullable: true }) handedOverAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) returnConfirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) returnDisputedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) payoutConfirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) payoutDisputedAt!: string | null;
}

export class InspectionRowResponse {
  @ApiProperty({ example: 'Physical condition' }) label!: string;
  @ApiProperty({ example: 'Passed' }) value!: string;
  @ApiProperty({ enum: ['GOOD', 'BAD'] }) tone!: string;
}

export class VendorInspectionResponse {
  @ApiProperty({ type: [String], description: 'Inspection photos.' }) photoUrls!: string[];
  @ApiProperty({
    type: [InspectionRowResponse],
    description:
      'Physical condition · Functional test · Missing accessories · Damage · Inspection result.',
  })
  rows!: InspectionRowResponse[];
  @ApiPropertyOptional({ nullable: true, example: 'Excellent' }) overallCondition!: string | null;
  @ApiProperty({
    example:
      'The inspector has declared that this record is accurate and complete. All findings are ' +
      'final and submitted to Eskista for review.',
  })
  declaration!: string;
  @ApiProperty({ description: 'Withheld for damage or late return.' }) deductionMinor!: number;
  @ApiProperty() inspectedAt!: string;
}

export class EquipmentUnitRefResponse {
  @ApiPropertyOptional({ nullable: true }) label!: string | null;
  @ApiPropertyOptional({ nullable: true }) serialNumber!: string | null;
}

export class EquipmentReturnResponse {
  @ApiPropertyOptional({ nullable: true }) scheduledAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) method!: string | null;
  @ApiPropertyOptional({ nullable: true }) receivedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) confirmedByYouAt!: string | null;
}

export class VendorPaymentDetailsResponse {
  @ApiPropertyOptional({
    nullable: true,
    example: 'Bank Transfer',
    description: 'How the client paid Eskista.',
  })
  paymentMethod!: string | null;
  @ApiProperty({ example: 'Released on return' }) depositHeld!: string;
  @ApiPropertyOptional({ enum: SettlementStatus, nullable: true })
  settlementStatus!: SettlementStatus | null;
  @ApiPropertyOptional({ nullable: true, example: 'Paid' }) settlementStatusLabel!: string | null;
  @ApiPropertyOptional({ nullable: true }) settlementDate!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Approved' }) approvalStatus!: string | null;
  @ApiPropertyOptional({ nullable: true }) payoutReference!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Telebirr •••• 3344',
    description: 'Where Eskista sent it.',
  })
  paidTo!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Settlement paid on Aug 24, 2026 via Bank Transfer',
  })
  note!: string | null;
}

export class VendorDocumentLinkResponse {
  @ApiProperty({ enum: ['RENTAL_AGREEMENT', 'PAYMENT_EVIDENCE', 'SETTLEMENT_RECORD'] })
  kind!: string;
  @ApiProperty({ example: 'Settlement Record' }) label!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ example: 'PDF' }) format!: string;
}

export class VendorActivityResponse {
  @ApiProperty() toStatus!: string;
  @ApiPropertyOptional({ nullable: true }) actorRole!: string | null;
  @ApiProperty() createdAt!: string;
}

export class VendorBookingDetailResponse extends VendorBookingSummaryResponse {
  @ApiProperty({
    description: '"Vendor" row on the request summary.',
    example: 'Ethiopian Visuals',
  })
  vendorName!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Company' })
  customerOrganisationType!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '"Delivery To".' })
  deliveryAddress!: string | null;
  @ApiPropertyOptional({ nullable: true }) dueAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) supplierDeclineReason!: string | null;

  @ApiProperty({ type: VendorMoneyResponse }) money!: VendorMoneyResponse;
  @ApiProperty({ type: [VendorTimelineStepResponse], description: 'The ten-step tracker.' })
  timeline!: VendorTimelineStepResponse[];
  @ApiProperty({ type: [VendorActionResponse] }) actions!: VendorActionResponse[];
  @ApiPropertyOptional({ type: NextStepResponse, nullable: true })
  nextStep!: NextStepResponse | null;

  @ApiProperty({ type: PreparationResponse }) preparation!: PreparationResponse;
  @ApiProperty({ type: HandoverResponse }) handover!: HandoverResponse;
  @ApiProperty({ type: [EquipmentUnitRefResponse], description: '"Equipment Identification".' })
  equipmentIdentification!: EquipmentUnitRefResponse[];
  @ApiPropertyOptional({ type: VendorInspectionResponse, nullable: true })
  inspection!: VendorInspectionResponse | null;
  @ApiProperty({ type: EquipmentReturnResponse }) equipmentReturn!: EquipmentReturnResponse;
  @ApiProperty({ type: VendorPaymentDetailsResponse }) payment!: VendorPaymentDetailsResponse;
  @ApiProperty({ type: [VendorDocumentLinkResponse], description: '"Documents & Records".' })
  documents!: VendorDocumentLinkResponse[];

  @ApiProperty({
    example:
      'Client contact details are not shared with vendors. All communication goes through Eskista.',
  })
  privacyNote!: string;
  @ApiProperty({ example: '+251966554411' }) supportPhone!: string;
  @ApiProperty({ type: [VendorActivityResponse] }) activity!: VendorActivityResponse[];
}

export class TrackingStepResponse {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['DONE', 'IN_PROGRESS', 'PENDING'] }) state!: string;
}

export class VendorTrackingResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ enum: ['OUTBOUND', 'RETURN'] }) direction!: 'OUTBOUND' | 'RETURN';
  @ApiProperty({ example: 'Out for Delivery' }) stageLabel!: string;
  @ApiProperty({ example: 'Your equipment is on the way.' }) headline!: string;
  @ApiPropertyOptional({ nullable: true }) etaAt!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Dawit Bekele' }) courierName!: string | null;
  @ApiPropertyOptional({ nullable: true }) courierPhone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Motorbike · AA 3-1024' })
  vehicle!: string | null;
  @ApiProperty({ example: 'Sigma 24-70mm f/2.8 Art' }) productName!: string;
  @ApiProperty({ type: [TrackingStepResponse] }) steps!: TrackingStepResponse[];
  @ApiProperty({ example: 'Only the admin will be updating this status.' }) note!: string;
  @ApiProperty({
    description:
      'Confirm Delivery is available: the equipment has come back and is waiting for you to ' +
      'confirm you have it.',
  })
  canConfirmReceipt!: boolean;
}

export class CompletionResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ example: 'Payment Received!' }) title!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ type: VendorBookingDetailResponse }) booking!: VendorBookingDetailResponse;
}

// ── Earnings ─────────────────────────────────────────────────────────────────

export class VendorEarningsSummaryResponse {
  @ApiProperty({ description: 'Lifetime paid earnings, in minor units.' })
  totalRevenueMinor!: number;
  @ApiProperty() todayEarningsMinor!: number;
  @ApiProperty({ description: 'Approved but not yet paid.' }) upcomingMinor!: number;
  @ApiProperty() currency!: string;
}

export const EARNINGS_TABS = ['overview', 'upcoming', 'completed'] as const;

export class VendorEarningsQuery {
  @ApiPropertyOptional({ enum: EARNINGS_TABS, default: 'overview' })
  @IsOptional()
  @IsIn(EARNINGS_TABS)
  tab?: (typeof EARNINGS_TABS)[number];
}

export class VendorEarningItemResponse {
  @ApiProperty({ example: 'ESK-10482' }) reference!: string;
  @ApiProperty({ example: 'Aputure LS 600d Pro' }) productName!: string;
  @ApiPropertyOptional({ nullable: true }) productImageUrl!: string | null;
  @ApiProperty({ example: '2026-08-24', description: 'Paid date, or the expected date.' })
  date!: string;
  @ApiProperty({ example: 'ESK-10482 · Aug 24, 2026' }) subtitle!: string;
  @ApiProperty() earningsMinor!: number;
  @ApiProperty({ enum: ['PAID', 'PENDING'] }) status!: 'PAID' | 'PENDING';
}

export class VendorEarningsResponse extends VendorEarningsSummaryResponse {
  @ApiProperty({ type: [VendorEarningItemResponse] }) items!: VendorEarningItemResponse[];
}

export class VendorSettlementResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'ESK-10482' }) bookingReference!: string;
  @ApiProperty() productName!: string;
  @ApiPropertyOptional({ nullable: true }) productImageUrl!: string | null;
  @ApiProperty() grossMinor!: number;
  @ApiProperty() commissionMinor!: number;
  @ApiProperty({ description: 'Withheld for damage or late return.' }) deductionMinor!: number;
  @ApiProperty() netMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: SettlementStatus }) status!: SettlementStatus;
  @ApiPropertyOptional({ nullable: true }) expectedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Set when this line was rolled into a multi-booking payout.',
  })
  batchReference!: string | null;
}

export class VendorSettlementListQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}
