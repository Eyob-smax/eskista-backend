import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ConditionGrade,
  ExperienceLevel,
  IncludedItemKind,
  PricingModel,
  RentalPeriodUnit,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorPaginationQuery } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toBool = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

/** `YYYY-MM-DD`, validated here so a malformed date never reaches a query. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export const EQUIPMENT_SORTS = [
  'relevance',
  'priceAsc',
  'priceDesc',
  'rating',
  'popular',
  'newest',
] as const;
export type EquipmentSort = (typeof EQUIPMENT_SORTS)[number];

export class BrowseEquipmentQuery extends CursorPaginationQuery {
  @ApiPropertyOptional({
    description: 'Free-text search across name, brand, model and description.',
    example: 'cinema camera',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter by category id. Take these from `GET /catalogue/categories`.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Filter by category slug — friendlier for deep links than the id.',
    example: 'cameras',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  categorySlug?: string;

  @ApiPropertyOptional({
    description: 'Lowest acceptable price per period, in minor units (ETB cents).',
    example: 100000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceMinor?: number;

  @ApiPropertyOptional({
    description: 'Highest acceptable price per period, in minor units (ETB cents).',
    example: 500000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceMinor?: number;

  @ApiPropertyOptional({ description: 'Partial match on the pickup location.', example: 'Bole' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  location?: string;

  @ApiPropertyOptional({
    description:
      'Only items free for this whole range. Requires `availableTo`. Use this when the ' +
      'customer has already picked dates, so nothing unbookable is shown.',
    example: '2026-08-18',
  })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'availableFrom must be YYYY-MM-DD' })
  availableFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-21' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'availableTo must be YYYY-MM-DD' })
  availableTo?: string;

  @ApiPropertyOptional({ description: 'Only items flagged for the Featured rail.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({
    enum: EQUIPMENT_SORTS,
    default: 'relevance',
    description:
      '`relevance` ranks featured and well-reviewed items first, and is the sensible ' +
      'default for both Home and Explore.',
  })
  @IsOptional()
  @IsIn(EQUIPMENT_SORTS)
  sort: EquipmentSort = 'relevance';
}

export const TALENT_SORTS = ['relevance', 'priceAsc', 'priceDesc', 'rating', 'popular'] as const;
export type TalentSort = (typeof TALENT_SORTS)[number];

export class BrowseTalentQuery extends CursorPaginationQuery {
  @ApiPropertyOptional({
    description: 'Free-text search across name, headline, bio and specializations.',
    example: 'cinematographer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Talent category id.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'cinematographers' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  categorySlug?: string;

  @ApiPropertyOptional({
    description:
      'Match talent practising any one of these professions. Skills were merged into ' +
      'profession in the September 2026 review, so this is the only discipline filter.',
    example: ['Cinematographer', 'Editor'],
    type: [String],
  })
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()) : value,
  )
  professions?: string[];

  @ApiPropertyOptional({ enum: ExperienceLevel })
  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevel?: ExperienceLevel;

  @ApiPropertyOptional({ example: 'Addis Ababa' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  location?: string;

  @ApiPropertyOptional({ example: 60000, description: 'Lowest day rate, in minor units.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceMinor?: number;

  @ApiPropertyOptional({ example: 500000, description: 'Highest day rate, in minor units.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceMinor?: number;

  @ApiPropertyOptional({ enum: TALENT_SORTS, default: 'relevance' })
  @IsOptional()
  @IsIn(TALENT_SORTS)
  sort: TalentSort = 'relevance';
}

export class AvailabilityRangeQuery {
  @ApiProperty({ example: '2026-08-01', description: 'First day to report, inclusive.' })
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @ApiProperty({
    example: '2026-08-31',
    description: 'Last day to report, inclusive. At most 190 days after `from`.',
  })
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to!: string;
}

export class QuoteQuery {
  @ApiProperty({ example: '2026-08-18' })
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @ApiProperty({ example: '2026-08-21' })
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number = 1;

  @ApiPropertyOptional({
    enum: ['DELIVERY', 'PICKUP'],
    default: 'DELIVERY',
    description: 'PICKUP drops the delivery fee from the quote.',
  })
  @IsOptional()
  @IsIn(['DELIVERY', 'PICKUP'])
  collectionMethod: 'DELIVERY' | 'PICKUP' = 'DELIVERY';
}

// ─────────────────────────────────────────────────────────────────────────────
// Responses
// ─────────────────────────────────────────────────────────────────────────────

export class CategoryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'cameras' })
  slug!: string;

  @ApiProperty({ example: 'Cameras' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: '/api/v1/files/categories/cameras.jpg' })
  imageUrl!: string | null;

  @ApiProperty({
    description:
      'Published listings (or verified talent) in this category. Use it to hide empties.',
    example: 24,
  })
  itemCount!: number;
}

export class CatalogueVendorResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ethiopian Visuals' })
  businessName!: string;

  @ApiPropertyOptional({ nullable: true })
  logoUrl!: string | null;

  @ApiProperty({ example: 'Addis Ababa' })
  location!: string;

  @ApiProperty({
    description: 'Always true in the catalogue — unverified vendors are never listed.',
    example: true,
  })
  isVerified!: boolean;

  @ApiProperty({ example: 4.6 })
  ratingAvg!: number;

  @ApiProperty({ example: 38 })
  ratingCount!: number;
}

export class CatalogueReviewResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'Shortened for privacy, as the design shows ("Selam T.").',
    example: 'Selam T.',
  })
  authorName!: string;

  @ApiProperty({ example: 5 })
  rating!: number;

  @ApiPropertyOptional({ nullable: true, example: 'Delivered exactly as described.' })
  comment!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'What the booking was for, shown under the reviewer name.',
    example: 'Commercial production',
  })
  projectType!: string | null;

  @ApiProperty({ example: '2026-08-22T10:00:00.000Z' })
  createdAt!: string;
}

export class EquipmentCardResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Sony FX3 Cinema Camera' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Sony' })
  brand!: string | null;

  @ApiProperty({
    example: 'Ethiopian Visuals',
    description: 'Shown above the item name on a card.',
  })
  vendorName!: string;

  @ApiProperty({ example: 'Cameras' })
  categoryName!: string;

  @ApiPropertyOptional({ nullable: true })
  imageUrl!: string | null;

  @ApiProperty({
    example: 396750,
    description:
      'What the **customer** pays per period, in minor units: the supplier’s own price ' +
      'plus Eskista’s commission plus VAT. Show this with the "Inc. 15% VAT" subtext.',
  })
  pricePerPeriodMinor!: number;

  @ApiProperty({
    description:
      'Always true. Present so the card can render the "VAT Inclusive" badge the client ' +
      'asked for without hardcoding the assumption.',
    example: true,
  })
  priceIncludesVat!: boolean;

  @ApiProperty({ enum: RentalPeriodUnit, example: RentalPeriodUnit.DAY })
  periodUnit!: RentalPeriodUnit;

  @ApiProperty({ example: 'ETB' })
  currency!: string;

  @ApiProperty({ example: 4.4 })
  ratingAvg!: number;

  @ApiProperty({ example: 61 })
  ratingCount!: number;

  @ApiProperty({
    enum: ['AVAILABLE', 'BOOKED'],
    description:
      'The badge on the card. Derived from whether a confirmed booking covers **today** — ' +
      'it is not a promise about any future date. Check `/availability` before booking.',
    example: 'AVAILABLE',
  })
  availabilityToday!: 'AVAILABLE' | 'BOOKED';

  @ApiProperty({ example: 'Addis Ababa' })
  location!: string;

  @ApiProperty({ example: false })
  isFeatured!: boolean;
}

export class EquipmentSpecResponse {
  @ApiPropertyOptional({ nullable: true, example: 'Sensor' })
  group!: string | null;

  @ApiProperty({ example: 'Mount' })
  label!: string;

  @ApiProperty({ example: 'E / EF-mount' })
  value!: string;
}

export class EquipmentIncludedItemResponse {
  @ApiProperty({ enum: IncludedItemKind })
  kind!: IncludedItemKind;

  @ApiProperty({ example: '2x NP-FZ100 Batteries' })
  name!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;
}

export class EquipmentDetailResponse extends EquipmentCardResponse {
  @ApiProperty({ type: [String], description: 'Every photo, main image first.' })
  imageUrls!: string[];

  @ApiProperty({ example: 'Versatile standard zoom with constant f/2.8 aperture.' })
  description!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Full-frame 10.2MP CMOS, 6K60 open gate' })
  mainSpecification!: string | null;

  @ApiProperty({ type: [EquipmentSpecResponse], description: 'Rendered as the spec chips.' })
  specs!: EquipmentSpecResponse[];

  @ApiProperty({ type: [EquipmentIncludedItemResponse] })
  includedItems!: EquipmentIncludedItemResponse[];

  @ApiProperty({ type: [String], example: ['E-mount', 'EF via adapter'] })
  compatibility!: string[];

  @ApiPropertyOptional({ nullable: true })
  powerBattery!: string | null;

  @ApiProperty({ enum: ConditionGrade })
  condition!: ConditionGrade;

  @ApiProperty({ example: 1, description: 'Shortest rental this vendor accepts.' })
  minRentalPeriods!: number;

  @ApiPropertyOptional({ nullable: true, example: 30 })
  maxRentalPeriods!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 400000,
    description: 'Refundable, and never part of the VAT base.',
  })
  securityDepositMinor!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 'Valid ID and a signed agreement required.' })
  rentalRequirements!: string | null;

  @ApiProperty({ type: CatalogueVendorResponse })
  vendor!: CatalogueVendorResponse;

  @ApiProperty({
    type: [EquipmentCardResponse],
    description: 'The "Related Accessories" rail.',
  })
  accessories!: EquipmentCardResponse[];

  @ApiProperty({ type: [CatalogueReviewResponse], description: 'Three most recent.' })
  reviews!: CatalogueReviewResponse[];
}

export class AvailabilityDayResponse {
  @ApiProperty({ example: '2026-08-18' })
  date!: string;

  @ApiProperty({
    enum: ['AVAILABLE', 'UNAVAILABLE'],
    description:
      'Deliberately only two states in the public catalogue. *Why* a day is unavailable — ' +
      'booked by someone else, or blocked by the vendor — is nobody else’s business.',
    example: 'AVAILABLE',
  })
  state!: 'AVAILABLE' | 'UNAVAILABLE';

  @ApiProperty({ example: 2, description: 'Units still free that day.' })
  unitsAvailable!: number;
}

export class QuoteLineResponse {
  @ApiProperty({
    example: 'RENTAL',
    enum: ['RENTAL', 'DELIVERY', 'DISCOUNT', 'SERVICE_FEE'],
    description: 'There is no VAT line: every amount here already includes it. See `taxMinor`.',
  })
  kind!: 'RENTAL' | 'DELIVERY' | 'DISCOUNT' | 'SERVICE_FEE';

  @ApiProperty({
    description: 'Ready to print, exactly as the design phrases it.',
    example: '3 days × ETB 3,500',
  })
  label!: string;

  @ApiProperty({ example: 1050000 })
  amountMinor!: number;
}

export class QuoteResponse {
  @ApiProperty({ example: '2026-08-18' })
  from!: string;

  @ApiProperty({ example: '2026-08-21' })
  to!: string;

  @ApiProperty({ example: 3, description: 'Billable periods, counted inclusively.' })
  periods!: number;

  @ApiProperty({ example: 1 })
  quantity!: number;

  @ApiProperty({ example: 'ETB' })
  currency!: string;

  @ApiProperty({
    type: [QuoteLineResponse],
    description:
      'Print these in order; zero-value lines are omitted. They sum exactly to ' +
      '`totalMinor`, because VAT is already inside each one rather than added after.',
  })
  lines!: QuoteLineResponse[];

  @ApiProperty({ example: 1050000 })
  subtotalMinor!: number;

  @ApiProperty({ example: 50000 })
  deliveryFeeMinor!: number;

  @ApiProperty({
    example: 143478,
    description:
      'The VAT **already contained** in `totalMinor`. Do not add it — every listed price ' +
      'on the platform is VAT-inclusive. Show it as subtext, not as a line in the sum.',
  })
  taxMinor!: number;

  @ApiProperty({ example: 1500, description: 'Basis points; 1500 = 15%.' })
  taxRateBps!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ready-made subtext for the badge the client asked for. Null when exempt.',
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
    description: 'Refundable on satisfactory return. Shown apart from the total.',
  })
  securityDepositMinor!: number;

  @ApiProperty({
    example: 1100000,
    description:
      'What the customer owes for the goods and services, VAT included. Excludes the ' +
      'refundable deposit. **Note:** the design sheets print a larger figure here ' +
      '(12,575 for this example) because they add VAT on top. Prices are VAT-inclusive, ' +
      'so that printed total is superseded.',
  })
  totalMinor!: number;

  @ApiProperty({
    example: 1500000,
    description:
      'What the customer actually transfers: `totalMinor` plus the refundable deposit. ' +
      'Use this on the payment screen and nowhere else.',
  })
  amountDueMinor!: number;

  @ApiProperty({
    description: 'False when the range is unavailable or breaks the vendor’s rental limits.',
    example: true,
  })
  isBookable!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Why it is not bookable. Empty when `isBookable` is true.',
    example: [],
  })
  blockers!: string[];
}

export class TalentServiceResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Full Day Commercial' })
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: PricingModel, example: PricingModel.PER_DAY })
  pricingModel!: PricingModel;

  @ApiProperty({
    example: 595125,
    description: 'Customer price for this service, commission and VAT included.',
  })
  priceMinor!: number;

  @ApiProperty({ example: 'ETB' })
  currency!: string;
}

export class PortfolioItemResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Commercial – Ethio Telecom' })
  title!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Who the work was produced for — the project-origin line under each piece.',
    example: 'Zeleman Productions',
  })
  clientOrAgency!: string | null;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Stored image, when one was uploaded.' })
  imageUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'External link, e.g. YouTube or Vimeo.' })
  externalUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Director of Photography' })
  role!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-16' })
  startDate!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-30' })
  endDate!: string | null;
}

export class TalentCardResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dawit Bekele' })
  displayName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The role shown under the name.',
    example: 'Cinematographer',
  })
  headline!: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ example: 'Lideta Kolfe, Addis Ababa' })
  location!: string;

  @ApiProperty({ example: 4.4 })
  ratingAvg!: number;

  @ApiProperty({ example: 61 })
  ratingCount!: number;

  @ApiProperty({ example: 36, description: 'Completed engagements — the "36 Bookings" figure.' })
  completedBookings!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 158700,
    description:
      'The day rate the **customer** pays — the talent’s own rate plus commission plus ' +
      'VAT — for the "1,587 ETB/Day" line. Fixed: there is no negotiation.',
  })
  baseRateMinor!: number | null;

  @ApiProperty({ description: 'Always true; drives the "VAT Inclusive" badge.', example: true })
  priceIncludesVat!: boolean;

  @ApiProperty({ enum: PricingModel, example: PricingModel.PER_DAY })
  pricingModel!: PricingModel;

  @ApiProperty({ example: 'ETB' })
  currency!: string;

  @ApiProperty({
    description: 'Drives the green dot and the "Available" chip.',
    example: true,
  })
  isAvailableForHire!: boolean;

  @ApiProperty({ enum: ExperienceLevel })
  experienceLevel!: ExperienceLevel;

  @ApiProperty({
    type: [String],
    description: 'One person may practise several. Replaces the old skills list.',
    example: ['Cinematographer', 'Editor'],
  })
  professions!: string[];
}

export class TalentDetailResponse extends TalentCardResponse {
  @ApiPropertyOptional({
    nullable: true,
    example: 'Award-winning cinematographer with eight years…',
  })
  bio!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 8 })
  yearsExperience!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A single line — the structured education section was removed.',
    example: 'BA Film Production, Addis Ababa University',
  })
  highestEducation!: string | null;

  @ApiProperty({ type: [String], example: ['Amharic', 'English'] })
  languages!: string[];

  @ApiProperty({ type: [String], example: ['Commercial', 'Music Video'] })
  specializations!: string[];

  @ApiProperty({ type: [String], example: ['DaVinci Resolve', 'Drone Operation'] })
  skills!: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'The public profile link, for Share.',
    example: 'https://eskista.com/talent/dawit-media',
  })
  profileUrl!: string | null;

  @ApiProperty({ type: [TalentServiceResponse], description: 'The "Services" price list.' })
  services!: TalentServiceResponse[];

  @ApiProperty({ type: [PortfolioItemResponse] })
  portfolio!: PortfolioItemResponse[];

  @ApiProperty({ type: [CatalogueReviewResponse] })
  reviews!: CatalogueReviewResponse[];
}

export class HomeResponse {
  @ApiProperty({ type: [CategoryResponse], description: 'The "Browse Categories" rail.' })
  categories!: CategoryResponse[];

  @ApiProperty({ type: [EquipmentCardResponse], description: '"Featured Equipment".' })
  featured!: EquipmentCardResponse[];

  @ApiProperty({
    type: [EquipmentCardResponse],
    description: '"Popular Equipments" — ordered by completed bookings.',
  })
  popular!: EquipmentCardResponse[];

  @ApiProperty({
    type: [TalentCardResponse],
    description: 'Backs the "Creative Professionals" promo strip.',
  })
  featuredTalent!: TalentCardResponse[];
}
