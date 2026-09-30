import {
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
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
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

  @ApiPropertyOptional({ description: 'Candidates only: search by name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}

export class FeatureDto {
  @ApiProperty({ enum: FeatureTier, description: 'Featured, Highlighted or Spotlight.' })
  @IsEnum(FeatureTier)
  tier!: FeatureTier;

  @ApiPropertyOptional({ description: 'Stop promoting after this date.' })
  @IsOptional()
  @IsDateString()
  until?: string;

  @ApiPropertyOptional({ description: '"Pin": lower comes first within the tier.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class PinOrderDto {
  @ApiProperty({ enum: CONTENT_KINDS })
  @IsIn(CONTENT_KINDS)
  kind!: ContentKind;

  @ApiProperty({ type: [String], description: 'Featured items in the order they should appear.' })
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

  async featured(kind: ContentKind): Promise<Record<string, unknown>[]> {
    return kind === 'TALENT'
      ? this.talentItems({ featureTier: { not: null } })
      : this.listingItems({ featureTier: { not: null } });
  }

  async candidates(kind: ContentKind, q?: string): Promise<Record<string, unknown>[]> {
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
  ): Promise<Record<string, unknown>[]> {
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

  async unfeatureListing(adminId: string, id: string): Promise<Record<string, unknown>[]> {
    await this.prisma.listing.update({
      where: { id },
      data: {
        featureTier: null,
        isFeatured: false,
        featuredAt: null,
        featuredUntil: null,
        featureSortOrder: 0,
      },
    });
    await this.audit.record(adminId, 'content.unfeature', 'Listing', id);
    return this.featured('EQUIPMENT');
  }

  async featureTalent(
    adminId: string,
    id: string,
    dto: FeatureDto,
  ): Promise<Record<string, unknown>[]> {
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

  async unfeatureTalent(adminId: string, id: string): Promise<Record<string, unknown>[]> {
    await this.prisma.talentProfile.update({
      where: { id },
      data: { featureTier: null, featuredAt: null, featuredUntil: null, featureSortOrder: 0 },
    });
    await this.audit.record(adminId, 'content.unfeature', 'TalentProfile', id);
    return this.featured('TALENT');
  }

  /** Pin: the order featured items appear in, across tiers. */
  async pin(adminId: string, dto: PinOrderDto): Promise<Record<string, unknown>[]> {
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
  ): Promise<Record<string, unknown>[]> {
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
      kind: 'EQUIPMENT',
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
  ): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.talentProfile.findMany({
      where,
      include: { user: { select: { image: true } } },
      orderBy: [{ featureSortOrder: 'asc' }, { featuredAt: 'desc' }, { ratingAvg: 'desc' }],
      take,
    });
    return rows.map((t) => ({
      id: t.id,
      kind: 'TALENT',
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
  @ApiOperation({
    summary: 'Marketplace Content — what is promoted',
    description:
      'Featured, Highlighted and Spotlight items, in pinned order. Promoted on the website hero grid and the Telegram bot.',
  })
  featured(@Query() query: ContentQuery): Promise<Record<string, unknown>[]> {
    return this.content.featured(query.kind ?? 'EQUIPMENT');
  }

  @Get('candidates')
  @ApiOperation({ summary: 'Add — live items not yet promoted' })
  candidates(@Query() query: ContentQuery): Promise<Record<string, unknown>[]> {
    return this.content.candidates(query.kind ?? 'EQUIPMENT', query.q);
  }

  @Put('featured/listings/:id')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Promote equipment, or change its tier' })
  featureListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeatureDto,
  ): Promise<Record<string, unknown>[]> {
    return this.content.featureListing(adminId, id, dto);
  }

  @Delete('featured/listings/:id')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Remove — back to Standard' })
  unfeatureListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>[]> {
    return this.content.unfeatureListing(adminId, id);
  }

  @Put('featured/talent/:id')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Promote a talent, or change their tier' })
  featureTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeatureDto,
  ): Promise<Record<string, unknown>[]> {
    return this.content.featureTalent(adminId, id, dto);
  }

  @Delete('featured/talent/:id')
  @AdminAccess(AdminTier.ADMIN)
  unfeatureTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>[]> {
    return this.content.unfeatureTalent(adminId, id);
  }

  @Put('featured/order')
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Pin — the order promoted items appear in' })
  pin(
    @CurrentUser('id') adminId: string,
    @Body() dto: PinOrderDto,
  ): Promise<Record<string, unknown>[]> {
    return this.content.pin(adminId, dto);
  }
}
