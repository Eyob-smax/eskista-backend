import { Injectable, NotFoundException } from '@nestjs/common';
import { PayeeKind, Prisma, SettlementStatus } from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import { formatMoney } from '../../../common/money';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { settlementDisplayStatus } from '../../settlements/settlement-math';
import { SettlementsService } from '../../settlements/settlements.service';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise, minorToDecimal, toCsv } from '../core/admin-format';
import { BookingFlowService } from '../core/booking-flow.service';
import {
  AdjustmentDto,
  AdminSettlementsQuery,
  HoldDto,
  MarkPaidDto,
  SettlementDetailResponse,
  SettlementRowResponse,
  SettlementsSummaryResponse,
} from './admin-settlements.dto';

const include = {
  booking: {
    select: {
      id: true,
      reference: true,
      status: true,
      supplierEarningsMinor: true,
      listing: { select: { name: true } },
      handover: {
        select: { payoutConfirmedAt: true, payoutDisputeNote: true, payoutDisputedAt: true },
      },
    },
  },
  vendor: {
    select: {
      id: true,
      businessName: true,
      userId: true,
      payoutAccounts: { orderBy: { isPrimary: 'desc' } },
    },
  },
  talentProfile: {
    select: {
      id: true,
      displayName: true,
      userId: true,
      payoutAccounts: { orderBy: { isPrimary: 'desc' } },
    },
  },
  adjustments: {
    orderBy: { createdAt: 'asc' },
    include: { createdBy: { select: { name: true } } },
  },
  paidBy: { select: { name: true } },
} satisfies Prisma.SettlementInclude;

type Row = Prisma.SettlementGetPayload<{ include: typeof include }>;

const LABELS: Record<string, string> = {
  PENDING: 'Pending',
  OVERDUE: 'Overdue',
  PAID: 'Paid',
  ON_HOLD: 'On Hold',
};

/**
 * Vendor Payouts & Settlements: what Eskista owes each supplier per booking, and paying it.
 * "Rental Revenue − Commission ± Adjustments = Vendor Settlement".
 */
