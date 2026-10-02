import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  ConflictException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { AdminTier, FeatureTier, ListingStatus, Prisma, VerificationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import { CurrentUser } from '../../auth/auth.decorators';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { talentAvatarUrl } from '../../talent/talent-media';
import { AdminAccess } from '../core/admin-access';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise } from '../core/admin-format';

const CONTENT_KINDS = ['EQUIPMENT', 'TALENT'] as const;
type ContentKind = (typeof CONTENT_KINDS)[number];

export class ContentQuery {
  @ApiPropertyOptional({ enum: CONTENT_KINDS, default: 'EQUIPMENT' })
  @IsOptional()
  @IsIn(CONTENT_KINDS)
  kind?: ContentKind;

  @ApiPropertyOptional({ description: 'Candidates only: search by name.', example: 'Sony' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}

export class ContentItemResponse {
  @ApiProperty({ format: 'uuid', description: 'Listing id or talent profile id.' }) id!: string;
  @ApiProperty({ enum: CONTENT_KINDS, example: 'EQUIPMENT' }) kind!: ContentKind;
  @ApiProperty({ example: 'Sony FX3 Cinema Camera' }) name!: string;
  @ApiProperty({ example: 'Cameras · Afro Studio' }) subtitle!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'https://res.cloudinary.com/eskista/image/upload/v1790000000/listings/sony-fx3.jpg',
  })
  imageUrl!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    enum: FeatureTier,
    example: FeatureTier.FEATURED,
    description: 'Null is Standard.',
  })
  tier!: FeatureTier | null;
  @ApiProperty({ example: 'Featured' }) tierLabel!: string;
  @ApiProperty({ example: 0, description: 'Pinned position; lower comes first.' })
  sortOrder!: number;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-28T07:30:00.000Z' }) featuredAt!:
    string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-31T21:00:00.000Z',
    description: 'Promotion ends after this.',
  })
  featuredUntil!: string | null;
  @ApiProperty({ example: 4.8 }) rating!: number;
  @ApiProperty({ example: 11 }) bookings!: number;
}

export class FeatureDto {
  @ApiProperty({
    enum: FeatureTier,
    example: FeatureTier.SPOTLIGHT,
    description: 'Featured, Highlighted or Spotlight.',
  })
  @IsEnum(FeatureTier)
  tier!: FeatureTier;

