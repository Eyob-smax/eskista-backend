import {
  Body,
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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminTier,
  AgreementStatus,
  BookingStatus,
  BookingType,
  InvitationStatus,
  PaymentStatus,
  Prisma,
  Role,
  SettlementStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
import { paginate, PaginationQuery, type Paginated } from '../../../common/dto/pagination.dto';
import { CurrentUser } from '../../auth/auth.decorators';
import { BookingRequestService } from '../../customer-bookings/booking-request.service';
import { UpsertTalentRequestDto } from '../../customer-bookings/dto/request.dto';
import { HiringService } from '../../hiring/hiring.service';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAccess } from '../core/admin-access';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise } from '../core/admin-format';
import { buildAdminTimeline } from '../core/booking-flow';
import { AdminBookingsService } from '../bookings/admin-bookings.service';
import { AdminBookingDetailResponse } from '../bookings/dto/admin-booking-detail.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The Hiring Requests filter: In Progress, Scheduled, Completed — and new ones. */
export const HIRING_FILTERS = ['NEW', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'] as const;

const FILTER_STATUSES: Record<(typeof HIRING_FILTERS)[number], BookingStatus[]> = {
  NEW: [BookingStatus.REQUEST_SUBMITTED, BookingStatus.ESKISTA_REVIEW],
  SCHEDULED: [BookingStatus.AWAITING_PAYMENT, BookingStatus.BOOKING_CONFIRMED],
  IN_PROGRESS: [BookingStatus.DELIVERY_PICKUP, BookingStatus.IN_PROGRESS],
  COMPLETED: [BookingStatus.RENTAL_COMPLETED, BookingStatus.SETTLEMENT, BookingStatus.CLOSED],
  CLOSED: [BookingStatus.REJECTED, BookingStatus.CANCELLED, BookingStatus.EXPIRED],
};

export class AdminHiringQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: HIRING_FILTERS })
  @IsOptional()
  @IsIn(HIRING_FILTERS)
  status?: (typeof HIRING_FILTERS)[number];

  @ApiPropertyOptional({ enum: ['SIGNED', 'PENDING'], description: 'The Contract column.' })
  @IsOptional()
  @IsIn(['SIGNED', 'PENDING'])
  contract?: 'SIGNED' | 'PENDING';

  @ApiPropertyOptional({ description: 'Reference, customer, talent, project, venue.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;
}

export class TalentIdsDto {
  @ApiProperty({
    type: [String],
    example: ['5b0c2f9e-6a1d-4c1e-9f0a-2d3e4f5a6b7c'],
    description: 'Talent profile ids.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  talentProfileIds!: string[];
}

export class AdminCreateHiringDto extends UpsertTalentRequestDto {
  @ApiProperty({
    description: 'The customer the request is for (their user id, from /admin/customers).',
    example: '7c1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
  })
  @IsUUID()
  customerId!: string;
}

export class HiringCustomerResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Yoseph Alemu' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Habesha Films' }) organisation!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911223344' }) phone!: string | null;
}

export class HiringTalentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Dawit Bekele' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographer' }) category!: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;
}

export class HiringRowResponse {
  @ApiProperty({ example: 'ESK-TLT-9001' }) reference!: string;
  @ApiProperty({ example: '2026-09-25T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ type: HiringCustomerResponse }) customer!: HiringCustomerResponse;
  @ApiPropertyOptional({
    type: HiringTalentResponse,
    nullable: true,
    description: 'The hired talent, once hired.',
  })
  talent!: HiringTalentResponse | null;
  @ApiProperty({ example: '3 invited · 1 accepted' }) invitationSummary!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographers' }) category!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Commercial Production' }) projectType!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Launch film for a coffee brand' })
  projectDescription!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Sheraton Addis' }) venue!: string | null;
  @ApiProperty({ example: '2026-10-02' }) startDate!: string;
  @ApiProperty({ example: '2026-10-02' }) endDate!: string;
  @ApiPropertyOptional({ nullable: true, example: '08:00' }) startTime!: string | null;
  @ApiProperty({
    enum: ['SIGNED', 'PENDING', 'NOT_ISSUED'],
    example: 'PENDING',
    description: 'Both agreements approved = Signed.',
  })
  contract!: 'SIGNED' | 'PENDING' | 'NOT_ISSUED';
  @ApiProperty({ example: 1_587_000 }) amountMinor!: number;
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ example: 'Payment Confirmed' }) paymentState!: string;
  @ApiProperty({ example: 'In Progress' }) workflowStatus!: string;
  @ApiProperty({ enum: BookingStatus, example: BookingStatus.AWAITING_PAYMENT })
  status!: BookingStatus;
}

