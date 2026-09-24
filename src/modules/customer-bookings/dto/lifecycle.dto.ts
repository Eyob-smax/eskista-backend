import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgreementStatus,
  AgreementType,
  IncidentPhase,
  IncidentStatus,
  IncidentType,
  PaymentMethod,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// ─────────────────────────────────────────────────────────────────────────────
// Agreements
// ─────────────────────────────────────────────────────────────────────────────

export class CustomerAgreementResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: AgreementType, example: AgreementType.EQUIPMENT_RENTAL })
  kind!: AgreementType;

  @ApiProperty({
    enum: AgreementStatus,
    description:
      'The lifecycle is `AWAITING_UPLOAD → UNDER_REVIEW → APPROVED`, with `REJECTED` ' +
      'sending it back a step. Render these as the status tag on the agreement card.',
    example: AgreementStatus.AWAITING_UPLOAD,
  })
  status!: AgreementStatus;

  @ApiProperty({
    description: 'Ready-made tag text for the status pill.',
    example: 'Awaiting Upload',
  })
  statusLabel!: string;

  @ApiProperty({ example: 'ESK-10482', description: 'The booking this covers.' })
  bookingReference!: string;

  @ApiProperty({ example: 1, description: 'Template version this was rendered from.' })
  version!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'SHA-256 of the exact bytes issued. Proves what was agreed.',
    example: 'sha256:9f2b…',
  })
  contentHash!: string | null;

  @ApiProperty({
    description: 'Always "Ethiopian Law" — shown in the agreement header.',
    example: 'Ethiopian Law',
  })
  governedBy!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Download this, print it, sign it. The blank contract.',
    example: '/api/v1/files/bookings/ESK-10482/agreements/agreement.md',
  })
  documentUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The scan the customer uploaded, once there is one.',
  })
  signedCopyUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Selam Tesfaye' })
  signerName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-16T10:00:00.000Z' })
  sentAt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-17T09:12:00.000Z' })
  uploadedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-17T14:00:00.000Z' })
  reviewedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why Eskista rejected the scan. Safe to show verbatim.',
    example: 'The signature page was missing.',
  })
  rejectionReason!: string | null;

  @ApiProperty({
    description:
      'True while the next move is the customer’s — awaiting a first upload, or a ' +
      'replacement after rejection.',
    example: true,
  })
  awaitingCustomer!: boolean;
}

export class CustomerAgreementBodyResponse extends CustomerAgreementResponse {
  @ApiProperty({
    description:
      'The rendered contract text, exactly as frozen when issued. Display this — ' +
      're-rendering from the template would not match `contentHash`.',
  })
  body!: string;
}

