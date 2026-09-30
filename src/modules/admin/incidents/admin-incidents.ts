import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  AdminTier,
  BookingType,
  IncidentStatus,
  IncidentType,
  Prisma,
  SettlementStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  NotEquals,
} from 'class-validator';
import { paginate, PaginationQuery, type Paginated } from '../../../common/dto/pagination.dto';
import { formatMoney } from '../../../common/money';
import { CurrentUser } from '../../auth/auth.decorators';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettlementsService } from '../../settlements/settlements.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAccess } from '../core/admin-access';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise } from '../core/admin-format';
import { BookingFlowService } from '../core/booking-flow.service';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminIncidentsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: IncidentStatus })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @ApiPropertyOptional({ enum: IncidentType })
  @IsOptional()
  @IsEnum(IncidentType)
  type?: IncidentType;

  @ApiPropertyOptional({
    enum: BookingType,
    description: 'Equipment issues, or client ↔ talent disputes.',
  })
  @IsOptional()
  @IsEnum(BookingType)
  bookingType?: BookingType;

  @ApiPropertyOptional({ description: 'Incident or booking reference, or a party.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;
}

export class ResolveIncidentDto {
  @ApiProperty({ example: 'Talent arrived 90 minutes late; 10% refunded to the client.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  @Transform(trim)
  resolution!: string;

  @ApiPropertyOptional({
    description:
      "Signed minor units applied to the supplier's payout for this booking — negative for a " +
      'penalty or refund, positive for compensation. Only while the payout is unpaid.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  payoutAdjustmentMinor?: number;
}

export class DismissIncidentDto {
  @ApiProperty({ example: 'Duplicate of ESK-INC-00041' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

const include = {
  booking: {
    select: {
      id: true,
      reference: true,
      type: true,
      status: true,
      customerId: true,
      customer: {
        select: { name: true, customer: { select: { organisationName: true, phone: true } } },
      },
      vendor: { select: { businessName: true, userId: true, phone: true } },
      talentProfile: { select: { displayName: true, userId: true, phone: true } },
      listing: { select: { name: true } },
      settlement: { select: { id: true, status: true } },
    },
  },
  reportedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { name: true } },
  photos: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.IncidentInclude;

type Row = Prisma.IncidentGetPayload<{ include: typeof include }>;

const STATUS_LABELS: Record<IncidentStatus, string> = {
  REPORTED: 'Logged',
  UNDER_REVIEW: 'Under Review',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

/**
 * The Issues & Grievance Desk: every reported problem — damaged gear, a late talent,
 * overtime, a payout that never arrived — and resolving it. Eskista sits between the
 * parties; a resolution can move money on the supplier's payout.
 */
@Injectable()
export class AdminIncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementsService,
    private readonly flow: BookingFlowService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminIncidentsQuery): Promise<Paginated<Record<string, unknown>>> {
    const q = query.q;
    const where: Prisma.IncidentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.bookingType ? { booking: { type: query.bookingType } } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' } },
              { booking: { reference: { contains: q, mode: 'insensitive' } } },
              { booking: { customer: { name: { contains: q, mode: 'insensitive' } } } },
              { booking: { talentProfile: { displayName: { contains: q, mode: 'insensitive' } } } },
              { booking: { vendor: { businessName: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.incident.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toResponse(r)),
      total,
      query,
    );
  }

  async summary(): Promise<Record<string, number>> {
    const open = { status: { in: [IncidentStatus.REPORTED, IncidentStatus.UNDER_REVIEW] } };
    const [equipment, talent, today] = await Promise.all([
      this.prisma.incident.count({ where: { ...open, booking: { type: BookingType.EQUIPMENT } } }),
      this.prisma.incident.count({ where: { ...open, booking: { type: BookingType.TALENT } } }),
      this.prisma.incident.count({
        where: {
          status: IncidentStatus.RESOLVED,
          resolvedAt: { gte: new Date(new Date().toISOString().slice(0, 10)) },
        },
      }),
    ]);
    return {
      openEquipment: equipment,
      openTalent: talent,
      open: equipment + talent,
      resolvedToday: today,
    };
  }

  async get(reference: string): Promise<Record<string, unknown>> {
    return this.toResponse(await this.find(reference));
  }

  async review(adminId: string, reference: string): Promise<Record<string, unknown>> {
    const i = await this.find(reference);
    if (i.status !== IncidentStatus.REPORTED) return this.toResponse(i);
    await this.prisma.incident.update({
      where: { id: i.id },
      data: { status: IncidentStatus.UNDER_REVIEW },
    });
    await this.audit.record(adminId, 'incident.review', 'Incident', reference);
    return this.get(reference);
  }

  /** Resolve Issue. Tells whoever reported it, and the client when it was not them. */
  async resolve(
    adminId: string,
    reference: string,
    dto: ResolveIncidentDto,
  ): Promise<Record<string, unknown>> {
    const i = await this.find(reference);
    if (i.status === IncidentStatus.RESOLVED || i.status === IncidentStatus.DISMISSED) {
      throw new ConflictException('This issue is already closed');
    }
    if (dto.payoutAdjustmentMinor) {
      const s = i.booking.settlement;
      if (!s) {
        throw new ConflictException(
          'The booking has no settlement yet; resolve without a payout change, or settle it first',
        );
      }
      if (s.status === SettlementStatus.PAID)
        throw new ConflictException('The payout is already paid');
      await this.settlements.addAdjustment(
        s.id,
        adminId,
        dto.payoutAdjustmentMinor,
        `Issue ${reference}`,
      );
    }
    await this.prisma.incident.update({
      where: { id: i.id },
      data: {
        status: IncidentStatus.RESOLVED,
        resolution: dto.resolution,
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
        ...(dto.payoutAdjustmentMinor ? { amountMinor: dto.payoutAdjustmentMinor } : {}),
      },
    });
    await this.flow.note(
      i.booking.id,
      adminId,
      `Issue ${reference} resolved${dto.payoutAdjustmentMinor ? ` (payout ${dto.payoutAdjustmentMinor > 0 ? '+' : '−'}${formatMoney(Math.abs(dto.payoutAdjustmentMinor))})` : ''}`,
    );
    await this.tell(i, dto.resolution);
    await this.audit.record(adminId, 'incident.resolve', 'Incident', reference, undefined, dto);
    return this.get(reference);
  }

  async dismiss(
    adminId: string,
    reference: string,
    reason: string,
  ): Promise<Record<string, unknown>> {
    const i = await this.find(reference);
    if (i.status === IncidentStatus.RESOLVED || i.status === IncidentStatus.DISMISSED) {
      throw new ConflictException('This issue is already closed');
    }
    await this.prisma.incident.update({
      where: { id: i.id },
      data: {
        status: IncidentStatus.DISMISSED,
        resolution: reason,
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
      },
    });
    await this.tell(i, reason);
    await this.audit.record(
      adminId,
      'incident.dismiss',
      'Incident',
      reference,
      undefined,
      undefined,
      reason,
    );
    return this.get(reference);
  }

  private async tell(i: Row, resolution: string): Promise<void> {
    const recipients = new Set<string>([i.reportedById]);
    if (i.reporterRole !== 'ADMIN') recipients.add(i.booking.customerId);
    // An admin-raised issue (from an inspection) is Eskista's own note; the customer hears
    // about the outcome through the inspection result instead.
    if (i.reporterRole === 'ADMIN') recipients.delete(i.reportedById);
    for (const userId of recipients) {
      await this.notifications.send(
        userId,
        'INCIDENT_RESOLVED',
        { reference: i.reference, resolution },
        { bookingReference: i.booking.reference, incidentReference: i.reference },
      );
    }
  }

  private async find(reference: string): Promise<Row> {
    const i = await this.prisma.incident.findUnique({ where: { reference }, include });
    if (!i) throw new NotFoundException('Issue not found');
    return i;
  }

  private toResponse(i: Row): Record<string, unknown> {
    const b = i.booking;
    const supplier = b.vendor?.businessName ?? b.talentProfile?.displayName ?? null;
    return {
      reference: i.reference,
      bookingReference: b.reference,
      bookingType: b.type,
      bookingStatus: b.status,
      itemName: b.listing?.name ?? b.talentProfile?.displayName ?? null,
      type: i.type,
      typeLabel: humanise(i.type),
      phase: i.phase,
      phaseLabel: humanise(i.phase),
      description: i.description,
      reporter: { id: i.reportedBy.id, name: i.reportedBy.name, role: i.reporterRole },
      // "Client ↔ talent" on the desk.
      parties: {
        client: b.customer.customer?.organisationName ?? b.customer.name,
        clientPhone: b.customer.customer?.phone ?? null,
        supplier,
        supplierPhone: b.vendor?.phone ?? b.talentProfile?.phone ?? null,
      },
      amountMinor: i.amountMinor,
      status: i.status,
      statusLabel: STATUS_LABELS[i.status],
      resolution: i.resolution,
      resolvedBy: i.resolvedBy?.name ?? null,
      photos: i.photos.map((p) => ({
        id: p.id,
        url: this.storage.urlFor(p.fileKey),
        caption: p.caption,
      })),
      loggedAt: i.createdAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    };
  }
}

@ApiTags('admin · issues')
@AdminAccess()
@Controller({ path: 'admin/incidents', version: '1' })
export class AdminIncidentsController {
  constructor(private readonly incidents: AdminIncidentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Issues & Grievance Desk',
    description:
      'Equipment issues and client ↔ talent disputes. `bookingType=TALENT` for the talent desk.',
  })
  list(@Query() query: AdminIncidentsQuery): Promise<Paginated<Record<string, unknown>>> {
    return this.incidents.list(query);
  }

  @Get('summary')
  summary(): Promise<Record<string, number>> {
    return this.incidents.summary();
  }

  @Get(':reference')
  @ApiOperation({ summary: 'View Details' })
  get(@Param('reference') reference: string): Promise<Record<string, unknown>> {
    return this.incidents.get(reference);
  }

  @Post(':reference/review')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPPORT, AdminTier.ADMIN)
  @ApiOperation({ summary: 'Take it on — Under Review' })
  review(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
  ): Promise<Record<string, unknown>> {
    return this.incidents.review(adminId, reference);
  }

  @Post(':reference/resolve')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPPORT, AdminTier.ADMIN)
  @ApiOperation({ summary: 'Resolve Issue — optionally adjusting the supplier payout' })
  resolve(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: ResolveIncidentDto,
  ): Promise<Record<string, unknown>> {
    return this.incidents.resolve(adminId, reference, dto);
  }

  @Post(':reference/dismiss')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPPORT, AdminTier.ADMIN)
  dismiss(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: DismissIncidentDto,
  ): Promise<Record<string, unknown>> {
    return this.incidents.dismiss(adminId, reference, dto.reason);
  }
}
