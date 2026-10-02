import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PricingModel, VerificationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { PayoutAccountResponse } from '../../payout-accounts/payout-accounts';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminTalentQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Name, profession, phone or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ enum: VerificationStatus })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({ description: 'A profession, e.g. "Cinematographer".' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  category?: string;

  @ApiPropertyOptional({ enum: ['AVAILABLE', 'BOOKED'] })
  @IsOptional()
  @IsIn(['AVAILABLE', 'BOOKED'])
  availability?: 'AVAILABLE' | 'BOOKED';
}

export class RegisterTalentDto {
  @ApiProperty({ example: 'Dawit Bekele' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  displayName!: string;

  @ApiProperty({ example: '+251911778899' })
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'phone must be a phone number' })
  @Transform(trim)
  phone!: string;

  @ApiPropertyOptional({ example: 'dawit@example.com' })
  @IsOptional()
  @IsEmail()
  @Transform(trim)
  email?: string;

  @ApiProperty({ example: 'Addis Ababa' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  location!: string;

  @ApiProperty({ type: [String], example: ['Cinematographer'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  professions!: string[];

  @ApiPropertyOptional({ enum: PricingModel, default: PricingModel.PER_DAY })
  @IsOptional()
  @IsEnum(PricingModel)
  pricingModel?: PricingModel;

  @ApiPropertyOptional({
    example: 1_200_000,
    description: "The talent's own rate, minor units, before commission and VAT.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseRateMinor?: number;

  @ApiPropertyOptional({
    example: 'Award-winning cinematographer with 7 years of experience in commercials and film.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  bio?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Verify at once — Eskista already vetted this person. Otherwise the profile waits for ' +
      'the talent to complete it in the Mini App.',
  })
  @IsOptional()
  @IsBoolean()
  verify?: boolean;
}

export class SuspendTalentDto {
  @ApiProperty({ example: 'Repeated no-shows under review' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class TalentRosterRowResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Dawit Bekele' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: '/api/v1/files/talent/5b0c…/public/avatar.jpg' })
  avatarUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographer' }) category!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 1_200_000,
    description: "The talent's own day rate.",
  })
  baseRateMinor!: number | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 1_587_000,
    description: 'What a client pays, VAT inclusive.',
  })
  customerRateMinor!: number | null;
  @ApiProperty({ enum: PricingModel, example: PricingModel.PER_DAY }) pricingModel!: PricingModel;
  @ApiProperty({
    enum: ['AVAILABLE', 'BOOKED', 'UNAVAILABLE'],
    example: 'AVAILABLE',
    description: 'Booked today, free, or not taking work.',
  })
  availability!: string;
  @ApiProperty({ enum: VerificationStatus, example: VerificationStatus.VERIFIED })
  status!: VerificationStatus;
  @ApiProperty({ example: 'Verified' }) statusLabel!: string;
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
  @ApiProperty({ example: 4.8 }) rating!: number;
  @ApiProperty({ example: 14 }) completedBookings!: number;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['FEATURED', 'HIGHLIGHTED', 'SPOTLIGHT'],
    example: null,
  })
  featureTier!: string | null;
  @ApiProperty({ example: '2026-06-02T08:00:00.000Z' }) joinedAt!: string;
}

export class TalentKpisResponse {
  @ApiProperty({ example: 42, description: 'Every talent past draft.' }) total!: number;
  @ApiProperty({ example: 31, description: 'Verified and taking work.' }) active!: number;
  @ApiProperty({ example: 3 }) pendingVerification!: number;
  @ApiProperty({ example: 6, description: 'Talent requests open or under way.' })
  activeRequests!: number;
  @ApiProperty({ example: 2, description: 'Open issues on talent engagements.' })
  openIssues!: number;
}

export class RegisteredTalentResponse {
  @ApiProperty({ format: 'uuid', description: 'The new talent profile id.' }) id!: string;
  @ApiProperty({
    example: 'K7Q2-MX9P',
    description: 'Give this to the talent: they enter it in the Mini App to take over the profile.',
  })
  claimCode!: string;
  @ApiProperty({ example: '2026-10-12T09:00:00.000Z' }) claimCodeExpiresAt!: string;
}

// ── Admin profile view ───────────────────────────────────────────────────────

export class TalentServiceAdminResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Full-day commercial shoot' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Camera, lighting plan and on-set colour.' })
  description!: string | null;
  @ApiProperty({ enum: PricingModel, example: PricingModel.PER_DAY }) pricingModel!: PricingModel;
  @ApiProperty({ example: 1_200_000, description: "The talent's own price." }) priceMinor!: number;
  @ApiProperty({ example: 1_587_000, description: 'What a client pays: commission and VAT added.' })
  customerPriceMinor!: number;
  @ApiProperty({ example: true }) isActive!: boolean;
}

export class PortfolioItemAdminResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Zeleman — Coffee Origins' }) title!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Zeleman' }) client!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Director of Photography' }) role!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' }) startDate!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-03-04' }) endDate!: string | null;
  @ApiPropertyOptional({ nullable: true }) coverUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'https://vimeo.com/000000' }) workLink!:
    string | null;
}