@Injectable()
export class AdminSettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementsService,
    private readonly flow: BookingFlowService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminSettlementsQuery): Promise<Paginated<SettlementRowResponse>> {
    const where = this.where(query);
    const [rows, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        include,
        orderBy: [{ expectedAt: 'asc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.settlement.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toRow(r)),
      total,
      query,
    );
  }

  async summary(): Promise<SettlementsSummaryResponse> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const unpaid = { status: { in: [SettlementStatus.PENDING, SettlementStatus.IN_BATCH] } };
    const [pending, overdue, paid] = await Promise.all([
      this.prisma.settlement.aggregate({ where: unpaid, _sum: { netMinor: true }, _count: true }),
      this.prisma.settlement.aggregate({
        where: { ...unpaid, expectedAt: { lt: now } },
        _sum: { netMinor: true },
        _count: true,
      }),
      this.prisma.settlement.aggregate({
        where: { status: SettlementStatus.PAID, paidAt: { gte: monthStart } },
        _sum: { netMinor: true, commissionMinor: true },
      }),
    ]);
    return {
      pendingCount: pending._count,
      pendingMinor: pending._sum.netMinor ?? 0,
      overdueCount: overdue._count,
      overdueMinor: overdue._sum.netMinor ?? 0,
      paidThisMonthMinor: paid._sum.netMinor ?? 0,
      commissionThisMonthMinor: paid._sum.commissionMinor ?? 0,
      currency: 'ETB',
    };
  }

  async detail(reference: string): Promise<SettlementDetailResponse> {
    const s = await this.find(reference);
    const row = this.toRow(s);
    const accounts = s.vendor?.payoutAccounts ?? s.talentProfile?.payoutAccounts ?? [];
    return {
      ...row,
      breakdown: [
        { label: 'Rental revenue', amountMinor: s.grossMinor },
        { label: 'Eskista commission', amountMinor: -s.commissionMinor },
        ...s.adjustments.map((a) => ({ label: a.reason, amountMinor: a.amountMinor })),
        { label: 'Net payable', amountMinor: s.netMinor, emphasis: true },
      ],
      adjustments: s.adjustments.map((a) => ({
        id: a.id,
        amountMinor: a.amountMinor,
        reason: a.reason,
        createdBy: a.createdBy?.name ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      destination: s.paidAt
        ? {
            channel: s.payoutChannel,
            provider: s.payoutProvider,
            accountName: s.payoutAccountName,
            accountNumber: s.payoutAccountNumber,
          }
        : null,
      payoutAccounts: accounts.map((a) => ({
        id: a.id,
        channel: a.channel,
        provider: a.provider,
        accountName: a.accountName,
        accountNumber: a.accountNumber,
        isPrimary: a.isPrimary,
      })),
      payoutReference: s.payoutReference,
      paidByName: s.paidBy?.name ?? null,
      notes: s.notes,
      payeeConfirmedAt:
        (s.payeeConfirmedAt ?? s.booking.handover?.payoutConfirmedAt)?.toISOString() ?? null,
      payeeDisputeNote: s.payeeDisputeNote ?? s.booking.handover?.payoutDisputeNote ?? null,
      bookingStatus: s.booking.status,
      pdfUrl: `/api/v1/admin/settlements/${row.reference}/pdf`,
    };
  }

  /** Mark as Paid. The payee is told, and confirms it arrived from their app. */
  async markPaid(
    adminId: string,
    reference: string,
    dto: MarkPaidDto,
  ): Promise<SettlementDetailResponse> {
    const s = await this.find(reference);
    const paid = await this.settlements.markPaid(s.id, adminId, {
      payoutReference: dto.payoutReference,
      payoutAccountId: dto.payoutAccountId,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
      note: dto.note,
    });
    await this.flow.note(
      s.booking.id,
      adminId,
      `Payout ${s.reference ? `${s.reference} ` : ''}sent: ${formatMoney(paid.netMinor, paid.currency)}`,
    );
    const payee = s.vendor?.userId ?? s.talentProfile?.userId;
    if (payee) {
      await this.notifications.send(
        payee,
        'PAYOUT_SENT',
        { amount: formatMoney(paid.netMinor, paid.currency), reference: s.booking.reference },
        { bookingReference: s.booking.reference, settlementReference: s.reference },
      );
    }
    await this.audit.record(adminId, 'settlement.paid', 'Settlement', s.id, undefined, dto);
    return this.detail(reference);
  }

  async adjust(
    adminId: string,
    reference: string,
    dto: AdjustmentDto,
  ): Promise<SettlementDetailResponse> {
    const s = await this.find(reference);
    await this.settlements.addAdjustment(s.id, adminId, dto.amountMinor, dto.reason);
    await this.audit.record(adminId, 'settlement.adjust', 'Settlement', s.id, undefined, dto);
    return this.detail(reference);
  }

  async removeAdjustment(
    adminId: string,
    reference: string,
    adjustmentId: string,
  ): Promise<SettlementDetailResponse> {
    const s = await this.find(reference);
    await this.settlements.removeAdjustment(s.id, adjustmentId);
    await this.audit.record(adminId, 'settlement.adjust.remove', 'Settlement', s.id, {
      adjustmentId,
    });
    return this.detail(reference);
  }

  async hold(adminId: string, reference: string, dto: HoldDto): Promise<SettlementDetailResponse> {
    const s = await this.find(reference);
    await this.settlements.setHold(s.id, dto.hold, dto.note);
    await this.audit.record(
      adminId,
      dto.hold ? 'settlement.hold' : 'settlement.release',
      'Settlement',
      s.id,
      undefined,
      undefined,
      dto.note,
    );
    return this.detail(reference);
  }

  async pdf(reference: string): Promise<{ buffer: Buffer; filename: string }> {
    const s = await this.find(reference);
    return this.settlements.recordPdf(
      s.booking.id,
      s.vendor?.businessName ?? s.talentProfile?.displayName ?? 'Supplier',
      s.booking.listing?.name ?? 'Talent engagement',
    );
  }

  async exportCsv(query: AdminSettlementsQuery): Promise<string> {
    const rows = await this.prisma.settlement.findMany({
      where: this.where(query),
      include,
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    return toCsv(
      [
        'Settlement',
        'Booking',
        'Payee type',
        'Payee',
        'Item',
        'Gross (ETB)',
        'Commission (ETB)',
        'Adjustments (ETB)',
        'Net payable (ETB)',
        'Status',
        'Due',
        'Paid',
        'Payout reference',
        'Account',
      ],
      rows.map((s) => {
        const r = this.toRow(s);
        return [
          r.reference,
          r.bookingReference,
          humanise(r.payeeKind),
          r.payeeName,
          r.itemName,
          minorToDecimal(r.grossMinor),
          minorToDecimal(r.commissionMinor),
          minorToDecimal(r.adjustmentMinor),
          minorToDecimal(r.netMinor),
          r.statusLabel,
          r.expectedAt?.slice(0, 10),
          r.paidAt?.slice(0, 10),
          s.payoutReference,
          s.payoutAccountNumber
            ? `${s.payoutProvider ?? ''} ${s.payoutAccountNumber}`.trim()
            : null,
        ];
      }),
    );
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private where(query: AdminSettlementsQuery): Prisma.SettlementWhereInput {
    const now = new Date();
    const q = query.q;
    const and: Prisma.SettlementWhereInput[] = [];
    switch (query.status) {
      case 'PAID':
        and.push({ status: SettlementStatus.PAID });
        break;
      case 'ON_HOLD':
        and.push({ status: SettlementStatus.ON_HOLD });
        break;
      case 'OVERDUE':
        and.push({
          status: { in: [SettlementStatus.PENDING, SettlementStatus.IN_BATCH] },
          expectedAt: { lt: now },
        });
        break;
      case 'PENDING':
        and.push({
          status: { in: [SettlementStatus.PENDING, SettlementStatus.IN_BATCH] },
          OR: [{ expectedAt: null }, { expectedAt: { gte: now } }],
        });
        break;
    }
    if (query.payeeKind) and.push({ payeeKind: query.payeeKind });
    if (query.vendorId) and.push({ vendorId: query.vendorId });
    if (query.talentProfileId) and.push({ talentProfileId: query.talentProfileId });
    if (query.from) and.push({ createdAt: { gte: new Date(query.from) } });
    if (query.to)
      and.push({ createdAt: { lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) } });
    if (q) {
      and.push({
        OR: [
          { reference: { contains: q, mode: 'insensitive' } },
          { booking: { reference: { contains: q, mode: 'insensitive' } } },
          { vendor: { businessName: { contains: q, mode: 'insensitive' } } },
          { talentProfile: { displayName: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    return { AND: and };
  }

  private async find(reference: string): Promise<Row> {
    // The STL reference, or the booking's own reference — both identify one settlement.
    const s = await this.prisma.settlement.findFirst({
      where: { OR: [{ reference }, { booking: { reference } }] },
      include,
    });
    if (!s) throw new NotFoundException('Settlement not found');
    return s;
  }

  private toRow(s: Row): SettlementRowResponse {
    const status = settlementDisplayStatus(s.status, s.expectedAt);
    return {
      reference: s.reference ?? s.booking.reference,
      bookingReference: s.booking.reference,
      payeeKind: s.payeeKind,
      payeeId: (s.payeeKind === PayeeKind.TALENT ? s.talentProfileId : s.vendorId) ?? '',
      payeeName: s.vendor?.businessName ?? s.talentProfile?.displayName ?? '—',
      itemName: s.booking.listing?.name ?? 'Talent engagement',
      grossMinor: s.grossMinor,
      commissionMinor: s.commissionMinor,
      adjustmentMinor: s.adjustmentMinor,
      netMinor: s.netMinor,
      currency: s.currency,
      status,
      statusLabel: LABELS[status],
      expectedAt: s.expectedAt?.toISOString() ?? null,
      paidAt: s.paidAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  }
}
