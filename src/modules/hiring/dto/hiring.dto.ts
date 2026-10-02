import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BudgetBand,
  EngagementModel,
  InvitationStatus,
  PricingModel,
  ProjectType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// ─────────────────────────────────────────────────────────────────────────────
// Customer side
// ─────────────────────────────────────────────────────────────────────────────

export class HireTalentDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'The talents to hire, from those whose invitation is `ACCEPTED`. One, or up to the ' +
      'request’s headcount. Everyone else still in the running becomes `REJECTED`.',
    example: ['6f1c9f5e-2c1a-4d8e-9a0b-3b1f7c2d9e11'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  talentProfileIds!: string[];
}

export class InviteMoreDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'More talents to invite while the request is still open. The total may not exceed ' +
      'the admin limit (5 by default).',
    example: ['6f1c9f5e-2c1a-4d8e-9a0b-3b1f7c2d9e11'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  talentProfileIds!: string[];
}

export class InvitedTalentResponse {
  @ApiProperty({ format: 'uuid', example: '6f1c9f5e-2c1a-4d8e-9a0b-3b1f7c2d9e11' }) id!: string;
  @ApiProperty({ example: 'Dawit Bekele' }) displayName!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographer' })
  profession!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'https://cdn.eskista.com/avatars/dawit.jpg' })
  avatarUrl!: string | null;
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
  @ApiPropertyOptional({ nullable: true, example: 4.9 }) rating!: number | null;
  @ApiProperty({ example: 24 }) reviewCount!: number;
}

export class InvitationPriceResponse {
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({
    description: 'What hiring this talent for this request costs the customer, VAT included.',
    example: 1190250,
  })
  totalMinor!: number;
  @ApiProperty({ description: 'Their rate, as the customer sees it.', example: 396750 })
  unitPriceMinor!: number;
  @ApiProperty({ enum: PricingModel }) pricingModel!: PricingModel;
  @ApiProperty({ description: 'Days, hours or 1 for a project rate.', example: 3 })
  periods!: number;
  @ApiProperty({ example: 'Inc. 15% VAT' }) taxNote!: string;
}

export class CustomerInvitationResponse {
  @ApiProperty({ format: 'uuid', example: '7e1c9f5e-2c1a-4d8e-9a0b-3b1f7c2d9e22' }) id!: string;
  @ApiProperty({ type: InvitedTalentResponse }) talent!: InvitedTalentResponse;
  @ApiProperty({ enum: InvitationStatus }) status!: InvitationStatus;
  @ApiProperty({ example: 'Available' }) statusLabel!: string;
  @ApiPropertyOptional({
    type: InvitationPriceResponse,
    nullable: true,
    description: 'Null only if the talent has no rate on file.',
  })
  price!: InvitationPriceResponse | null;
  @ApiProperty({ example: '2026-09-27T09:00:00.000Z' }) expiresAt!: string;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-26T14:30:00.000Z' })
  respondedAt!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'The booking this hire became, once HIRED — a sibling for a second hire.',
    example: 'ESK-TLT-1005',
  })
  hiredBookingReference!: string | null;
  @ApiProperty({
    description: 'True while this talent can be picked in `POST …/hire`.',
    example: true,
  })
  canHire!: boolean;
}

