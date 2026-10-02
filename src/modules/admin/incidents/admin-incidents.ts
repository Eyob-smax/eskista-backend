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
import {
  ApiBody,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
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
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
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

  @ApiPropertyOptional({
    description: 'Incident or booking reference, or a party.',
    example: 'ESK-INC-00042',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;
}

const OPEN_STATUSES: IncidentStatus[] = [IncidentStatus.REPORTED, IncidentStatus.UNDER_REVIEW];

export class IncidentReporterResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Yoseph Alemu' }) name!: string;
  @ApiProperty({ enum: ['CUSTOMER', 'VENDOR', 'TALENT', 'ADMIN'], example: 'CUSTOMER' })
  role!: string;
}

export class IncidentPartiesResponse {
  @ApiProperty({ example: 'Habesha Films' }) client!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) clientPhone!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Dawit Bekele',
    description: 'Vendor or talent.',
  })
  supplier!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911778899' }) supplierPhone!: string | null;
}

export class IncidentPhotoResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '/api/v1/files/bookings/ESK-10485/incidents/a1.jpg' }) url!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Scratch on the lens hood' }) caption!:
    string | null;
}

export class AdminIncidentResponse {
  @ApiProperty({ example: 'ESK-INC-00042' }) reference!: string;
  @ApiProperty({ example: 'ESK-TLT-9001' }) bookingReference!: string;
  @ApiProperty({ enum: BookingType, example: BookingType.TALENT }) bookingType!: BookingType;
  @ApiProperty({ example: 'IN_PROGRESS' }) bookingStatus!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Dawit Bekele' }) itemName!: string | null;
  @ApiProperty({ enum: IncidentType, example: IncidentType.LATE_ARRIVAL }) type!: IncidentType;
  @ApiProperty({ example: 'Late Arrival' }) typeLabel!: string;
  @ApiProperty({ example: 'DURING_ENGAGEMENT' }) phase!: string;
  @ApiProperty({ example: 'During Engagement' }) phaseLabel!: string;
  @ApiProperty({
    example: 'The cinematographer arrived 90 minutes after the agreed 08:00 call time.',
  })
  description!: string;
  @ApiProperty({ type: IncidentReporterResponse }) reporter!: IncidentReporterResponse;
  @ApiProperty({ type: IncidentPartiesResponse, description: '"Client ↔ talent" on the desk.' })
  parties!: IncidentPartiesResponse;
  @ApiPropertyOptional({
    nullable: true,
    example: -120_000,
    description: 'Money the resolution moved.',
  })
  amountMinor!: number | null;
  @ApiProperty({ enum: IncidentStatus, example: IncidentStatus.REPORTED }) status!: IncidentStatus;
  @ApiProperty({ example: 'Logged' }) statusLabel!: string;
  @ApiPropertyOptional({
    nullable: true,
    example: 'Talent arrived 90 minutes late; 10% refunded to the client.',
  })
  resolution!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Henok Girma' }) resolvedBy!: string | null;
  @ApiProperty({ type: [IncidentPhotoResponse] }) photos!: IncidentPhotoResponse[];
  @ApiProperty({ example: '2026-09-28T10:15:00.000Z' }) loggedAt!: string;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-29T14:30:00.000Z' }) resolvedAt!:
    string | null;
}

export class IncidentSummaryResponse {
  @ApiProperty({ example: 1 }) openEquipment!: number;
  @ApiProperty({ example: 2, description: 'Open client ↔ talent disputes.' }) openTalent!: number;
  @ApiProperty({ example: 3 }) open!: number;
  @ApiProperty({ example: 1 }) resolvedToday!: number;
}

