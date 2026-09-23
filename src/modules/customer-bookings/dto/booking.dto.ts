import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingStatus,
  BookingType,
  CollectionMethod,
  DeliveryStage,
  PaymentStatus,
  ProjectType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CursorPaginationQuery } from '../../../common/dto/pagination.dto';
import { BOOKING_TABS, type BookingTab } from '../booking-view';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListBookingsQuery extends CursorPaginationQuery {
  @ApiPropertyOptional({
    enum: BOOKING_TABS,
    default: 'upcoming',
    description: `
Which tab of **My Bookings** to return.

- \`upcoming\` — requested, approved or confirmed, but the rental has not started.
- \`active\` — the customer physically holds the equipment, or the engagement is running.
- \`completed\` — finished, cancelled, rejected or expired. All of them, so nothing vanishes.
- \`drafts\` — saved but never submitted. Not a tab in the designs, but "Save Draft" has to
  lead somewhere retrievable.
`.trim(),
  })
  @IsOptional()
  @IsIn(BOOKING_TABS)
  tab: BookingTab = 'upcoming';

  @ApiPropertyOptional({
    enum: BookingType,
    description: 'Omit to get equipment and talent together, as the designs show them.',
  })
  @IsOptional()
  @IsIn(Object.values(BookingType))
  type?: BookingType;
}

export class TimelineStepResponse {
  @ApiProperty({ example: 'UNDER_REVIEW', description: 'Stable key. Do not display it.' })
  key!: string;

  @ApiProperty({ example: 'Under Review', description: 'Display this.' })
  label!: string;

  @ApiProperty({
    enum: ['DONE', 'IN_PROGRESS', 'PENDING'],
    description: 'Filled tick, hollow ring with a label, or grey dot.',
    example: 'IN_PROGRESS',
  })
  state!: 'DONE' | 'IN_PROGRESS' | 'PENDING';

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the booking entered this step. Null if it was skipped or not reached.',
    example: '2026-08-15T11:20:00.000Z',
  })
  occurredAt!: string | null;
}

export class BookingActionResponse {
  @ApiProperty({ example: 'COMPLETE_PAYMENT', description: 'Stable key to branch on.' })
  key!: string;

  @ApiProperty({ example: 'Complete Payment', description: 'Button text, ready to render.' })
  label!: string;

  @ApiProperty({ description: 'At most one action per booking is primary.', example: true })
  primary!: boolean;

  @ApiProperty({
    description: 'False renders the button greyed out rather than hidden.',
    example: true,
  })
  enabled!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why it is disabled. Safe to show the customer verbatim.',
    example: 'Eskista is verifying your payment.',
  })
  disabledReason!: string | null;
}

export class MoneyLineResponse {
  @ApiProperty({ example: 'Rental (3d)' })
  label!: string;

  @ApiProperty({ example: 1050000, description: 'Minor units (ETB cents).' })
  amountMinor!: number;
}

export class BookingTotalsResponse {
  @ApiProperty({ example: 'ETB' })
  currency!: string;

  @ApiProperty({
    type: [MoneyLineResponse],
    description:
      'Print in order; zero lines omitted. They sum exactly to `totalMinor`, because VAT ' +
      'is already inside each one rather than added after — there is no VAT line.',
  })
  lines!: MoneyLineResponse[];

  @ApiProperty({ example: 1050000 })
  subtotalMinor!: number;

  @ApiProperty({ example: 50000 })
  deliveryFeeMinor!: number;

  @ApiProperty({ example: 0 })
  discountMinor!: number;

  @ApiProperty({
    example: 143478,
    description:
      'The VAT **already contained** in `totalMinor`. Never add it to the total — all ' +
      'platform prices are VAT-inclusive.',
  })
  taxMinor!: number;

  @ApiProperty({ example: 1500, description: 'Rate actually charged, in basis points.' })
  taxRateBps!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ready-made subtext for the VAT badge. Null for an exempt customer.',
    example: 'Inc. 15% VAT',
  })
  taxNote!: string | null;

  @ApiProperty({
    example: 956522,
    description: '`totalMinor` less the VAT inside it. For accounting, not for display.',
  })
  netTotalMinor!: number;

  @ApiProperty({ example: 0 })
  serviceFeeMinor!: number;

  @ApiProperty({
    example: 400000,
    description: 'Refundable on satisfactory return. Never taxed, never in `totalMinor`.',
  })
  securityDepositMinor!: number;

  @ApiProperty({
    example: 1100000,
    description:
      'What the customer owes for the goods and services, VAT included. Excludes the ' +
      'refundable deposit.',
  })
  totalMinor!: number;

  @ApiProperty({
    example: 1500000,
    description:
      '`totalMinor` plus the refundable deposit — what the customer actually transfers. ' +
      'Use this on the payment screen and nowhere else.',
  })
  amountDueMinor!: number;
}