export class TalentExperienceAdminResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Director of Photography' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Habesha Films' }) company!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2022-01-01' }) startDate!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) endDate!: string | null;
  @ApiProperty({ example: true }) isCurrent!: boolean;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
}

export class TalentEducationAdminResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Addis Ababa University' }) institution!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Film Studies' }) fieldOfStudy!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'BA' }) qualification!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 2014 }) startYear!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 2018 }) endYear!: number | null;
}

export class TalentReferenceAdminResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Meron Alemu — +251911445566' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911445566' }) contact!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Producer, Habesha Films' }) relationship!:
    string | null;
}

export class TalentDocumentAdminResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'FAYDA_ID' }) type!: string;
  @ApiProperty({ enum: ['PENDING', 'VERIFIED', 'REJECTED'], example: 'PENDING' }) status!: string;
  @ApiProperty({ example: 'fayda-front.jpg' }) fileName!: string;
  @ApiProperty({ example: '/api/v1/files/talent/…/id/fayda-front.jpg' }) url!: string;
  @ApiProperty({ example: '2026-06-15T09:00:00.000Z' }) uploadedAt!: string;
}

export class TalentChecklistResponse {
  @ApiProperty({
    enum: ['NOT_STARTED', 'QUEUED', 'IN_PROGRESS', 'PASSED', 'FAILED'],
    example: 'PASSED',
  })
  identity!: string;
  @ApiProperty({
    enum: ['NOT_STARTED', 'QUEUED', 'IN_PROGRESS', 'PASSED', 'FAILED'],
    example: 'IN_PROGRESS',
  })
  portfolio!: string;
  @ApiProperty({
    enum: ['NOT_STARTED', 'QUEUED', 'IN_PROGRESS', 'PASSED', 'FAILED'],
    example: 'QUEUED',
  })
  references!: string;
}

export class TalentReviewAdminResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 5 }) rating!: number;
  @ApiPropertyOptional({ nullable: true, example: 'On time, great eye.' }) comment!: string | null;
  @ApiProperty({ example: 'Yoseph Alemu' }) author!: string;
  @ApiProperty({ example: '2026-09-20T12:00:00.000Z' }) createdAt!: string;
}

export class TalentUpcomingResponse {
  @ApiProperty({ example: 'ESK-TLT-9001' }) reference!: string;
  @ApiProperty({ example: '2026-10-02' }) startDate!: string;
  @ApiProperty({ example: '2026-10-02' }) endDate!: string;
  @ApiProperty({ example: 'BOOKING_CONFIRMED' }) status!: string;
}

