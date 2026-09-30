import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { CategoryKind, ListingStatus, UnitCustody } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { CreateEquipmentDto, UpdateUnitDto } from '../../equipment/dto/equipment.dto';
import { InspectionResponse } from '../inspections/dto/inspection.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const UNIT_STATES = [
  'AVAILABLE',
  'RESERVED',
  'RENTED',
  'RETURNED',
  'IN_QA',
  'RETIRED',
] as const;
export type UnitState = (typeof UNIT_STATES)[number];

export class AdminUnitsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    enum: UNIT_STATES,
    description: 'Available / Rented / Returned / Needs Attention…',
  })
  @IsOptional()
  @IsIn(UNIT_STATES)
  state?: UnitState;

  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;

  @ApiPropertyOptional({ description: 'Unit label, serial, equipment or vendor.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;
}

export class AdminListingsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;
}

export class AdminUpdateUnitDto extends UpdateUnitDto {
  @ApiPropertyOptional({ enum: UnitCustody, description: 'Correct where the unit is.' })
  @IsOptional()
  @IsEnum(UnitCustody)
  custody?: UnitCustody;
}

export class AdminCreateEquipmentDto extends CreateEquipmentDto {
  @ApiProperty({
    description: 'The vendor who owns the gear (from /admin/vendors).',
    example: '3f1a2b3c-4d5e-4f6a-8b9c-0d1e2f3a4b5c',
  })
  @IsUUID()
  vendorId!: string;
}

export class SuspendListingDto {
  @ApiPropertyOptional({ example: 'Reported faulty; under inspection' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  reason?: string;
}

// ── Categories ───────────────────────────────────────────────────────────────

export class AdminCategoriesQuery {
  @ApiPropertyOptional({ enum: CategoryKind, default: CategoryKind.EQUIPMENT })
  @IsOptional()
  @IsEnum(CategoryKind)
  kind?: CategoryKind;

  @ApiPropertyOptional({ description: 'Include hidden categories. Defaults to true.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'false' ? false : value === 'true' ? true : value,
  )
  @IsBoolean()
  includeHidden?: boolean;
}

export class CategoryDto {
  @ApiProperty({ enum: CategoryKind, example: CategoryKind.EQUIPMENT })
  @IsEnum(CategoryKind)
  kind!: CategoryKind;

  @ApiProperty({ example: 'Cinema Cameras' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({
    example: 'cinema-cameras',
    description: 'Derived from the name when omitted.',
  })
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lower-case words joined by hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({ description: 'Internal description, for admins.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Colour grading', 'Drone operation'],
    description: 'Talent categories: the specializations and skills offered to talents.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: 'A parent, making this a subcategory.' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: '"Publicly Visible".', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Cross-Marketplace Associations: categories suggested alongside this one, in order.',
    example: ['9c2d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  associationIds?: string[];
}

export class UpdateCategoryDto extends PartialType(OmitType(CategoryDto, ['kind'] as const)) {}

export class ReorderCategoriesDto {
  @ApiProperty({
    type: [String],
    description: 'Every category of the kind, in the new order.',
    example: ['5a1b…', '9c2d…', '0e3f…'],
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class MoveCategoryDto {
  @ApiProperty({ enum: ['UP', 'DOWN'], example: 'UP' })
  @IsIn(['UP', 'DOWN'])
  direction!: 'UP' | 'DOWN';
}

// ── Responses ────────────────────────────────────────────────────────────────

export class EquipmentKpisResponse {
  @ApiProperty({ example: 64, description: 'Units in service across every vendor.' })
  totalUnits!: number;
  @ApiProperty({ example: 41, description: 'Free, or held for an upcoming rental.' })
  available!: number;
  @ApiProperty({ example: 8, description: 'Out with a customer.' }) onRental!: number;
  @ApiProperty({
    example: 3,
    description: 'Back and awaiting inspection, in maintenance, or graded Damaged.',
  })
  needsAttention!: number;
}

export class NamedRefResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Afro Studio' }) name!: string;
}

export class UnitRowResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'FX3-002' }) label!: string;
  @ApiPropertyOptional({ nullable: true, example: 'SNY-FX3-2291' }) serialNumber!: string | null;
  @ApiProperty({ format: 'uuid' }) listingId!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) equipmentName!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ type: NamedRefResponse }) vendor!: NamedRefResponse;
  @ApiProperty({ example: 'Cameras' }) category!: string;
  @ApiProperty({ enum: UNIT_STATES, example: 'RENTED' }) state!: UnitState;
  @ApiProperty({ example: 'Rented' }) stateLabel!: string;
  @ApiProperty({ enum: ['AVAILABLE', 'MAINTENANCE', 'RETIRED'], example: 'AVAILABLE' })
  unitStatus!: string;
  @ApiProperty({ enum: UnitCustody, example: UnitCustody.CLIENT }) custody!: UnitCustody;
  @ApiPropertyOptional({ nullable: true, example: 'EXCELLENT' }) grade!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Excellent' }) gradeLabel!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-27T08:30:00.000Z' }) lastInspectedAt!:
    string | null;
  @ApiProperty({ example: 300_000, description: "The vendor's rate per period." })
  dailyRateMinor!: number;
  @ApiProperty({ example: 396_750, description: 'What a customer pays per period, VAT included.' })
  customerRateMinor!: number;
  @ApiProperty({ enum: ['HOUR', 'DAY', 'WEEK', 'MONTH'], example: 'DAY' }) periodUnit!: string;
  @ApiPropertyOptional({ nullable: true, example: 'ESK-10485' }) currentBooking!: string | null;
}

export class UnitSpecResponse {
  @ApiPropertyOptional({ nullable: true, example: 'Video' }) group!: string | null;
  @ApiProperty({ example: 'Max resolution' }) label!: string;
  @ApiProperty({ example: '4K 120p' }) value!: string;
}

export class UnitIncludedItemResponse {
  @ApiProperty({ enum: ['EQUIPMENT', 'ACCESSORY'], example: 'ACCESSORY' }) kind!: string;
  @ApiProperty({ example: 'NP-FZ100 battery' }) name!: string;
  @ApiProperty({ example: 2 }) quantity!: number;
}

export class UnitMediaResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'https://res.cloudinary.com/…/listings/…/fx3.jpg' }) url!: string;
  @ApiProperty({ example: true }) isPrimary!: boolean;
}