export class BookingSubjectResponse {
  @ApiProperty({
    enum: BookingType,
    description: 'Which of the two shapes the rest of the payload takes.',
  })
  type!: BookingType;

  @ApiProperty({ format: 'uuid', description: 'Listing id, or talent profile id.' })
  id!: string;

  @ApiProperty({ example: 'Sony FX3 Cinema Camera' })
  name!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Vendor business name for equipment; null for talent.',
    example: 'Ethiopian Visuals',
  })
  supplierName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ example: 320000, description: 'Rate at the time of booking, snapshotted.' })
  unitPriceMinor!: number;
}

export class BookingCardResponse {
  @ApiProperty({ example: 'ESK-10482', description: 'Use this in every URL. Never the uuid.' })
  reference!: string;

  @ApiProperty({ enum: BookingType })
  type!: BookingType;

  @ApiProperty({ enum: BookingStatus })
  status!: BookingStatus;

  @ApiProperty({
    description: 'The coloured chip. `tone` is one of NEUTRAL, INFO, SUCCESS, WARNING, DANGER.',
    example: { label: 'Active', tone: 'SUCCESS' },
  })
  badge!: { label: string; tone: string };

  @ApiProperty({ type: BookingSubjectResponse })
  subject!: BookingSubjectResponse;

  @ApiProperty({ example: '2026-08-18' })
  startDate!: string;

  @ApiProperty({ example: '2026-08-21' })
  endDate!: string;

  @ApiProperty({ example: 3 })
  periods!: number;

  @ApiProperty({ example: 'ETB' })
  currency!: string;

  @ApiProperty({ example: 1257500, description: 'Excludes the deposit. See BookingTotals.' })
  totalMinor!: number;

  @ApiProperty({ example: 1657500, description: 'Includes the deposit.' })
  amountDueMinor!: number;

  @ApiProperty({
    type: [BookingActionResponse],
    description: 'Render the one with `primary: true` as the filled button.',
  })
  actions!: BookingActionResponse[];

  @ApiProperty({ example: '2026-08-14T09:05:00.000Z' })
  createdAt!: string;
}

export class BookingFulfilmentResponse {
  @ApiProperty({ enum: CollectionMethod, example: CollectionMethod.DELIVERY })
  method!: CollectionMethod;

  @ApiPropertyOptional({ nullable: true, example: 'Bole, Addis Ababa' })
  address!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-18T15:41:00.000Z' })
  scheduledAt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Dawit Bekele' })
  courierName!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The courier’s number. The vendor’s is never exposed — Eskista mediates.',
    example: '+251911223344',
  })
  courierPhone!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Motorbike' })
  vehicleDescription!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'AA 3-1024' })
  vehiclePlate!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Estimated arrival — "Today, 3:45 PM".',
    example: '2026-08-18T15:45:00.000Z',
  })
  etaAt!: string | null;

  @ApiProperty({ enum: DeliveryStage, description: 'Drives the four-step delivery sub-tracker.' })
  stage!: DeliveryStage;

  @ApiProperty({ type: [TimelineStepResponse], description: 'The delivery sub-tracker itself.' })
  timeline!: TimelineStepResponse[];

  @ApiPropertyOptional({ nullable: true, example: '2026-08-21T18:00:00.000Z' })
  completedAt!: string | null;
}

export class BookingPaymentResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty({ example: 'TBR-8842190XZ' })
  transactionReference!: string;

  @ApiProperty({ example: 1657500 })
  amountMinor!: number;

  @ApiProperty({ example: 'TELEBIRR' })
  method!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Authorised download URL for the receipt. Parties and Eskista only.',
  })
  receiptUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Set when Eskista rejected the payment.' })
  rejectionReason!: string | null;

  @ApiProperty({ example: '2026-08-16T14:15:00.000Z' })
  submittedAt!: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-17T10:30:00.000Z' })
  verifiedAt!: string | null;
}