  @ApiPropertyOptional({
    description: 'Stop promoting after this date.',
    example: '2026-10-31T21:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  until?: string;

  @ApiPropertyOptional({ description: '"Pin": lower comes first.', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class PinOrderDto {
  @ApiProperty({ enum: CONTENT_KINDS, example: 'EQUIPMENT' })
  @IsIn(CONTENT_KINDS)
  kind!: ContentKind;

  @ApiProperty({
    type: [String],
    description: 'Promoted items in the order they should appear.',
    example: ['5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', '9c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'],
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

/**
 * Marketplace Content: what is promoted on the website hero grid and in the Telegram
 * booking bot. A listing or talent is Featured, Highlighted, Spotlight — or Standard, which
 * is no tier at all. Only live items can be promoted.
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async featured(kind: ContentKind): Promise<ContentItemResponse[]> {
    return kind === 'TALENT'
      ? this.talentItems({ featureTier: { not: null } })
      : this.listingItems({ featureTier: { not: null } });
  }

  async candidates(kind: ContentKind, q?: string): Promise<ContentItemResponse[]> {
    if (kind === 'TALENT') {
      return this.talentItems(
        {
          featureTier: null,
          status: VerificationStatus.VERIFIED,
          ...(q ? { displayName: { contains: q, mode: 'insensitive' } } : {}),
        },
        30,
      );
    }
    return this.listingItems(
      {
        featureTier: null,
        status: ListingStatus.PUBLISHED,
        vendor: { status: VerificationStatus.VERIFIED },
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      30,
    );
  }

  async featureListing(
    adminId: string,
    id: string,
    dto: FeatureDto,
  ): Promise<ContentItemResponse[]> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: { vendor: { select: { userId: true } } },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== ListingStatus.PUBLISHED)
      throw new ConflictException('Only a published listing can be promoted');
    const wasTier = listing.featureTier;
    await this.prisma.listing.update({
      where: { id },
      data: {
        featureTier: dto.tier,
        isFeatured: true,
        featuredAt: listing.featuredAt ?? new Date(),
        featuredUntil: dto.until ? new Date(dto.until) : null,
        ...(dto.sortOrder !== undefined ? { featureSortOrder: dto.sortOrder } : {}),
      },
    });
    if (!wasTier) {
      await this.notifications.send(listing.vendor.userId, 'LISTING_FEATURED', {
        item: listing.name,
        tier: humanise(dto.tier),
      });
    }
    await this.audit.record(adminId, 'content.feature', 'Listing', id, { tier: wasTier }, dto);
    return this.featured('EQUIPMENT');
  }

  async unfeatureListing(adminId: string, id: string): Promise<ContentItemResponse[]> {
    const { count } = await this.prisma.listing.updateMany({
      where: { id },
      data: {
        featureTier: null,
        isFeatured: false,
        featuredAt: null,
        featuredUntil: null,
        featureSortOrder: 0,
      },
    });
    if (count === 0) throw new NotFoundException('Listing not found');
    await this.audit.record(adminId, 'content.unfeature', 'Listing', id);
    return this.featured('EQUIPMENT');
  }

  async featureTalent(
    adminId: string,
    id: string,
    dto: FeatureDto,
  ): Promise<ContentItemResponse[]> {
    const talent = await this.prisma.talentProfile.findUnique({ where: { id } });
    if (!talent) throw new NotFoundException('Talent not found');
    if (talent.status !== VerificationStatus.VERIFIED)
      throw new ConflictException('Only a verified talent can be promoted');
    await this.prisma.talentProfile.update({
      where: { id },
      data: {
        featureTier: dto.tier,
        featuredAt: talent.featuredAt ?? new Date(),
        featuredUntil: dto.until ? new Date(dto.until) : null,
        ...(dto.sortOrder !== undefined ? { featureSortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record(
      adminId,
      'content.feature',
      'TalentProfile',
      id,
      { tier: talent.featureTier },
      dto,
    );
    return this.featured('TALENT');
  }

  async unfeatureTalent(adminId: string, id: string): Promise<ContentItemResponse[]> {
    const { count } = await this.prisma.talentProfile.updateMany({
      where: { id },
      data: { featureTier: null, featuredAt: null, featuredUntil: null, featureSortOrder: 0 },
    });
    if (count === 0) throw new NotFoundException('Talent not found');
    await this.audit.record(adminId, 'content.unfeature', 'TalentProfile', id);
    return this.featured('TALENT');
  }

  /** Pin: the order featured items appear in, across tiers. */
  async pin(adminId: string, dto: PinOrderDto): Promise<ContentItemResponse[]> {
    // Only promoted items have a place in the pinned order.
    const promoted =
      dto.kind === 'TALENT'
        ? await this.prisma.talentProfile.count({
            where: { id: { in: dto.ids }, featureTier: { not: null } },
          })
        : await this.prisma.listing.count({
            where: { id: { in: dto.ids }, featureTier: { not: null } },
          });
    if (promoted !== dto.ids.length) {
      throw new BadRequestException('Every id must be a promoted item of this kind');
    }
    if (dto.kind === 'TALENT') {
      await this.prisma.$transaction(
        dto.ids.map((id, index) =>
          this.prisma.talentProfile.update({ where: { id }, data: { featureSortOrder: index } }),
        ),
      );
    } else {
      await this.prisma.$transaction(
        dto.ids.map((id, index) =>
          this.prisma.listing.update({ where: { id }, data: { featureSortOrder: index } }),
        ),
      );
    }
    await this.audit.record(adminId, 'content.pin', dto.kind, 'featured', undefined, {
      ids: dto.ids,
    });
    return this.featured(dto.kind);
  }

  private async listingItems(
    where: Prisma.ListingWhereInput,
    take = 200,
  ): Promise<ContentItemResponse[]> {
    const rows = await this.prisma.listing.findMany({
      where,
      include: {
        vendor: { select: { businessName: true } },
        category: { select: { name: true } },
        images: { where: { isPrimary: true }, take: 1 },
      },
      orderBy: [{ featureSortOrder: 'asc' }, { featuredAt: 'desc' }, { publishedAt: 'desc' }],
      take,
    });
    return rows.map((l) => ({
      id: l.id,
      kind: 'EQUIPMENT' as const,
      name: l.name,
      subtitle: `${l.category.name} · ${l.vendor.businessName}`,
      imageUrl: l.images[0] ? this.storage.urlFor(l.images[0].fileKey) : null,
      tier: l.featureTier,
      tierLabel: l.featureTier ? humanise(l.featureTier) : 'Standard',
      sortOrder: l.featureSortOrder,
      featuredAt: l.featuredAt?.toISOString() ?? null,
      featuredUntil: l.featuredUntil?.toISOString() ?? null,
      rating: Number(l.ratingAvg),
      bookings: l.bookingCount,
    }));
  }

  private async talentItems(
    where: Prisma.TalentProfileWhereInput,
    take = 200,
  ): Promise<ContentItemResponse[]> {
    const rows = await this.prisma.talentProfile.findMany({
      where,
      include: { user: { select: { image: true } } },
      orderBy: [{ featureSortOrder: 'asc' }, { featuredAt: 'desc' }, { ratingAvg: 'desc' }],
      take,
    });
    return rows.map((t) => ({
      id: t.id,
      kind: 'TALENT' as const,
      name: t.displayName,
      subtitle: [t.professions[0], t.location].filter(Boolean).join(' · '),
      imageUrl: talentAvatarUrl(t, this.storage),
      tier: t.featureTier,
      tierLabel: t.featureTier ? humanise(t.featureTier) : 'Standard',
      sortOrder: t.featureSortOrder,
      featuredAt: t.featuredAt?.toISOString() ?? null,
      featuredUntil: t.featuredUntil?.toISOString() ?? null,
      rating: Number(t.ratingAvg),
      bookings: t.completedBookings,
    }));
  }
}

@ApiTags('admin · marketplace content')
@AdminAccess()
@Controller({ path: 'admin/content', version: '1' })
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get('featured')
  @ApiEndpoint({
    summary: 'Marketplace Content — what is promoted',
    does: 'Featured, Highlighted and Spotlight items, in pinned order. What is promoted on the website hero grid and the Telegram booking bot.',
    behind: [
      'Read only. Promoted listings of verified vendors, or verified talents with a feature tier.',
    ],
  })
  @ApiOkResponse({ type: [ContentItemResponse] })
  @ApiStandardErrors({ badRequest: 'Unknown `kind`.' })
  featured(@Query() query: ContentQuery): Promise<ContentItemResponse[]> {
    return this.content.featured(query.kind ?? 'EQUIPMENT');
  }

  @Get('candidates')
  @ApiEndpoint({
    summary: 'Add — live items not yet promoted',
    does: 'Published equipment of verified vendors, or verified talent, that have no feature tier. Up to 30; search with `q`.',
    behind: ['Read only.'],
  })
  @ApiOkResponse({ type: [ContentItemResponse] })
  @ApiStandardErrors({ badRequest: 'Unknown `kind`.' })
  candidates(@Query() query: ContentQuery): Promise<ContentItemResponse[]> {
    return this.content.candidates(query.kind ?? 'EQUIPMENT', query.q);
  }

  @Put('featured/listings/:id')
  @ApiEndpoint({
    summary: 'Promote equipment, or change its tier',
    does: "Sets the listing's tier to Featured, Highlighted or Spotlight. The vendor is told the first time.",
    behind: [
      'Listing: `featureTier`, `featuredAt`, optional `featuredUntil` and `sortOrder` set.',
      'Notification (first promote only): vendor — Listing Featured.',
      'Admin audit log written.',
    ],
    seenBy: [
      'Vendor: "Your listing has been featured".',
      'Customers: the listing appears on the hero grid.',
    ],
    rules: ['404 when not found.', '409 when the listing is not published.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam({ name: 'id', format: 'uuid', description: 'The listing id.' })
  @ApiOkResponse({ type: [ContentItemResponse] })
  @ApiStandardErrors({
    notFound: 'Listing not found',
    conflict: 'Only a published listing can be promoted',
  })
  featureListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeatureDto,
  ): Promise<ContentItemResponse[]> {
    return this.content.featureListing(adminId, id, dto);
  }

  @Delete('featured/listings/:id')
  @ApiEndpoint({
    summary: 'Remove — back to Standard',
    does: 'Clears the feature tier and the pinned order.',
    behind: ['Listing: feature tier, dates and sort order cleared.', 'Admin audit log written.'],
    rules: ['404 when not found.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam({ name: 'id', format: 'uuid', description: 'The listing id.' })
  @ApiOkResponse({ type: [ContentItemResponse] })
  @ApiStandardErrors({ notFound: 'Listing not found' })
  unfeatureListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentItemResponse[]> {
    return this.content.unfeatureListing(adminId, id);
  }

  @Put('featured/talent/:id')
  @ApiEndpoint({
    summary: 'Promote a talent, or change their tier',
    does: "Sets the talent's tier to Featured, Highlighted or Spotlight.",
    behind: [
      'Talent profile: `featureTier`, `featuredAt`, optional `featuredUntil` and `sortOrder` set.',
      'Admin audit log written.',
    ],
    rules: ['404 when not found.', '409 when the talent is not verified.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam({ name: 'id', format: 'uuid', description: 'The talent profile id.' })
  @ApiOkResponse({ type: [ContentItemResponse] })
  @ApiStandardErrors({
    notFound: 'Talent not found',
    conflict: 'Only a verified talent can be promoted',
  })
  featureTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeatureDto,
  ): Promise<ContentItemResponse[]> {
    return this.content.featureTalent(adminId, id, dto);
  }

  @Delete('featured/talent/:id')
  @ApiEndpoint({
    summary: 'Remove a talent — back to Standard',
    does: 'Clears the feature tier and the pinned order.',
    behind: [
      'Talent profile: feature tier, dates and sort order cleared.',
      'Admin audit log written.',
    ],
    rules: ['404 when not found.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam({ name: 'id', format: 'uuid', description: 'The talent profile id.' })
  @ApiOkResponse({ type: [ContentItemResponse] })
  @ApiStandardErrors({ notFound: 'Talent not found' })
  unfeatureTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentItemResponse[]> {
    return this.content.unfeatureTalent(adminId, id);
  }

  @Put('featured/order')
  @ApiEndpoint({
    summary: 'Pin — the order promoted items appear in',
    does: 'Send the ids in the order they should appear. Only promoted items are accepted.',
    behind: ['Sort order rewritten for each id. Admin audit log written.'],
    rules: ['400 when an id is not a promoted item of this kind.'],
  })
  @AdminAccess(AdminTier.ADMIN)
  @ApiOkResponse({ type: [ContentItemResponse] })
  @ApiStandardErrors({ badRequest: 'Every id must be a promoted item of this kind' })
  pin(
    @CurrentUser('id') adminId: string,
    @Body() dto: PinOrderDto,
  ): Promise<ContentItemResponse[]> {
    return this.content.pin(adminId, dto);
  }
}