export class CustomerInvitationsResponse {
  @ApiProperty({ example: 'ESK-TLT-1004' }) reference!: string;
  @ApiProperty({
    enum: ['WAITING_FOR_REPLIES', 'READY_TO_CHOOSE', 'HIRED', 'CLOSED'],
    description:
      '`WAITING_FOR_REPLIES` — nobody has accepted yet. `READY_TO_CHOOSE` — at least one ' +
      'has; show Choose Talent. `HIRED` — the decision is made. `CLOSED` — expired or ' +
      'cancelled.',
  })
  phase!: 'WAITING_FOR_REPLIES' | 'READY_TO_CHOOSE' | 'HIRED' | 'CLOSED';
  @ApiProperty({ description: 'How many people the request is for.', example: 1 })
  headcount!: number;
  @ApiProperty({ description: 'Talents hired so far.', example: 0 }) hiredCount!: number;
  @ApiProperty({ example: false }) autoHireFirstAccept!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'When the customer must have chosen by. Set on the first acceptance.',
    example: '2026-09-29T12:00:00.000Z',
  })
  selectionDeadlineAt!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 71 }) selectionHoursLeft!: number | null;
  @ApiProperty({ description: 'The admin limit on invitations per request.', example: 5 })
  maxInvitations!: number;
  @ApiProperty({
    description: 'Whether `POST …/invitations` would be accepted now.',
    example: true,
  })
  canInviteMore!: boolean;
  @ApiProperty({ type: [CustomerInvitationResponse] })
  invitations!: CustomerInvitationResponse[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Talent side
// ─────────────────────────────────────────────────────────────────────────────

export class ListHireRequestsQuery {
  @ApiPropertyOptional({
    enum: ['pending', 'accepted', 'closed', 'all'],
    default: 'all',
    description:
      '`pending` — waiting on your answer. `accepted` — you said yes, the client is ' +
      'choosing. `closed` — declined, expired, withdrawn, not selected, cancelled or hired.',
  })
  @IsOptional()
  @IsIn(['pending', 'accepted', 'closed', 'all'])
  status?: 'pending' | 'accepted' | 'closed' | 'all';
}

export class DeclineRequestDto {
  @ApiPropertyOptional({ example: 'Already booked that week', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  reason?: string;
}

export class HireRequestResponse {
  @ApiProperty({ format: 'uuid', description: 'The invitation id — use it to answer.' })
  id!: string;
  @ApiProperty({ example: 'ESK-TLT-1004' }) reference!: string;
  @ApiProperty({ enum: InvitationStatus }) status!: InvitationStatus;
  @ApiProperty({ example: 'Request Received' }) statusLabel!: string;
  @ApiProperty({
    description: 'False once opened — "new opportunity" until then.',
    example: true,
  })
  isNew!: boolean;

  @ApiProperty({ example: 'Brand campaign shoot' }) title!: string;
  @ApiPropertyOptional({ enum: ProjectType, nullable: true }) projectType!: ProjectType | null;
  @ApiPropertyOptional({ nullable: true, example: 'Corporate documentary shoot' })
  projectDescription!: string | null;
  @ApiProperty({ example: '2026-10-02' }) startDate!: string;
  @ApiProperty({ example: '2026-10-03' }) endDate!: string;
  @ApiPropertyOptional({ nullable: true, example: '08:00' }) startTime!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '18:00' }) endTime!: string | null;
  @ApiProperty({ enum: EngagementModel }) engagementModel!: EngagementModel;
  @ApiPropertyOptional({ nullable: true, example: 'Addis Ababa' }) city!: string | null;
  @ApiProperty({ example: 1 }) headcount!: number;
  @ApiPropertyOptional({ enum: BudgetBand, nullable: true }) budgetBand!: BudgetBand | null;
  @ApiPropertyOptional({ nullable: true, example: 2500000 }) budgetMinor!: number | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'ETB 10k – 25k',
    description: 'The budget as the design prints it on the card.',
  })
  budgetLabel!: string | null;

  @ApiProperty({
    description:
      'What you would be paid for this request at your own rate — exactly, with nothing ' +
      'taken off. Eskista’s commission and VAT are added on the client’s side.',
    example: 900000,
  })
  yourEarningsMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;

  @ApiProperty({ example: '2026-09-25T09:00:00.000Z' }) receivedAt!: string;
  @ApiProperty({ example: '2026-09-27T09:00:00.000Z' }) expiresAt!: string;
  @ApiPropertyOptional({ nullable: true, example: 47 }) hoursToRespond!: number | null;

  @ApiProperty({ description: 'Accept and Decline are available.', example: true })
  canRespond!: boolean;
  @ApiProperty({ description: 'Withdraw is available (accepted, not yet chosen).', example: false })
  canWithdraw!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Once HIRED: the engagement to open under Bookings.',
    example: 'ESK-TLT-1004',
  })
  engagementReference!: string | null;
}