export class BookingDocumentResponse {
  @ApiProperty({
    enum: ['RENTAL_AGREEMENT', 'PAYMENT_EVIDENCE', 'SETTLEMENT_RECORD'],
    example: 'RENTAL_AGREEMENT',
  })
  kind!: string;

  @ApiProperty({ example: 'Rental Agreement' })
  label!: string;

  @ApiProperty({
    description: 'Authorised download URL. Only documents that exist are listed.',
    example: '/api/v1/files/bookings/ESK-10482/agreements/agreement.md',
  })
  url!: string;

  @ApiProperty({ example: 'PDF', description: 'Format hint for the row icon.' })
  format!: string;
}

export class BookingInspectionResponse {
  @ApiPropertyOptional({ nullable: true, example: 'Good' })
  physicalCondition!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Passed' })
  functionalTest!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'None' })
  missingAccessories!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'None' })
  damage!: string | null;

  @ApiPropertyOptional({ nullable: true, enum: ['OK', 'DAMAGED', 'MISSING_ITEMS', 'LATE_RETURN'] })
  outcome!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-22T09:00:00.000Z' })
  completedAt!: string | null;

  @ApiProperty({
    description:
      'False until the equipment is back with Eskista. Render every row as a dash while ' +
      'this is false, as the design does.',
    example: false,
  })
  isComplete!: boolean;
}

export class ActivityEntryResponse {
  @ApiProperty({ example: 'Equipment delivered to customer' })
  message!: string;

  @ApiProperty({
    description: 'Who did it, already in display form.',
    enum: ['Eskista', 'Customer', 'Eskista Courier', 'Vendor'],
    example: 'Eskista Courier',
  })
  actor!: string;

  @ApiProperty({ example: '2026-08-18T15:41:00.000Z' })
  occurredAt!: string;
}

export class BookingDetailResponse extends BookingCardResponse {
  @ApiPropertyOptional({
    nullable: true,
    enum: ProjectType,
    description: 'Chosen from chips on a talent request; null on equipment requests.',
  })
  projectType!: ProjectType | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Commercial video for Habesha Beer',
    description: 'Free-text purpose. The "Project / Purpose" field.',
  })
  projectDescription!: string | null;

  @ApiProperty({ example: 1, description: 'Units booked.' })
  quantity!: number;

  @ApiProperty({
    type: [String],
    description: 'Serial / asset IDs of the exact units assigned. Empty until assigned.',
    example: ['SNY-FX3-0023884'],
  })
  assignedSerials!: string[];

  @ApiProperty({ example: '+251911234567' })
  contactPhone!: string;

  @ApiPropertyOptional({ nullable: true })
  additionalPhone!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Return deadline, carrying a time — "Aug 21, 6:00 PM".',
    example: '2026-08-21T18:00:00.000Z',
  })
  dueAt!: string | null;

  @ApiProperty({ type: BookingTotalsResponse })
  totals!: BookingTotalsResponse;

  @ApiProperty({
    type: [TimelineStepResponse],
    description: '8 steps for equipment, 6 for talent.',
  })
  timeline!: TimelineStepResponse[];

  @ApiPropertyOptional({ type: BookingFulfilmentResponse, nullable: true })
  delivery!: BookingFulfilmentResponse | null;

  @ApiPropertyOptional({ type: BookingFulfilmentResponse, nullable: true })
  return!: BookingFulfilmentResponse | null;

  @ApiProperty({ type: [BookingPaymentResponse], description: 'Newest first.' })
  payments!: BookingPaymentResponse[];

  @ApiPropertyOptional({ type: BookingInspectionResponse, nullable: true })
  inspection!: BookingInspectionResponse | null;

  @ApiProperty({ type: [BookingDocumentResponse] })
  documents!: BookingDocumentResponse[];

  @ApiProperty({ type: [ActivityEntryResponse], description: 'Newest first.' })
  activity!: ActivityEntryResponse[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reference of the agreement awaiting signature, if one is.',
    example: 'ESK-AGR-00031',
  })
  pendingAgreementReference!: string | null;

  @ApiProperty({
    description: 'Eskista’s support number, for the "Contact Eskista" button.',
    example: '+251966554411',
  })
  supportPhone!: string;
}

export class CancelBookingDto {
  @ApiPropertyOptional({
    description: 'Why the customer is cancelling. Recorded on the status event.',
    example: 'Shoot postponed by the client.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  reason?: string;
}

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Great gear, delivered on time.', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  comment?: string;
}
