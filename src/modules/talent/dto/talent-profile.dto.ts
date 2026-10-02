import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CvTemplate,
  ExperienceLevel,
  PricingModel,
  ReviewCheckState,
  TalentDayType,
  VerificationStatus,
  Weekday,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimList = ({ value }: { value: unknown }): unknown => {
  if (!Array.isArray(value)) return value;
  const cleaned = (value as unknown[])
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => v !== '' && v !== null && v !== undefined);
  return [...new Set(cleaned)];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Profile: onboarding and every later edit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every field of the profile wizard. All optional, so the wizard can save after any step
 * ("Save" top-right) and the talent can come back; what submission needs is checked at
 * `POST /talent/me/submit`.
 */
export class UpdateTalentProfileDto {
  // ── Step 1: basic information ──
  @ApiPropertyOptional({ description: 'Professional name.', example: 'Dawit Bekele' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  displayName?: string;

  @ApiPropertyOptional({ example: '+251911223344' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional({ example: 'hello@dawitmedia.et' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  @Transform(trim)
  email?: string;

  @ApiPropertyOptional({ example: 'Addis Ababa' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  location?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 60, example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  yearsExperience?: number;

  @ApiPropertyOptional({ enum: ExperienceLevel })
  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevel?: ExperienceLevel;

  @ApiPropertyOptional({
    description: '"Describe your background, experience, and what you do best…"',
    maxLength: 2000,
    example: 'Award-winning cinematographer with 8 years of experience on commercials, narrative films, and documentaries.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  bio?: string;

  @ApiPropertyOptional({
    description: 'Short line under the name on cards — "Cinematographer · commercials".',
    maxLength: 120,
    example: 'Cinematographer · Commercials & Narrative',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  headline?: string;

  @ApiPropertyOptional({
    description:
      '**Minimum Rate**, per day, in minor units — what the talent will be **paid**. ' +
      'Eskista’s commission and VAT are added on top when an admin approves the profile. ' +
      'Changing it on an approved profile sends it back for review.',
    example: 300000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  baseRateMinor?: number;

  @ApiPropertyOptional({ enum: PricingModel, default: PricingModel.PER_DAY })
  @IsOptional()
  @IsEnum(PricingModel)
  pricingModel?: PricingModel;

  @ApiPropertyOptional({ type: [String], example: ['Amharic', 'English'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Transform(trimList)
  languages?: string[];

  @ApiPropertyOptional({
    description: 'The terms checkbox. Send `true` once; the acceptance time is recorded.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;

  // ── Step 2: profession ──
  @ApiPropertyOptional({
    type: [String],
    description:
      '"Select your primary profession. You can add more later." The wizard sends one; ' +
      'the Profile tab may add more. The first is the primary one shown on cards.',
    example: ['Cinematographer', 'Colorist'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Transform(trimList)
  professions?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Commercial', 'Music Video'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @Transform(trimList)
  specializations?: string[];

  // ── Step 3: availability ──
  @ApiPropertyOptional({ enum: Weekday, isArray: true, example: ['MON', 'WED', 'FRI'] })
  @IsOptional()
  @IsArray()
  @IsEnum(Weekday, { each: true })
  workingDays?: Weekday[];

  @ApiPropertyOptional({ enum: TalentDayType, example: TalentDayType.FULL_DAY })
  @IsOptional()
  @IsEnum(TalentDayType)
  dayType?: TalentDayType;

  // ── Legacy: a single education line. The Education step (`PUT /talent/me/education`)
  //    is what completes the profile; this is kept only so existing data still shows. ──
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Use `PUT /talent/me/education`. Shown on the CV only when there are no entries.',
    example: 'BA Film Production, Addis Ababa University',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  highestEducation?: string;

  // ── Step 6: skills ──
  @ApiPropertyOptional({ type: [String], example: ['DaVinci Resolve', 'Drone Operation'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Transform(trimList)
  skills?: string[];

  // ── Step 8: CV ──
  @ApiPropertyOptional({ enum: CvTemplate, default: CvTemplate.CLASSIC })
  @IsOptional()
  @IsEnum(CvTemplate)
  cvTemplate?: CvTemplate;

  // ── Step 9: publish ──
  @ApiPropertyOptional({
    description:
      'Profile URL — eskista.com/talent/<slug>. Normalised to lowercase and hyphens. ' +
      'Check it first with `GET /talent/slug-availability`.',
    example: 'dawit-media',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  slug?: string;

  @ApiPropertyOptional({
    description: 'The talent’s own switch to hide from the directory, e.g. mid-shoot.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isAvailableForHire?: boolean;
}

export class CreateTalentProfileDto extends UpdateTalentProfileDto {
  @ApiProperty({ example: 'Dawit Bekele' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  declare displayName: string;

  @ApiProperty({ example: 'Addis Ababa' })
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  declare location: string;
}

// ── Repeatable sections ──────────────────────────────────────────────────────

export class ExperienceItemDto {
  @ApiProperty({ description: 'Job title / Role.', example: 'Senior Cinematographer' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  title!: string;

  @ApiProperty({ description: 'Company / Client.', example: 'Tigist Media House' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trim)
  company!: string;

  @ApiProperty({ example: '2020-01-01' })
  @Matches(ISO_DATE)
  startDate!: string;

  @ApiPropertyOptional({
    example: '2023-12-31',
    description: 'Required unless `isCurrent` ("Currently working here").',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  endDate?: string;

  @ApiPropertyOptional({ description: '"Currently working here" — no end date.' })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @ApiPropertyOptional({ description: 'Description (optional).', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  description?: string;
}

export class ReplaceExperienceDto {
  @ApiProperty({
    type: [ExperienceItemDto],
    description: 'The whole list, in display order.',
    example: [
      {
        title: 'Senior Cinematographer',
        company: 'Tigist Media House',
        startDate: '2020-01-01',
        endDate: '2023-12-31',
        isCurrent: false,
        description: 'Lead camera operator on commercial sets',
      },
    ],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExperienceItemDto)
  items!: ExperienceItemDto[];
}

export class EducationItemDto {
  @ApiProperty({ example: 'Addis Ababa University' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(trim)
  institution!: string;

  @ApiProperty({ example: 'Film & Television' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  fieldOfStudy!: string;

  @ApiProperty({ description: 'Qualification / Degree.', example: 'BSc' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Transform(trim)
  qualification!: string;

  @ApiProperty({ example: 2016 })
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  startYear!: number;

  @ApiProperty({ description: 'Expected year, if still studying.', example: 2020 })
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  endYear!: number;
}

export class ReplaceEducationDto {
  @ApiProperty({
    type: [EducationItemDto],
    example: [
      {
        institution: 'Addis Ababa University',
        fieldOfStudy: 'Film & Television',
        qualification: 'BSc',
        startYear: 2016,
        endYear: 2020,
      },
    ],
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => EducationItemDto)
  items!: EducationItemDto[];
}

export class ReferenceItemDto {
  @ApiProperty({
    description:
      'The design has one "Reference 1 — name and contact" box; send its text here. Split ' +
      'out `contact` only if the client collects it separately.',
    example: 'Hana Girma, +251911556677',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ description: 'Phone or email, if collected apart from the name.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  contact?: string;

  @ApiPropertyOptional({ example: 'Producer, Ethio Telecom campaign' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  relationship?: string;
}

export class ReplaceReferencesDto {
  @ApiProperty({
    type: [ReferenceItemDto],
    description: 'At least two are needed to submit. Seen only by Eskista, never public.',
    example: [
      {
        name: 'Hana Girma',
        contact: '+251911556677',
        relationship: 'Producer, Ethio Telecom campaign',
      },
    ],
  })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ReferenceItemDto)
  items!: ReferenceItemDto[];
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export class PortfolioFieldsDto {
  @ApiPropertyOptional({ example: 'Abay Fashion Brand Campaign' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional({ description: 'Who it was for.', example: 'Abay Trading' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  client?: string;

  @ApiPropertyOptional({ example: 'Director of Photography' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  role?: string;

  @ApiPropertyOptional({ example: '2026-08-16' })
  @IsOptional()
  @Matches(ISO_DATE)
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-08-30' })
  @IsOptional()
  @Matches(ISO_DATE)
  endDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({ description: 'Work link.', example: 'https://youtube.com/watch?v=abc' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  workLink?: string;
}

// ── Services ─────────────────────────────────────────────────────────────────

export class TalentServiceDto {
  @ApiProperty({ example: 'Full Day Commercial' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  title!: string;

  @ApiPropertyOptional({
    maxLength: 500,
    example: '10-hour full day commercial shoot with lighting package',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @ApiProperty({ enum: PricingModel, example: PricingModel.PER_DAY })
  @IsEnum(PricingModel)
  pricingModel!: PricingModel;

  @ApiProperty({
    description: 'What the talent is paid for this service. Commission and VAT go on top.',
    example: 450000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceMinor!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Talent category, for the directory.',
    example: '550e8400-e29b-41d4-a716-446655440003',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BlockDatesDto {
  @ApiProperty({ example: '2026-08-10' })
  @Matches(ISO_DATE)
  startDate!: string;

  @ApiProperty({ example: '2026-08-12' })
  @Matches(ISO_DATE)
  endDate!: string;

  @ApiPropertyOptional({ example: 'Travelling' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class UploadIdDocumentDto {
  @ApiProperty({ enum: ['FAYDA_ID', 'PASSPORT'], example: 'FAYDA_ID' })
  @IsEnum({ FAYDA_ID: 'FAYDA_ID', PASSPORT: 'PASSPORT' })
  type!: 'FAYDA_ID' | 'PASSPORT';
}

// ─────────────────────────────────────────────────────────────────────────────
// Responses
// ─────────────────────────────────────────────────────────────────────────────

export class CompletionStepResponse {
  @ApiProperty({ example: 'PORTFOLIO' })
  key!: string;

  @ApiProperty({ example: 'Portfolio' })
  label!: string;

  @ApiProperty({ example: false })
  complete!: boolean;

  @ApiProperty({
    description: 'Always true: the designs make every step part of the profile.',
    example: true,
  })
  required!: boolean;
}

export class ReviewChecklistResponse {
  @ApiProperty({ enum: ReviewCheckState, example: ReviewCheckState.IN_PROGRESS })
  identity!: ReviewCheckState;

  @ApiProperty({ enum: ReviewCheckState, example: ReviewCheckState.QUEUED })
  portfolio!: ReviewCheckState;

  @ApiProperty({ enum: ReviewCheckState, example: ReviewCheckState.QUEUED })
  references!: ReviewCheckState;

  @ApiProperty({
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    description: '"Eskista approval" row.',
    example: 'PENDING',
  })
  approval!: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiProperty({ example: 'Typical review: 2–3 business days' })
  note!: string;
}

export class ExperienceResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Senior Cinematographer' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Tigist Media House' }) company!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2020-01-01' }) startDate!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2023-12-31' }) endDate!: string | null;
  @ApiProperty({ example: false }) isCurrent!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'Lead camera operator on commercial sets' })
  description!: string | null;
}

export class EducationResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Addis Ababa University' }) institution!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Film & Television' }) fieldOfStudy!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'BSc' }) qualification!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 2016 }) startYear!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 2020 }) endYear!: number | null;
}

export class ReferenceResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Hana Girma' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911556677' }) contact!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Producer, Ethio Telecom campaign' })
  relationship!: string | null;
}

export class PortfolioResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Abay Fashion Campaign' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Abay Trading' }) client!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Director of Photography' })
  role!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-08-16' }) startDate!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-08-30' }) endDate!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'High-end fashion commercial campaign shot on RED Komodo',
  })
  description!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Cover image.',
    example: 'https://cdn.eskista.com/portfolio/cover1.jpg',
  })
  coverUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'https://youtube.com/watch?v=abc' })
  workLink!: string | null;
  @ApiProperty({ example: 0 }) sortOrder!: number;
}

export class TalentServiceResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Full Day Commercial' }) title!: string;
  @ApiPropertyOptional({ nullable: true, example: '10-hour shoot with lighting setup' })
  description!: string | null;
  @ApiProperty({ enum: PricingModel }) pricingModel!: PricingModel;
  @ApiProperty({ description: 'What the talent is paid.', example: 450000 }) priceMinor!: number;
  @ApiProperty({ example: true }) isActive!: boolean;
}

export class TalentDocumentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'FAYDA_ID' }) type!: string;
  @ApiProperty({ example: 'PENDING' }) status!: string;
  @ApiProperty({ example: 'fayda_id_front.pdf' }) fileName!: string;
  @ApiProperty({
    description: 'Readable by the talent and Eskista only.',
    example: 'https://files.eskista.com/talent-docs/doc-1.pdf',
  })
  url!: string;
  @ApiPropertyOptional({ nullable: true, example: null }) rejectionReason!: string | null;
  @ApiProperty({ example: '2026-09-01T12:00:00.000Z' }) uploadedAt!: string;
}

export class TalentProfileResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: VerificationStatus }) status!: VerificationStatus;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Why Eskista sent it back, if it did.',
    example: null,
  })
  rejectionReason!: string | null;

  @ApiProperty({ example: 'Dawit Bekele' }) displayName!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographer · Commercials' })
  headline!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'dawit@media.et' }) email!: string | null;
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
  @ApiPropertyOptional({ nullable: true, example: 8 }) yearsExperience!: number | null;
  @ApiProperty({ enum: ExperienceLevel }) experienceLevel!: ExperienceLevel;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Award-winning cinematographer with 8 years of experience.',
  })
  bio!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'What the talent is paid per day.',
    example: 300000,
  })
  baseRateMinor!: number | null;
  @ApiProperty({ enum: PricingModel }) pricingModel!: PricingModel;
  @ApiProperty({ type: [String], example: ['Amharic', 'English'] }) languages!: string[];
  @ApiPropertyOptional({ nullable: true, example: 'https://cdn.eskista.com/avatars/dawit.jpg' })
  avatarUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-08-01T10:00:00.000Z' })
  termsAcceptedAt!: string | null;

  @ApiProperty({ type: [String], example: ['Cinematographer', 'Colorist'] })
  professions!: string[];
  @ApiProperty({ type: [String], example: ['Commercial', 'Music Video'] })
  specializations!: string[];
  @ApiProperty({ enum: Weekday, isArray: true }) workingDays!: Weekday[];
  @ApiPropertyOptional({ enum: TalentDayType, nullable: true }) dayType!: TalentDayType | null;
  @ApiPropertyOptional({ nullable: true, example: 'BA Film Production' })
  highestEducation!: string | null;
  @ApiProperty({ type: [String], example: ['DaVinci Resolve', 'Drone Operation'] }) skills!: string[];
  @ApiProperty({ enum: CvTemplate }) cvTemplate!: CvTemplate;

  @ApiPropertyOptional({ nullable: true, example: 'dawit-media' }) slug!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Full share link, for Copy and Share Profile.',
    example: 'https://eskista.com/talent/dawit-media',
  })
  profileUrl!: string | null;
  @ApiProperty({ example: true }) isAvailableForHire!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The commission agreed at review, once approved. Shown so the talent understands the ' +
      'customer price; they are always paid their own rate in full.',
    example: 1500,
  })
  commissionRateBps!: number | null;

  @ApiProperty({ type: [ExperienceResponse] }) experience!: ExperienceResponse[];
  @ApiProperty({ type: [EducationResponse] }) education!: EducationResponse[];
  @ApiProperty({ type: [ReferenceResponse] }) references!: ReferenceResponse[];
  @ApiProperty({ type: [PortfolioResponse] }) portfolio!: PortfolioResponse[];
  @ApiProperty({ type: [TalentServiceResponse] }) services!: TalentServiceResponse[];
  @ApiProperty({ type: [TalentDocumentResponse] }) documents!: TalentDocumentResponse[];

  @ApiProperty({ type: [CompletionStepResponse] }) steps!: CompletionStepResponse[];
  @ApiProperty({ description: 'The "Profile N% complete" bar.', example: 78 })
  completionPercent!: number;
  @ApiProperty({
    type: [String],
    description: 'What still stops submission. Empty means `canSubmit`.',
    example: [],
  })
  submitBlockers!: string[];
  @ApiProperty({ example: true }) canSubmit!: boolean;
  @ApiProperty({ type: ReviewChecklistResponse }) reviewChecklist!: ReviewChecklistResponse;
}

export class SlugAvailabilityResponse {
  @ApiProperty({ example: 'dawit-media' }) slug!: string;
  @ApiProperty({ example: true }) available!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'That URL is taken.' })
  reason!: string | null;
  @ApiProperty({ type: [String], description: 'Free alternatives when it is taken.' })
  suggestions!: string[];
}

/**
 * Add Project. Everything the design does not mark "(optional)" is required: cover image
 * (sent as the `cover` file), title, client, role, start and end date.
 */
export class CreatePortfolioDto extends PortfolioFieldsDto {
  @ApiProperty({ example: 'Abay Fashion Brand Campaign' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(trim)
  declare title: string;

  @ApiProperty({ example: 'Abay Trading' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Transform(trim)
  declare client: string;

  @ApiProperty({ example: 'Director of Photography' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trim)
  declare role: string;

  @ApiProperty({ example: '2026-08-16' })
  @Matches(ISO_DATE)
  declare startDate: string;

  @ApiProperty({ example: '2026-08-30' })
  @Matches(ISO_DATE)
  declare endDate: string;
}

export class ReorderPortfolioDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Every portfolio item id, in the order to show them.',
    example: [
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440001',
    ],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  ids!: string[];
}

export class UpdateTalentServiceDto {
  @ApiPropertyOptional({ example: 'Full Day Commercial' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional({ example: '10-hour shoot with lighting' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({ enum: PricingModel })
  @IsOptional()
  @IsEnum(PricingModel)
  pricingModel?: PricingModel;

  @ApiPropertyOptional({ example: 450000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceMinor?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SlugQuery {
  @ApiProperty({ example: 'dawit-media' })
  @IsString()
  @MaxLength(80)
  slug!: string;
}

export class BlockedDateResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '2026-10-10' }) startDate!: string;
  @ApiProperty({ example: '2026-10-12' }) endDate!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Travelling' }) reason!: string | null;
}

export class CommittedDateResponse {
  @ApiProperty({ example: 'ESK-TLT-1004' }) reference!: string;
  @ApiProperty({ example: '2026-10-02' }) startDate!: string;
  @ApiProperty({ example: '2026-10-03' }) endDate!: string;
  @ApiProperty({ example: 'BOOKING_CONFIRMED' }) status!: string;
}

export class TalentAvailabilityResponse {
  @ApiProperty({ enum: Weekday, isArray: true }) workingDays!: Weekday[];
  @ApiPropertyOptional({ enum: TalentDayType, nullable: true }) dayType!: TalentDayType | null;
  @ApiProperty({ example: true }) isAvailableForHire!: boolean;
  @ApiProperty({ type: [BlockedDateResponse], description: '"Blocked" on the calendar.' })
  blockedDates!: BlockedDateResponse[];
  @ApiProperty({
    type: [CommittedDateResponse],
    description: '"Rented" on the calendar — engagements you are hired for.',
  })
  booked!: CommittedDateResponse[];
}