export class ResolveIncidentDto {
  @ApiProperty({ example: 'Talent arrived 90 minutes late; 10% refunded to the client.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  @Transform(trim)
  resolution!: string;

  @ApiPropertyOptional({
    example: -120000,
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

  async list(query: AdminIncidentsQuery): Promise<Paginated<AdminIncidentResponse>> {
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

  async summary(): Promise<IncidentSummaryResponse> {
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

  async get(reference: string): Promise<AdminIncidentResponse> {
    return this.toResponse(await this.find(reference));
  }

  async review(adminId: string, reference: string): Promise<AdminIncidentResponse> {
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
  ): Promise<AdminIncidentResponse> {
    const i = await this.find(reference);
    const s = i.booking.settlement;
    if (dto.payoutAdjustmentMinor) {
      if (!s) {
        throw new ConflictException(
          'The booking has no settlement yet; resolve without a payout change, or settle it first',
        );
      }
      if (s.status === SettlementStatus.PAID) {
        throw new ConflictException('The payout is already paid');
      }
    }
    // Guarded on the open statuses: of two admins resolving at once, only one gets here, so
    // the payout is adjusted once.
    const { count } = await this.prisma.incident.updateMany({
      where: { id: i.id, status: { in: OPEN_STATUSES } },
      data: {
        status: IncidentStatus.RESOLVED,
        resolution: dto.resolution,
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
        ...(dto.payoutAdjustmentMinor ? { amountMinor: dto.payoutAdjustmentMinor } : {}),
      },
    });
    if (count === 0) throw new ConflictException('This issue is already closed');
    if (dto.payoutAdjustmentMinor && s) {
      await this.settlements.addAdjustment(
        s.id,
        adminId,
        dto.payoutAdjustmentMinor,
        `Issue ${reference}`,
      );
    }
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
  ): Promise<AdminIncidentResponse> {
    const i = await this.find(reference);
    const { count } = await this.prisma.incident.updateMany({
      where: { id: i.id, status: { in: OPEN_STATUSES } },
      data: {
        status: IncidentStatus.DISMISSED,
        resolution: reason,
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
      },
    });
    if (count === 0) throw new ConflictException('This issue is already closed');
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

  /**
   * Tells whoever reported it: "Your report … has been resolved". An issue an admin raised
   * from an inspection is Eskista's own record — the customer already heard the inspection
   * result — so nobody is told.
   */
  private async tell(i: Row, resolution: string): Promise<void> {
    if (i.reporterRole === 'ADMIN') return;
    await this.notifications.send(
      i.reportedById,
      'INCIDENT_RESOLVED',
      { reference: i.reference, resolution },
      { bookingReference: i.booking.reference, incidentReference: i.reference },
    );
  }

  private async find(reference: string): Promise<Row> {
    const i = await this.prisma.incident.findUnique({ where: { reference }, include });
    if (!i) throw new NotFoundException('Issue not found');
    return i;
  }

  private toResponse(i: Row): AdminIncidentResponse {
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
  @ApiEndpoint({
    summary: 'Issues & Grievance Desk',
    does: 'Equipment issues and client ↔ talent disputes, newest first. `bookingType=TALENT` for the talent desk.',
    behind: ['Read only.'],
  })
  @ApiPaginatedResponse(AdminIncidentResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminIncidentsQuery): Promise<Paginated<AdminIncidentResponse>> {
    return this.incidents.list(query);
  }

  @Get('summary')
  @ApiEndpoint({
    summary: 'Counts for the desk and the sidebar',
    does: 'Open equipment issues, open talent disputes, total open, and how many were resolved today.',
    behind: ['Read only.'],
  })
  @ApiOkResponse({ type: IncidentSummaryResponse })
  @ApiStandardErrors()
  summary(): Promise<IncidentSummaryResponse> {
    return this.incidents.summary();
  }

  @Get(':reference')
  @ApiEndpoint({
    summary: 'View Details',
    does: 'One issue: the description, the reporter, the parties (client ↔ talent or vendor), photos, and the resolution if closed.',
    behind: ['Read only. Photos served as private `/api/v1/files/…` links.'],
    rules: ['404 when not found.'],
  })
  @ApiParam({ name: 'reference', example: 'ESK-INC-00042', description: 'The issue reference.' })
  @ApiOkResponse({ type: AdminIncidentResponse })
  @ApiStandardErrors({ notFound: 'Issue not found' })
  get(@Param('reference') reference: string): Promise<AdminIncidentResponse> {
    return this.incidents.get(reference);
  }

  @Post(':reference/review')
  @ApiEndpoint({
    summary: 'Take it on — Under Review',
    does: 'Moves a Logged issue to Under Review. A no-op once it is past Logged.',
    behind: ['Status `REPORTED` → `UNDER_REVIEW`; admin audit log written.'],
    rules: ['Support and Admins.', '404 when not found.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPPORT, AdminTier.ADMIN)
  @ApiParam({ name: 'reference', example: 'ESK-INC-00042', description: 'The issue reference.' })
  @ApiOkResponse({ type: AdminIncidentResponse })
  @ApiStandardErrors({ notFound: 'Issue not found' })
  review(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
  ): Promise<AdminIncidentResponse> {
    return this.incidents.review(adminId, reference);
  }

  @Post(':reference/resolve')
  @ApiEndpoint({
    summary: 'Resolve Issue — optionally adjusting the supplier payout',
    does: "Closes the issue with a resolution. `payoutAdjustmentMinor` (signed) is applied to the vendor's or talent's unpaid settlement for this booking — negative for a penalty or refund.",
    behind: [
      'Status → `RESOLVED` with the resolution, amount and who resolved it.',
      'Payout adjustment added to the settlement as a signed line (when sent and the settlement exists and is unpaid).',
      'Booking history noted. Whoever reported it is told.',
      'Concurrency: `updateMany` with an OPEN guard — of two admins resolving at once, only one succeeds, so the payout is adjusted once.',
      'Admin audit log written.',
    ],
    seenBy: ['Reporter: "Your report … has been resolved".'],
    rules: [
      'Support and Admins.',
      '400 when `resolution` is missing or the adjustment is zero.',
      '404 when not found.',
      '409 when the issue is already closed, or the payout is already paid.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPPORT, AdminTier.ADMIN)
  @ApiParam({ name: 'reference', example: 'ESK-INC-00042', description: 'The issue reference.' })
  @ApiBody({
    type: ResolveIncidentDto,
    examples: {
      noMoney: {
        summary: 'Resolved, no money moved',
        value: { resolution: 'Spoke to both parties; agreed to extend by one hour at no charge.' },
      },
      penalty: {
        summary: 'Late arrival: 10% off the talent payout',
        value: {
          resolution: 'Talent arrived 90 minutes late; 10% refunded to the client.',
          payoutAdjustmentMinor: -120000,
        },
      },
    },
  })
  @ApiOkResponse({ type: AdminIncidentResponse })
  @ApiStandardErrors({
    badRequest: '`resolution` missing, or the adjustment is zero.',
    notFound: 'Issue not found',
    conflict: 'This issue is already closed',
  })
  resolve(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: ResolveIncidentDto,
  ): Promise<AdminIncidentResponse> {
    return this.incidents.resolve(adminId, reference, dto);
  }

  @Post(':reference/dismiss')
  @ApiEndpoint({
    summary: 'Dismiss — duplicate, or not an issue',
    does: 'Closes without adjusting anything. The reporter is told why.',
    behind: [
      'Status → `DISMISSED` with the reason.',
      'Whoever reported it is told.',
      'Admin audit log written.',
    ],
    rules: [
      'Support and Admins.',
      '400 when `reason` is missing.',
      '404 when not found.',
      '409 when the issue is already closed.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPPORT, AdminTier.ADMIN)
  @ApiParam({ name: 'reference', example: 'ESK-INC-00042', description: 'The issue reference.' })
  @ApiOkResponse({ type: AdminIncidentResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing.',
    notFound: 'Issue not found',
    conflict: 'This issue is already closed',
  })
  dismiss(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: DismissIncidentDto,
  ): Promise<AdminIncidentResponse> {
    return this.incidents.dismiss(adminId, reference, dto.reason);
  }
}