export class TalentAdminProfileResponse extends TalentRosterRowResponse {
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographer for commercials and weddings' })
  headline!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Seven years behind the camera, from music videos to feature films.',
    description: 'About.',
  })
  about!: string | null;
  @ApiProperty({ example: 'Per Day', description: 'Engagement type.' }) engagementType!: string;
  @ApiProperty({
    example: 1500,
    description: 'Commission applied to this talent, in basis points.',
  })
  commissionRateBps!: number;
  @ApiProperty({
    example: 1500,
    description: 'VAT included in `customerRateMinor` ("15% VAT inclusive").',
  })
  vatBps!: number;
  @ApiPropertyOptional({ nullable: true, example: '+251911778899' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'dawit@example.com' }) email!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'https://eskista.com/talent/dawit-bekele' })
  profileUrl!: string | null;
  @ApiProperty({ type: [String], example: ['Cinematographer', 'Editor'] }) professions!: string[];
  @ApiProperty({ type: [String], example: ['Commercials', 'Weddings'] }) specializations!: string[];
  @ApiProperty({ type: [String], example: ['Colour grading', 'Gimbal operation'] })
  skills!: string[];
  @ApiProperty({ type: [String], example: ['Amharic', 'English'] }) languages!: string[];
  @ApiProperty({ enum: ['ENTRY', 'INTERMEDIATE', 'SENIOR', 'EXPERT'], example: 'SENIOR' })
  experienceLevel!: string;
  @ApiPropertyOptional({ nullable: true, example: 7 }) yearsExperience!: number | null;
  @ApiProperty({ type: [String], example: ['MON', 'TUE', 'WED', 'THU', 'FRI'] })
  workingDays!: string[];
  @ApiPropertyOptional({ nullable: true, enum: ['FULL_DAY', 'HALF_DAY', 'FLEXIBLE'] }) dayType!:
    string | null;
  @ApiProperty({
    example: '/api/v1/admin/talent/5b0c…/cv.pdf',
    description: 'The CV PDF, contact details included.',
  })
  cvUrl!: string;
  @ApiProperty({ type: [PayoutAccountResponse] }) payoutAccounts!: PayoutAccountResponse[];
  @ApiPropertyOptional({
    type: PayoutAccountResponse,
    nullable: true,
    description: 'The direct payout channel (primary).',
  })
  payoutChannel!: PayoutAccountResponse | null;
  @ApiProperty({ example: 1_200_000, description: 'Settlements not yet paid.' })
  pendingPayoutMinor!: number;
  @ApiProperty({ type: [TalentServiceAdminResponse] }) services!: TalentServiceAdminResponse[];
  @ApiProperty({ type: [PortfolioItemAdminResponse] }) portfolio!: PortfolioItemAdminResponse[];
  @ApiProperty({ type: [TalentExperienceAdminResponse] })
  experiences!: TalentExperienceAdminResponse[];
  @ApiProperty({ type: [TalentEducationAdminResponse] })
  educations!: TalentEducationAdminResponse[];
  @ApiProperty({
    type: [TalentReferenceAdminResponse],
    description: 'Checked by Eskista; never public.',
  })
  references!: TalentReferenceAdminResponse[];
  @ApiProperty({ type: [TalentDocumentAdminResponse] }) documents!: TalentDocumentAdminResponse[];
  @ApiProperty({ type: TalentChecklistResponse }) checklist!: TalentChecklistResponse;
  @ApiProperty({ type: [TalentReviewAdminResponse] }) reviews!: TalentReviewAdminResponse[];
  @ApiProperty({ type: [TalentUpcomingResponse], description: 'Committed engagements.' })
  upcoming!: TalentUpcomingResponse[];
  @ApiPropertyOptional({ nullable: true }) submittedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) verifiedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Abel Tesfaye' }) verifiedBy!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) suspendedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) suspendedReason!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Registered by an admin: who.' })
  registeredBy!: string | null;
  @ApiProperty({
    example: false,
    description: 'Registered by Eskista and not yet claimed by its talent.',
  })
  claimPending!: boolean;
  @ApiPropertyOptional({ nullable: true }) claimCodeExpiresAt!: string | null;
}
