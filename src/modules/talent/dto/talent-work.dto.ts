import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, EngagementModel, ProjectType, VerificationStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import {
  AttachmentResponse,
  CustomerAgreementResponse,
} from '../../customer-bookings/dto/lifecycle.dto';
import { HireRequestResponse } from '../../hiring/dto/hiring.dto';

export class TimelineStepResponse {
  @ApiProperty({ example: 'PAYMENT' }) key!: string;
  @ApiProperty({ example: 'Payment' }) label!: string;
  @ApiProperty({ enum: ['DONE', 'IN_PROGRESS', 'PENDING'] }) state!: string;
  @ApiPropertyOptional({ nullable: true }) occurredAt!: string | null;
}

export class TalentActionResponse {
  @ApiProperty({
    enum: [
      'SIGN_AGREEMENT',
      'CONFIRM_PAYMENT',
      'COMPLETE_BOOKING',
      'VIEW_DETAILS',
      'CONTACT_ESKISTA',
    ],
    example: 'SIGN_AGREEMENT',
  })
  key!: string;
  @ApiProperty({ example: 'Download & Sign Agreement' }) label!: string;
  @ApiProperty() primary!: boolean;
}

export class ListEngagementsQuery {
  @ApiPropertyOptional({
    enum: ['upcoming', 'active', 'completed', 'cancelled'],
    default: 'upcoming',
    description:
      '`upcoming` — hired, before the start (awaiting payment or confirmed). `active` — ' +
      'underway. `completed` — done, payout pending or paid. `cancelled` — called off.',
  })
  @IsOptional()
  @IsIn(['upcoming', 'active', 'completed', 'cancelled'])
  tab?: 'upcoming' | 'active' | 'completed' | 'cancelled';
}

export class EngagementCardResponse {
  @ApiProperty({ example: 'ESK-TLT-1004' }) reference!: string;
  @ApiProperty({ example: 'Brand campaign shoot' }) title!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ example: { label: 'Confirmed', tone: 'SUCCESS' } })
  badge!: { label: string; tone: string };
  @ApiProperty({ example: '2026-10-02' }) startDate!: string;
  @ApiProperty({ example: '2026-10-03' }) endDate!: string;
  @ApiPropertyOptional({ nullable: true, example: '08:00' }) startTime!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '18:00' }) endTime!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Addis Ababa' }) city!: string | null;
  @ApiProperty({ description: 'What you are paid for it.', example: 900000 })
  earningsMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ enum: ['UPCOMING', 'PENDING', 'PAID', 'CANCELLED'] })
  payoutStatus!: 'UPCOMING' | 'PENDING' | 'PAID' | 'CANCELLED';
}

export class EngagementDetailResponse extends EngagementCardResponse {
  @ApiPropertyOptional({ enum: ProjectType, nullable: true }) projectType!: ProjectType | null;
  @ApiPropertyOptional({ nullable: true }) projectDescription!: string | null;
  @ApiProperty({ enum: EngagementModel }) engagementModel!: EngagementModel;
  @ApiPropertyOptional({ nullable: true, example: 3 }) headcount!: number | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Venue or area. Shown once hired.',
    example: "Shola Market + client's showroom",
  })
  venue!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Parking and access instructions. Withheld until the client has paid and the booking ' +
      'is confirmed; `null` with `locationNotesLocked: true` before then.',
  })
  locationNotes!: string | null;
  @ApiProperty() locationNotesLocked!: boolean;
  @ApiProperty({ type: [TimelineStepResponse], description: 'The same six steps the client sees.' })
  timeline!: TimelineStepResponse[];
  @ApiProperty({ type: [AttachmentResponse], description: 'The client’s reference files.' })
  attachments!: AttachmentResponse[];
  @ApiPropertyOptional({
    type: CustomerAgreementResponse,
    nullable: true,
    description:
      'Your Eskista ↔ Talent agreement. `awaitingCustomer` means it is your move (download, ' +
      'sign, upload).',
  })
  agreement!: CustomerAgreementResponse | null;
  @ApiProperty({ type: [TalentActionResponse] }) actions!: TalentActionResponse[];
  @ApiProperty({ description: 'Eskista’s number, for Contact Eskista.' }) supportPhone!: string;

  @ApiPropertyOptional({
    type: () => TalentPayoutResponse,
    nullable: true,
    description: 'Once the engagement is done: what you are owed and whether it has been paid.',
  })
  payout!: TalentPayoutResponse | null;

  @ApiProperty({
    type: () => [TalentDocumentLinkResponse],
    description: 'Settlement Record once a payout is recorded.',
  })
  documents!: TalentDocumentLinkResponse[];
}