export class UnitVendorResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Afro Studio' }) businessName!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911000002' }) phone!: string | null;
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
}

export class UnitOverviewResponse {
  @ApiProperty({ example: 'Full-frame cinema camera, 4K 120p, dual base ISO.' })
  description!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Sony' }) brand!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'FX3' }) model!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Full-frame 12.1MP, 4K 120p' })
  mainSpecification!: string | null;
  @ApiProperty({ type: [UnitSpecResponse] }) specs!: UnitSpecResponse[];
  @ApiProperty({ type: [UnitIncludedItemResponse] }) included!: UnitIncludedItemResponse[];
  @ApiProperty({ type: [UnitMediaResponse] }) media!: UnitMediaResponse[];
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
  @ApiPropertyOptional({ nullable: true, example: 500_000 }) securityDepositMinor!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 25_000_000 }) replacementValueMinor!:
    number | null;
  @ApiProperty({ enum: ListingStatus, example: ListingStatus.PUBLISHED })
  listingStatus!: ListingStatus;
  @ApiPropertyOptional({ nullable: true, enum: ['FEATURED', 'HIGHLIGHTED', 'SPOTLIGHT'] })
  featureTier!: string | null;
  @ApiProperty({ type: UnitVendorResponse }) vendor!: UnitVendorResponse;
  @ApiPropertyOptional({ nullable: true }) conditionNotes!: string | null;
  @ApiPropertyOptional({ nullable: true }) acquiredAt!: string | null;
}

export class UnitRentalResponse {
  @ApiProperty({ example: 'ESK-10485' }) reference!: string;
  @ApiProperty({ example: 'IN_PROGRESS' }) status!: string;
  @ApiProperty({ example: 'Yoseph Alemu' }) customer!: string;
  @ApiProperty({ example: '2026-09-26' }) startDate!: string;
  @ApiProperty({ example: '2026-09-29' }) endDate!: string;
}

export class UnitBlockResponse {
  @ApiProperty({ example: '2026-10-10' }) startDate!: string;
  @ApiProperty({ example: '2026-10-12' }) endDate!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Vendor using it for their own shoot' }) reason!:
    string | null;
  @ApiProperty({ example: false, description: 'True when the vendor blocked the whole listing.' })
  wholeListing!: boolean;
}

export class UnitRentalsResponse {
  @ApiPropertyOptional({
    type: UnitRentalResponse,
    nullable: true,
    description: 'Out now, or back awaiting inspection.',
  })
  active!: UnitRentalResponse | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Unit is currently in the Hub Vault',
    description: 'Shown when nothing is out.',
  })
  message!: string | null;
  @ApiProperty({ type: [UnitRentalResponse] }) upcoming!: UnitRentalResponse[];
  @ApiProperty({ type: [UnitBlockResponse], description: 'For the availability calendar.' })
  blocked!: UnitBlockResponse[];
}