const include = {
  customer: { include: { customer: true } },
  talentProfile: { select: { id: true, displayName: true, professions: true, avatarKey: true } },
  talentService: { select: { title: true, category: { select: { name: true } } } },
  talentDetail: true,
  invitations: { select: { status: true } },
  agreements: { select: { status: true } },
  payments: { select: { status: true, amountMinor: true } },
  settlement: { select: { status: true } },
} satisfies Prisma.BookingInclude;

type Row = Prisma.BookingGetPayload<{ include: typeof include }>;

/**
 * Hiring Requests: every talent request and engagement. The Booking Detail itself is the
 * shared admin booking detail, which shows the talent six-step lifecycle.
 */
@Injectable()
export class AdminHiringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hiring: HiringService,
    private readonly requests: BookingRequestService,
    private readonly bookings: AdminBookingsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async list(query: AdminHiringQuery): Promise<Paginated<HiringRowResponse>> {
    const q = query.q;
    const and: Prisma.BookingWhereInput[] = [
      { type: BookingType.TALENT, status: { not: BookingStatus.DRAFT } },
    ];
    if (query.status) and.push({ status: { in: FILTER_STATUSES[query.status] } });
    if (query.contract === 'SIGNED') {
      and.push(
        { agreements: { some: {} } },
        {
          agreements: {
            every: { status: { in: [AgreementStatus.APPROVED, AgreementStatus.VOID] } },
          },
        },
      );
    } else if (query.contract === 'PENDING') {
      and.push({
        agreements: {
          some: { status: { notIn: [AgreementStatus.APPROVED, AgreementStatus.VOID] } },
        },
      });
    }
    if (q) {
      and.push({
        OR: [
          { reference: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { customer: { customer: { organisationName: { contains: q, mode: 'insensitive' } } } },
          { talentProfile: { displayName: { contains: q, mode: 'insensitive' } } },
          { projectDescription: { contains: q, mode: 'insensitive' } },
          { talentDetail: { venue: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toRow(r)),
      total,
      query,
    );
  }

  /** Invite more talents on the customer's behalf, while the request is open. */
  async invite(
    adminId: string,
    reference: string,
    ids: string[],
  ): Promise<AdminBookingDetailResponse> {
    const b = await this.request(reference);
    await this.hiring.inviteMore(b.customerId, reference, ids);
    await this.audit.record(adminId, 'hiring.invite', 'Booking', reference, undefined, {
      talentProfileIds: ids,
    });
    return this.bookings.detail(reference);
  }

  /**
   * Assign Talent: hires talents who accepted, for the customer — typically when they asked
   * Eskista to choose. Exactly what the customer's own Hire does.
   */
  async hire(
    adminId: string,
    reference: string,
    ids: string[],
  ): Promise<AdminBookingDetailResponse> {
    const b = await this.request(reference);
    await this.hiring.hire(b.customerId, reference, ids);
    await this.audit.record(adminId, 'hiring.hire', 'Booking', reference, undefined, {
      talentProfileIds: ids,
    });
    return this.bookings.detail(reference);
  }

  /** Create Hiring Request for a customer — the same request they would send, submitted. */
  async create(adminId: string, dto: AdminCreateHiringDto): Promise<AdminBookingDetailResponse> {
    const customer = await this.prisma.user.findFirst({
      where: { id: dto.customerId, roles: { some: { role: Role.CUSTOMER } } },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const { customerId, ...request } = dto;
    const draft = await this.requests.createTalentDraft(customerId, request);
    await this.requests.submit(customerId, draft.id);
    const booking = await this.prisma.booking.update({
      where: { id: draft.id },
      data: { createdByAdminId: adminId },
      select: { reference: true },
    });
    await this.audit.record(adminId, 'hiring.create', 'Booking', booking.reference, undefined, {
      customerId,
    });
    return this.bookings.detail(booking.reference);
  }

  private async request(reference: string) {
    const b = await this.prisma.booking.findFirst({
      where: { reference, type: BookingType.TALENT },
      select: { id: true, customerId: true },
    });
    if (!b) throw new NotFoundException('Talent request not found');
    return b;
  }

  private toRow(b: Row): HiringRowResponse {
    const count = (s: InvitationStatus) => b.invitations.filter((i) => i.status === s).length;
    const live = b.agreements.filter((a) => a.status !== AgreementStatus.VOID);
    const contract =
      live.length === 0
        ? 'NOT_ISSUED'
        : live.every((a) => a.status === AgreementStatus.APPROVED)
          ? 'SIGNED'
          : 'PENDING';
    const paid = b.payments
      .filter((p) => p.status === PaymentStatus.VERIFIED)
      .reduce((s, p) => s + p.amountMinor, 0);
    const timeline = buildAdminTimeline({
      type: b.type,
      status: b.status,
      preparedAt: null,
      handedOverAt: null,
      receivedAtHubAt: null,
      hasOutgoingInspection: false,
      hasReturnInspection: false,
      settlementPaid: b.settlement?.status === SettlementStatus.PAID,
      talentAssigned: b.talentProfileId !== null,
      contractsApproved: contract === 'SIGNED',
    });
    const current = timeline.find((t) => t.state === 'IN_PROGRESS');
    const profile = b.customer.customer;
    const due = b.totalMinor + b.securityDepositMinor;
    return {
      reference: b.reference,
      createdAt: b.createdAt.toISOString(),
      customer: {
        id: b.customerId,
        name: profile?.contactPerson ?? b.customer.name,
        organisation: profile?.organisationName ?? null,
        phone: b.contactPhone || profile?.phone || b.customer.phone,
      },
      talent: b.talentProfile
        ? {
            id: b.talentProfile.id,
            name: b.talentProfile.displayName,
            category: b.talentProfile.professions[0] ?? null,
            avatarUrl: b.talentProfile.avatarKey
              ? this.storage.urlFor(b.talentProfile.avatarKey)
              : null,
          }
        : null,
      invitationSummary: `${b.invitations.length} invited · ${count(InvitationStatus.ACCEPTED) + count(InvitationStatus.HIRED)} accepted`,
      category: b.talentService?.category?.name ?? b.talentProfile?.professions[0] ?? null,
      projectType: b.projectType ? humanise(b.projectType) : null,
      projectDescription: b.projectDescription,
      venue: b.talentDetail?.venue ?? b.talentDetail?.eventLocation ?? null,
      startDate: b.startDate.toISOString().slice(0, 10),
      endDate: b.endDate.toISOString().slice(0, 10),
      startTime: b.talentDetail?.startTime ?? null,
      contract,
      amountMinor: due,
      currency: b.currency,
      paymentState: b.payments.some((p) => p.status === PaymentStatus.SUBMITTED)
        ? 'Receipt Uploaded'
        : due > 0 && paid >= due
          ? 'Payment Confirmed'
          : b.status === BookingStatus.AWAITING_PAYMENT
            ? 'Payment Pending'
            : due === 0
              ? 'Not Priced'
              : 'Payment Pending',
      workflowStatus: current?.label ?? humanise(b.status),
      status: b.status,
    };
  }
}

const REF = { name: 'reference', example: 'ESK-TLT-9001' };

@ApiTags('admin · hiring')
@AdminAccess()
@Controller({ path: 'admin/hiring', version: '1' })
export class AdminHiringRequestsController {
  constructor(private readonly hiring: AdminHiringService) {}

  @Get()
  @ApiOperation({
    summary: 'Hiring Requests',
    description:
      'Every talent request and engagement. Open one with `GET /admin/bookings/:reference`, ' +
      'which shows the six-step lifecycle: Pending Review · Approved · Talent Assigned · ' +
      'Contract Active · In Progress · Completed. Start and complete it with ' +
      '`/admin/bookings/:reference/start` and `/complete`.',
  })
  @ApiPaginatedResponse(HiringRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminHiringQuery): Promise<Paginated<HiringRowResponse>> {
    return this.hiring.list(query);
  }

  @Post()
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  @ApiOperation({
    summary: 'Create Hiring Request for a customer',
    description: 'The same fields as the customer request, plus `customerId`. Submitted at once.',
  })
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest:
      'The request is not ready to submit (`outstandingRequirements` lists what is missing).',
    notFound: 'Customer not found',
    conflict: 'Some of the talents are no longer taking work',
  })
  create(
    @CurrentUser('id') adminId: string,
    @Body() dto: AdminCreateHiringDto,
  ): Promise<AdminBookingDetailResponse> {
    return this.hiring.create(adminId, dto);
  }

  @Post(':reference/invitations')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  @ApiOperation({ summary: 'Invite more talents to an open request' })
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'More talents than the invitation limit allows.',
    notFound: 'Talent request not found',
    conflict: 'This request is no longer open to new invitations',
  })
  invite(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: TalentIdsDto,
  ): Promise<AdminBookingDetailResponse> {
    return this.hiring.invite(adminId, reference, dto.talentProfileIds);
  }

  @Post(':reference/hire')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Assign Talent — hire on the customer’s behalf',
    description: 'Only talents who accepted. Prices the hire and issues both agreements.',
  })
  @ApiParam(REF)
  @ApiOkResponse({ type: AdminBookingDetailResponse })
  @ApiStandardErrors({
    badRequest: 'More talents than the headcount.',
    notFound: 'Talent request not found',
    conflict: 'You can only hire talents who have accepted this request',
  })
  hire(
    @CurrentUser('id') adminId: string,
    @Param('reference') reference: string,
    @Body() dto: TalentIdsDto,
  ): Promise<AdminBookingDetailResponse> {
    return this.hiring.hire(adminId, reference, dto.talentProfileIds);
  }
}