export class TalentPayoutResponse {
  @ApiProperty({ enum: ['PENDING', 'IN_BATCH', 'PAID', 'ON_HOLD'] }) status!: string;
  @ApiProperty({ example: 'Pending' }) statusLabel!: string;
  @ApiProperty({ description: 'Your rate in full.' }) amountMinor!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ nullable: true }) expectedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) payoutReference!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Telebirr •••• 3344',
    description: 'Where Eskista sent it.',
  })
  paidTo!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'You confirmed it arrived.' })
  confirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'You reported it missing.' })
  disputedAt!: string | null;
}

export class TalentDocumentLinkResponse {
  @ApiProperty({ enum: ['SETTLEMENT_RECORD'] }) kind!: string;
  @ApiProperty({ example: 'Settlement Record' }) label!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ example: 'PDF' }) format!: string;
}

export class TalentCompletionResponse {
  @ApiProperty({ example: 'Payment Received!' }) title!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ type: () => EngagementDetailResponse }) engagement!: EngagementDetailResponse;
}

export class TalentDashboardResponse {
  @ApiProperty({ example: 'Dawit' }) firstName!: string;
  @ApiProperty({ enum: VerificationStatus }) status!: VerificationStatus;
  @ApiProperty({
    description: '"This month": what you earn from engagements starting this month.',
    example: 1240000,
  })
  thisMonthEarningsMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ example: 148 }) profileViews!: number;
  @ApiProperty({ description: 'Requests waiting on your answer.', example: 9 })
  pendingRequests!: number;
  @ApiProperty({
    description: 'The "2 new opportunities" banner — requests you have not opened yet.',
    example: 2,
  })
  newOpportunities!: number;
  @ApiProperty({
    type: [String],
    description: 'Project types of the unopened requests, for the banner text.',
    example: ['Brand campaign', 'Music video'],
  })
  newOpportunityTypes!: string[];
  @ApiProperty({ example: 78 }) completionPercent!: number;
  @ApiProperty({ description: 'Show the Complete Profile button.' }) showCompleteProfile!: boolean;
  @ApiPropertyOptional({ nullable: true }) profileUrl!: string | null;
  @ApiProperty({ type: [HireRequestResponse], description: 'The five newest pending requests.' })
  hireRequests!: HireRequestResponse[];
  @ApiProperty({
    description: 'Upcoming engagements, soonest first.',
    type: [EngagementCardResponse],
  })
  upcoming!: EngagementCardResponse[];
}

export class EarningItemResponse {
  @ApiProperty({ example: 'ESK-TLT-1004' }) reference!: string;
  @ApiProperty({ example: 'Brand campaign shoot' }) title!: string;
  @ApiProperty({ example: '2026-10-02' }) date!: string;
  @ApiProperty({ example: 900000 }) earningsMinor!: number;
  @ApiProperty({ enum: ['UPCOMING', 'PENDING', 'PAID'] }) status!: 'UPCOMING' | 'PENDING' | 'PAID';
  @ApiPropertyOptional({ nullable: true }) paidAt!: string | null;
}

export class TalentEarningsResponse {
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ description: 'Everything paid out to date.', example: 5400000 })
  totalRevenueMinor!: number;
  @ApiProperty({ description: 'Paid out today.', example: 0 }) todayMinor!: number;
  @ApiProperty({ description: 'Hired and confirmed, not yet done.', example: 900000 })
  upcomingMinor!: number;
  @ApiProperty({ description: 'Done, waiting for Eskista to pay out.', example: 450000 })
  pendingMinor!: number;
  @ApiProperty({ type: [EarningItemResponse] }) items!: EarningItemResponse[];
}

export class CvSectionEntry {
  @ApiProperty({ example: 'Senior Cinematographer' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Tigist Media House' })
  subtitle!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2020 – Present' }) period!: string | null;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
}

export class TalentCvResponse {
  @ApiProperty({ example: 'CLASSIC' }) template!: string;
  @ApiProperty({ example: 'Dawit Bekele' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographer · Colorist' })
  headline!: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'On your own CV only. Clients never see your contact details.',
  })
  email!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) bio!: string | null;
  @ApiProperty({ type: [String] }) professions!: string[];
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty({ type: [String] }) languages!: string[];
  @ApiProperty({ type: [CvSectionEntry] }) experience!: CvSectionEntry[];
  @ApiProperty({ type: [CvSectionEntry] }) education!: CvSectionEntry[];
  @ApiProperty({ type: [CvSectionEntry] }) portfolio!: CvSectionEntry[];
  @ApiPropertyOptional({ nullable: true }) profileUrl!: string | null;
}
