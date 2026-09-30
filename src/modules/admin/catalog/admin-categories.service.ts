import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, CategoryKind, ListingStatus, Prisma, UnitStatus } from '@prisma/client';
import {
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../../common/upload';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAuditService } from '../core/admin-audit.service';
import {
  AdminCategoriesQuery,
  AdminCategoryResponse,
  CategoryDto,
  UpdateCategoryDto,
} from './admin-catalog.dto';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Swaps a category with its neighbour in display order. Pure, for the up/down arrows. */
export function moveInOrder(ids: string[], id: string, direction: 'UP' | 'DOWN'): string[] {
  const index = ids.indexOf(id);
  if (index < 0) return ids;
  const target = direction === 'UP' ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const include = {
  parent: { select: { id: true, name: true } },
  children: { select: { id: true } },
  associations: {
    orderBy: { sortOrder: 'asc' },
    include: { related: { select: { id: true, name: true, kind: true, slug: true } } },
  },
  _count: { select: { listings: true, talentServices: true } },
} satisfies Prisma.CategoryInclude;

type Row = Prisma.CategoryGetPayload<{ include: typeof include }>;

const RENTED: BookingStatus[] = [
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];

/**
 * Equipment Categories and Talent Categories & Skills: ordering, visibility, thumbnails,
 * internal descriptions, skills, and the cross-marketplace associations the catalogue uses
 * to suggest what goes with what.
 */
@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminCategoriesQuery): Promise<AdminCategoryResponse[]> {
    const kind = query.kind ?? CategoryKind.EQUIPMENT;
    const rows = await this.prisma.category.findMany({
      where: { kind, ...(query.includeHidden === false ? { isActive: true } : {}) },
      include,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const counts = await this.counts(
      kind,
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toResponse(r, counts.get(r.id)));
  }

  async get(id: string): Promise<AdminCategoryResponse> {
    const row = await this.find(id);
    const counts = await this.counts(row.kind, [row.id]);
    return this.toResponse(row, counts.get(row.id));
  }

  async create(adminId: string, dto: CategoryDto): Promise<AdminCategoryResponse> {
    const slug = dto.slug ?? slugify(dto.name);
    await this.assertSlugFree(slug);
    if (dto.parentId) await this.assertParent(dto.parentId, dto.kind, null);
    const last = await this.prisma.category.aggregate({
      where: { kind: dto.kind },
      _max: { sortOrder: true },
    });

    const created = await this.prisma.category.create({
      data: {
        kind: dto.kind,
        name: dto.name,
        slug,
        description: dto.description,
        skills: dto.skills ?? [],
        parentId: dto.parentId,
        isActive: dto.isActive ?? true,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    if (dto.associationIds?.length) await this.setAssociations(created.id, dto.associationIds);
    await this.audit.record(adminId, 'category.create', 'Category', created.id, undefined, dto);
    return this.get(created.id);
  }

  async update(
    adminId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<AdminCategoryResponse> {
    const before = await this.find(id);
    if (dto.slug && dto.slug !== before.slug) await this.assertSlugFree(dto.slug);
    if (dto.parentId) await this.assertParent(dto.parentId, before.kind, id);
    await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        skills: dto.skills,
        parentId: dto.parentId,
        isActive: dto.isActive,
      },
    });
    if (dto.associationIds) await this.setAssociations(id, dto.associationIds);
    await this.audit.record(
      adminId,
      'category.update',
      'Category',
      id,
      { name: before.name, isActive: before.isActive },
      dto,
    );
    return this.get(id);
  }

  /**
   * Deletes a category nothing uses; one with equipment or services is hidden instead, so
   * no listing is left pointing at nothing.
   */
  async remove(adminId: string, id: string): Promise<{ deleted: boolean }> {
    const row = await this.find(id);
    if (row._count.listings > 0 || row._count.talentServices > 0 || row.children.length > 0) {
      await this.prisma.category.update({ where: { id }, data: { isActive: false } });
      await this.audit.record(adminId, 'category.hide', 'Category', id);
      return { deleted: false };
    }
    await this.prisma.category.delete({ where: { id } });
    if (row.imageKey) await this.storage.remove(row.imageKey).catch(() => undefined);
    await this.audit.record(adminId, 'category.delete', 'Category', id);
    return { deleted: true };
  }

  async reorder(
    adminId: string,
    kind: CategoryKind,
    ids: string[],
  ): Promise<AdminCategoryResponse[]> {
    const existing = await this.prisma.category.findMany({ where: { kind }, select: { id: true } });
    const known = new Set(existing.map((c) => c.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new BadRequestException(`Send every ${kind.toLowerCase()} category exactly once`);
    }
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.category.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    await this.audit.record(adminId, 'category.reorder', 'Category', kind, undefined, { ids });
    return this.list({ kind });
  }

  async move(
    adminId: string,
    id: string,
    direction: 'UP' | 'DOWN',
  ): Promise<AdminCategoryResponse[]> {
    const row = await this.find(id);
    const ordered = await this.prisma.category.findMany({
      where: { kind: row.kind },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true },
    });
    return this.reorder(
      adminId,
      row.kind,
      moveInOrder(
        ordered.map((c) => c.id),
        id,
        direction,
      ),
    );
  }

  async setThumbnail(
    adminId: string,
    id: string,
    file: UploadedFile | undefined,
  ): Promise<AdminCategoryResponse> {
    const row = await this.find(id);
    const valid = assertValidFile(file, {
      allowed: IMAGE_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.image,
      field: 'thumbnail',
    });
    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `categories/${id}`,
    });
    await this.prisma.category.update({ where: { id }, data: { imageKey: stored.key } });
    if (row.imageKey) await this.storage.remove(row.imageKey).catch(() => undefined);
    await this.audit.record(adminId, 'category.thumbnail', 'Category', id);
    return this.get(id);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async setAssociations(id: string, relatedIds: string[]): Promise<void> {
    const ids = relatedIds.filter((r) => r !== id);
    const found = await this.prisma.category.count({ where: { id: { in: ids } } });
    if (found !== ids.length)
      throw new BadRequestException('Some associated categories do not exist');
    await this.prisma.$transaction([
      this.prisma.categoryAssociation.deleteMany({ where: { categoryId: id } }),
      this.prisma.categoryAssociation.createMany({
        data: ids.map((relatedId, sortOrder) => ({ categoryId: id, relatedId, sortOrder })),
      }),
    ]);
  }

  private async assertSlugFree(slug: string): Promise<void> {
    if (await this.prisma.category.findUnique({ where: { slug } })) {
      throw new ConflictException(`A category with the slug "${slug}" already exists`);
    }
  }

  private async assertParent(
    parentId: string,
    kind: CategoryKind,
    selfId: string | null,
  ): Promise<void> {
    if (parentId === selfId) throw new BadRequestException('A category cannot be its own parent');
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent || parent.kind !== kind)
      throw new BadRequestException('The parent must be a category of the same kind');
    if (parent.parentId) throw new BadRequestException('Subcategories go one level deep');
  }

  /** Available / on rental / in QA units per equipment category; talents per talent category. */
  private async counts(
    kind: CategoryKind,
    ids: string[],
  ): Promise<
    Map<
      string,
      { units: number; available: number; onRental: number; inQa: number; talents: number }
    >
  > {
    const map = new Map<
      string,
      { units: number; available: number; onRental: number; inQa: number; talents: number }
    >();
    for (const id of ids) map.set(id, { units: 0, available: 0, onRental: 0, inQa: 0, talents: 0 });
    if (kind === CategoryKind.EQUIPMENT) {
      const units = await this.prisma.equipmentUnit.findMany({
        where: {
          status: { not: UnitStatus.RETIRED },
          listing: { categoryId: { in: ids }, status: { not: ListingStatus.ARCHIVED } },
        },
        select: {
          status: true,
          listing: { select: { categoryId: true } },
          bookingUnits: {
            where: { booking: { status: { in: RENTED } } },
            select: { bookingId: true },
          },
        },
      });
      for (const u of units) {
        const c = map.get(u.listing.categoryId);
        if (!c) continue;
        c.units += 1;
        if (u.bookingUnits.length > 0) c.onRental += 1;
        else if (u.status === UnitStatus.MAINTENANCE) c.inQa += 1;
        else c.available += 1;
      }
    } else {
      const services = await this.prisma.talentService.findMany({
        where: { categoryId: { in: ids }, isActive: true },
        select: { categoryId: true, talentProfileId: true },
      });
      const seen = new Map<string, Set<string>>();
      for (const s of services) {
        if (!s.categoryId) continue;
        const set = seen.get(s.categoryId) ?? new Set<string>();
        set.add(s.talentProfileId);
        seen.set(s.categoryId, set);
      }
      for (const [id, set] of seen) {
        const c = map.get(id);
        if (c) c.talents = set.size;
      }
    }
    return map;
  }

  private async find(id: string): Promise<Row> {
    const row = await this.prisma.category.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException('Category not found');
    return row;
  }

  private toResponse(
    r: Row,
    counts?: { units: number; available: number; onRental: number; inQa: number; talents: number },
  ): AdminCategoryResponse {
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      slug: r.slug,
      description: r.description,
      skills: r.skills,
      thumbnailUrl: r.imageKey ? this.storage.urlFor(r.imageKey) : null,
      parent: r.parent,
      subcategoryCount: r.children.length,
      sortOrder: r.sortOrder,
      isPubliclyVisible: r.isActive,
      listingCount: r._count.listings,
      serviceCount: r._count.talentServices,
      counts: counts ?? null,
      associations: r.associations.map((a) => a.related),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