export class UnitDetailResponse extends UnitRowResponse {
  @ApiProperty({ type: UnitOverviewResponse, description: 'Overview & Specs tab.' })
  overview!: UnitOverviewResponse;
  @ApiPropertyOptional({
    type: InspectionResponse,
    nullable: true,
    description: 'Manual Inspection tab.',
  })
  latestInspection!: InspectionResponse | null;
  @ApiProperty({ type: UnitRentalsResponse, description: 'Rental Bookings tab.' })
  rentals!: UnitRentalsResponse;
  @ApiProperty({ type: [InspectionResponse], description: 'Condition History tab, newest first.' })
  conditionHistory!: InspectionResponse[];
}

export class ListingAdminRowResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) name!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ type: NamedRefResponse }) vendor!: NamedRefResponse;
  @ApiProperty({ example: 'Cameras' }) category!: string;
  @ApiProperty({ enum: ListingStatus, example: ListingStatus.PUBLISHED }) status!: ListingStatus;
  @ApiProperty({ example: 'Published' }) statusLabel!: string;
  @ApiProperty({ example: 300_000 }) rentalPriceMinor!: number;
  @ApiProperty({ example: 396_750, description: 'Commission and VAT added.' })
  customerPriceMinor!: number;
  @ApiProperty({ enum: ['HOUR', 'DAY', 'WEEK', 'MONTH'], example: 'DAY' }) periodUnit!: string;
  @ApiProperty({ example: 2 }) units!: number;
  @ApiProperty({ example: 11 }) bookings!: number;
  @ApiPropertyOptional({ nullable: true, enum: ['FEATURED', 'HIGHLIGHTED', 'SPOTLIGHT'] })
  featureTier!: string | null;
  @ApiProperty({ example: 4.7 }) rating!: number;
  @ApiProperty() updatedAt!: string;
}

export class CategoryRefResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Lenses' }) name!: string;
  @ApiProperty({ enum: CategoryKind, example: CategoryKind.EQUIPMENT }) kind!: CategoryKind;
  @ApiProperty({ example: 'lenses' }) slug!: string;
}

export class CategoryParentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Cameras' }) name!: string;
}

export class CategoryCountsResponse {
  @ApiProperty({ example: 14 }) units!: number;
  @ApiProperty({ example: 10 }) available!: number;
  @ApiProperty({ example: 3 }) onRental!: number;
  @ApiProperty({ example: 1, description: 'In QA / maintenance.' }) inQa!: number;
  @ApiProperty({ example: 0, description: 'Talent categories: talents offering a service in it.' })
  talents!: number;
}

export class AdminCategoryResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CategoryKind, example: CategoryKind.EQUIPMENT }) kind!: CategoryKind;
  @ApiProperty({ example: 'Cameras' }) name!: string;
  @ApiProperty({ example: 'cameras' }) slug!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Cinema and mirrorless bodies.',
    description: 'Internal description.',
  })
  description!: string | null;
  @ApiProperty({
    type: [String],
    example: [],
    description: 'Talent categories: specializations & skills.',
  })
  skills!: string[];
  @ApiPropertyOptional({ nullable: true }) thumbnailUrl!: string | null;
  @ApiPropertyOptional({ type: CategoryParentResponse, nullable: true })
  parent!: CategoryParentResponse | null;
  @ApiProperty({ example: 2 }) subcategoryCount!: number;
  @ApiProperty({ example: 0, description: 'Display position.' }) sortOrder!: number;
  @ApiProperty({ example: true }) isPubliclyVisible!: boolean;
  @ApiProperty({ example: 9 }) listingCount!: number;
  @ApiProperty({ example: 0 }) serviceCount!: number;
  @ApiPropertyOptional({ type: CategoryCountsResponse, nullable: true })
  counts!: CategoryCountsResponse | null;
  @ApiProperty({
    type: [CategoryRefResponse],
    description: 'Cross-Marketplace Associations, in order.',
  })
  associations!: CategoryRefResponse[];
  @ApiProperty() updatedAt!: string;
}

export class CategoryDeleteResponse {
  @ApiProperty({
    example: false,
    description: 'False when equipment or services still use it: it was hidden instead of deleted.',
  })
  deleted!: boolean;
}