export class UploadSignedCopyDto {
  @ApiProperty({
    description: 'Who physically signed the printed contract.',
    example: 'Selam Tesfaye',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(trim)
  signerName!: string;

  @ApiPropertyOptional({ example: '+251911234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(trim)
  signerPhone?: string;
}

export class DeclineAgreementDto {
  @ApiProperty({
    description: 'Why the customer will not sign. Recorded and shown to Eskista.',
    example: 'The rental dates no longer work for our shoot.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────

export class TelebirrInstructionsResponse {
  @ApiProperty({ example: '0911234567' })
  number!: string;

  @ApiProperty({ example: 'Eskista Equipment Rentals' })
  accountName!: string;
}

export class BankInstructionsResponse {
  @ApiProperty({ example: 'CBE' })
  bank!: string;

  @ApiProperty({ example: 'Eskista Marketplace PLC' })
  accountName!: string;

  @ApiProperty({ example: '1000234567890 1' })
  accountNumber!: string;
}

export class PaymentInstructionsResponse {
  @ApiProperty({ example: 'ESK-10482' })
  bookingReference!: string;

  @ApiProperty({ example: 'Sony FX3 Cinema Camera' })
  itemName!: string;

  @ApiProperty({ example: '2026-08-18' })
  startDate!: string;

  @ApiProperty({ example: '2026-08-21' })
  endDate!: string;

  @ApiProperty({ example: 'ETB' })
  currency!: string;

  @ApiProperty({
    example: 1500000,
    description:
      'Transfer exactly this. It is `totalMinor` plus the refundable deposit — the ' +
      'figure the Complete Payment screen shows, not the smaller goods-only total.',
  })
  amountDueMinor!: number;

  @ApiProperty({
    example: 0,
    description: 'Already verified against this booking. Subtract before showing a balance.',
  })
  amountPaidMinor!: number;

  @ApiPropertyOptional({
    type: TelebirrInstructionsResponse,
    nullable: true,
    description: 'Null when Eskista has not configured a Telebirr account.',
  })
  telebirr!: TelebirrInstructionsResponse | null;

  @ApiPropertyOptional({ type: BankInstructionsResponse, nullable: true })
  bank!: BankInstructionsResponse | null;

  @ApiProperty({
    description: 'False while an earlier submission is still being verified.',
    example: true,
  })
  canSubmit!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why submission is blocked, safe to show the customer.',
    example: 'Eskista is verifying your previous payment.',
  })
  blockedReason!: string | null;
}

export class SubmitPaymentDto {
  @ApiProperty({
    enum: PaymentMethod,
    description: 'How the transfer was made. CASH is recorded by Eskista, not here.',
    example: PaymentMethod.TELEBIRR,
  })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({
    description:
      'The reference printed on the Telebirr or bank confirmation. Eskista matches the ' +
      'transfer on this, so a typo delays verification.',
    example: 'TBR8842190XZ',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Transform(trim)
  transactionReference!: string;

  @ApiProperty({
    description: 'What was actually transferred, in minor units (ETB cents).',
    example: 1500000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor!: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Return scheduling
// ─────────────────────────────────────────────────────────────────────────────

export class ReturnSlotResponse {
  @ApiProperty({ example: '2026-08-21T09:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ example: 'Aug 21 · 09:00 AM', description: 'Pre-formatted for the picker.' })
  label!: string;

  @ApiProperty({
    description: 'False for a slot after the return deadline. Show it, but disabled.',
    example: true,
  })
  available!: boolean;
}

export class ReturnOptionsResponse {
  @ApiProperty({ example: 'ESK-10482' })
  bookingReference!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Return deadline, carrying a time — "Aug 21, 6:00 PM".',
    example: '2026-08-21T18:00:00.000Z',
  })
  dueAt!: string | null;

  @ApiProperty({ type: [ReturnSlotResponse] })
  slots!: ReturnSlotResponse[];

  @ApiProperty({
    type: [String],
    description: 'The "Return instructions" list, from platform settings.',
    example: [
      'Pack all included items and accessories.',
      'Ensure batteries and memory cards are returned.',
      'Equipment will be inspected on receipt.',
    ],
  })
  instructions!: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'The delivery address, offered as the default pickup address.',
    example: 'Bole, Addis Ababa',
  })
  suggestedAddress!: string | null;
}

export class ScheduleReturnDto {
  @ApiProperty({
    enum: ['SCHEDULED_PICKUP', 'DROP_OFF'],
    description:
      '`SCHEDULED_PICKUP` — Eskista collects. `DROP_OFF` — the customer returns it ' +
      'themselves. These are the two buttons on the Return Equipment screen.',
    example: 'SCHEDULED_PICKUP',
  })
  @IsEnum({ SCHEDULED_PICKUP: 'SCHEDULED_PICKUP', DROP_OFF: 'DROP_OFF' })
  method!: 'SCHEDULED_PICKUP' | 'DROP_OFF';

  @ApiProperty({
    description: 'One of the `startsAt` values from `GET /return-slots`.',
    example: '2026-08-21T09:00:00.000Z',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, { message: 'scheduledAt must be an ISO date-time' })
  scheduledAt!: string;

  @ApiPropertyOptional({
    description: 'Required for SCHEDULED_PICKUP — where the courier should collect from.',
    example: 'Bole, Addis Ababa',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trim)
  address?: string;

  @ApiPropertyOptional({ maxLength: 500, example: 'Gate code 4412.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Incidents
// ─────────────────────────────────────────────────────────────────────────────

export class ReportIncidentDto {
  @ApiProperty({ enum: IncidentType, example: IncidentType.PHYSICAL_DAMAGE })
  @IsEnum(IncidentType)
  type!: IncidentType;

  @ApiProperty({
    enum: IncidentPhase,
    description: 'The "When did this occur?" radio group.',
    example: IncidentPhase.DURING_RENTAL,
  })
  @IsEnum(IncidentPhase)
  phase!: IncidentPhase;

  @ApiProperty({
    description: '"Describe what happened in detail…"',
    example: 'The lens hood cracked when the tripod tipped over on the second day.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  @Transform(trim)
  description!: string;
}

export class IncidentPhotoResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Authorised URL — parties to the booking and Eskista only.' })
  url!: string;
}

export class IncidentResponse {
  @ApiProperty({ example: 'ESK-INC-00042' })
  reference!: string;

  @ApiProperty({ enum: IncidentType })
  type!: IncidentType;

  @ApiProperty({ enum: IncidentPhase })
  phase!: IncidentPhase;

  @ApiProperty({ enum: IncidentStatus, example: IncidentStatus.REPORTED })
  status!: IncidentStatus;

  @ApiProperty({ example: 'Reported', description: 'Ready-made status pill text.' })
  statusLabel!: string;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'How Eskista resolved it. Null until they have.',
  })
  resolution!: string | null;

  @ApiProperty({ type: [IncidentPhotoResponse] })
  photos!: IncidentPhotoResponse[];

  @ApiProperty({ example: '2026-08-20T14:30:00.000Z' })
  createdAt!: string;

  @ApiPropertyOptional({ nullable: true })
  resolvedAt!: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────────────────────

export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5, description: 'Whole stars only.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({
    description: '"Tell us about your experience…"',
    example: 'Delivered on time and in perfect condition.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  comment?: string;
}

export class ReviewResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 5 })
  rating!: number;

  @ApiPropertyOptional({ nullable: true })
  comment!: string | null;

  @ApiProperty({ example: '2026-08-23T09:00:00.000Z' })
  createdAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Courier tracking
// ─────────────────────────────────────────────────────────────────────────────

export class TrackingStepResponse {
  @ApiProperty({ example: 'OUT_FOR_DELIVERY' })
  key!: string;

  @ApiProperty({ example: 'Out for Delivery' })
  label!: string;

  @ApiProperty({ enum: ['DONE', 'IN_PROGRESS', 'PENDING'], example: 'IN_PROGRESS' })
  state!: 'DONE' | 'IN_PROGRESS' | 'PENDING';
}

export class TrackingResponse {
  @ApiProperty({ example: 'ESK-10482' })
  bookingReference!: string;

  @ApiProperty({ example: 'Sony FX3 Cinema Camera' })
  itemName!: string;

  @ApiProperty({
    enum: ['OUTBOUND', 'RETURN'],
    description: 'Which leg this describes. Outbound until the rental ends, then the return.',
    example: 'OUTBOUND',
  })
  direction!: 'OUTBOUND' | 'RETURN';

  @ApiProperty({
    description: 'Headline for the card — "Your equipment is on the way."',
    example: 'Your equipment is on the way.',
  })
  headline!: string;

  @ApiProperty({
    description: 'The chip above it.',
    example: 'Out for Delivery',
  })
  statusLabel!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Estimated arrival. Null until a courier is assigned and on the road.',
    example: '2026-08-18T15:45:00.000Z',
  })
  etaAt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Dawit Bekele' })
  courierName!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'For the Call Courier button. The vendor’s number is never exposed.',
    example: '+251911223344',
  })
  courierPhone!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Vehicle and plate, already joined — "Motorbike · AA 3-1024".',
    example: 'Motorbike · AA 3-1024',
  })
  vehicle!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Bole, Addis Ababa' })
  address!: string | null;

  @ApiProperty({ type: [TrackingStepResponse], description: 'The four-step sub-tracker.' })
  timeline!: TrackingStepResponse[];

  @ApiProperty({
    description:
      'True while a courier is actively moving. Poll roughly every 30s while true, and ' +
      'stop once it is false rather than polling a delivered booking forever.',
    example: true,
  })
  isLive!: boolean;
}
