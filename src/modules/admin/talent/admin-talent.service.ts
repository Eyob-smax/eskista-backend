import { randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  BookingType,
  IncidentStatus,
  PricingModel,
  Prisma,
  Role,
  SettlementStatus,
  VerificationStatus,
} from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import { customerUnitPrice } from '../../../common/money';
import { renderCvPdf } from '../../documents/cv-renderer';
import { TALENT_COMMITTED } from '../../hiring/hiring.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { talentInclude } from '../../talent/talent-profile.service';
import { TalentWorkService } from '../../talent/talent-work.service';
import { profileUrlFor, talentAvatarUrl } from '../../talent/talent-media';
import { toPayoutAccountResponse } from '../../payout-accounts/payout-accounts';
import { AdminAuditService } from '../core/admin-audit.service';
import { humanise } from '../core/admin-format';
import {
  AdminTalentQuery,
  RegisterTalentDto,
  RegisteredTalentResponse,
  TalentAdminProfileResponse,
  TalentKpisResponse,
  TalentRosterRowResponse,
} from './admin-talent.dto';

/** The stand-in account a registered profile sits on until its talent claims it. */
export const REGISTERED_EMAIL_DOMAIN = 'registered.eskista.invalid';

/** A claim code is valid this long; an admin can issue a fresh one any time. */
const CLAIM_DAYS = 14;

/** Readable claim codes: no 0/O or 1/I, grouped "K7Q2-MX9P". */
export function newClaimCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

const rosterInclude = {
  user: { select: { image: true } },
  bookings: {
    where: { status: { in: TALENT_COMMITTED } },
    select: { startDate: true, endDate: true },
  },
} satisfies Prisma.TalentProfileInclude;

type RosterRow = Prisma.TalentProfileGetPayload<{ include: typeof rosterInclude }>;

/**
 * The Talent Roster: every talent, their profile as Eskista sees it, and what an admin
 * can do to it — verify, reject, suspend, feature, or register someone who is not on
 * Telegram yet.
 */
@Injectable()
export class AdminTalentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly work: TalentWorkService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async kpis(): Promise<TalentKpisResponse> {
    const [total, active, pending, requests, issues] = await Promise.all([
      this.prisma.talentProfile.count({ where: { status: { not: VerificationStatus.DRAFT } } }),
      this.prisma.talentProfile.count({
        where: { status: VerificationStatus.VERIFIED, isAvailableForHire: true },
      }),
      this.prisma.talentProfile.count({ where: { status: VerificationStatus.PENDING_REVIEW } }),
      this.prisma.booking.count({
        where: {
          type: BookingType.TALENT,
          status: {
            in: [
              BookingStatus.REQUEST_SUBMITTED,
              BookingStatus.ESKISTA_REVIEW,
              ...TALENT_COMMITTED,
            ],
          },
        },
      }),
      this.prisma.incident.count({
        where: {
          booking: { type: BookingType.TALENT },
          status: { in: [IncidentStatus.REPORTED, IncidentStatus.UNDER_REVIEW] },
        },
      }),
    ]);
    return {
      total,
      active,
      pendingVerification: pending,
      activeRequests: requests,
      openIssues: issues,
    };
  }

  async list(query: AdminTalentQuery): Promise<Paginated<TalentRosterRowResponse>> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const q = query.q;
    const and: Prisma.TalentProfileWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.category) and.push({ professions: { has: query.category } });
    if (query.availability === 'BOOKED') {
      and.push({
        bookings: {
          some: {
            status: { in: TALENT_COMMITTED },
            startDate: { lte: today },
            endDate: { gte: today },
          },
        },
      });
    } else if (query.availability === 'AVAILABLE') {
      and.push(
        { isAvailableForHire: true, status: VerificationStatus.VERIFIED },
        {
          bookings: {
            none: {
              status: { in: TALENT_COMMITTED },
              startDate: { lte: today },
              endDate: { gte: today },
            },
          },
        },
      );
    }
    if (q) {
      and.push({
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { professions: { has: q } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total, rates] = await Promise.all([
      this.prisma.talentProfile.findMany({
        where,
        include: rosterInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.talentProfile.count({ where }),
      this.rates(),
    ]);
    return paginate(
      rows.map((r) => this.toRow(r, rates, today)),
      total,
      query,
    );
  }

  /** The admin profile view: everything the talent filled in, plus Eskista's side. */
  async profile(id: string): Promise<TalentAdminProfileResponse> {
    const t = await this.prisma.talentProfile.findUnique({
      where: { id },
      include: {
        ...talentInclude,
        payoutAccounts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        reviews: {
          where: { isPublished: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { author: { select: { name: true } } },
        },
        settlements: {
          where: { status: { not: SettlementStatus.PAID } },
          select: { netMinor: true },
        },
        verifiedByAdmin: { select: { name: true } },
        registeredBy: { select: { name: true } },
      },
    });
    if (!t) throw new NotFoundException('Talent not found');
    const rates = await this.rates();
    const today = new Date(new Date().toISOString().slice(0, 10));
    const committed = await this.prisma.booking.findMany({
      where: { talentProfileId: id, status: { in: TALENT_COMMITTED } },
      select: { reference: true, startDate: true, endDate: true, status: true },
      orderBy: { startDate: 'asc' },
    });
    const commission = t.commissionRateBps ?? rates.commissionBps;

    return {
      ...this.toRow({ ...t, bookings: committed }, rates, today),
      headline: t.headline,
      about: t.bio,
      engagementType: humanise(t.pricingModel),
      commissionRateBps: commission,
      vatBps: rates.vatBps,
      phone: t.phone,
      email: t.email,
      profileUrl: profileUrlFor(t.slug),
      professions: t.professions,
      specializations: t.specializations,
      skills: t.skills,
      languages: t.languages,
      experienceLevel: t.experienceLevel,
      yearsExperience: t.yearsExperience,
      workingDays: t.workingDays,
      dayType: t.dayType,
      cvUrl: `/api/v1/admin/talent/${t.id}/cv.pdf`,
      payoutAccounts: t.payoutAccounts.map(toPayoutAccountResponse),
      payoutChannel: t.payoutAccounts[0] ? toPayoutAccountResponse(t.payoutAccounts[0]) : null,
      pendingPayoutMinor: t.settlements.reduce((sum, s) => sum + s.netMinor, 0),
      services: t.services.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        pricingModel: s.pricingModel,
        priceMinor: s.priceMinor,
        customerPriceMinor: customerUnitPrice(s.priceMinor, commission, rates.vatBps),
        isActive: s.isActive,
      })),
      portfolio: t.portfolio.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        client: p.clientOrAgency,
        role: p.role,
        startDate: p.startDate?.toISOString().slice(0, 10) ?? null,
        endDate: p.endDate?.toISOString().slice(0, 10) ?? null,
        coverUrl: p.fileKey ? this.storage.urlFor(p.fileKey) : null,
        workLink: p.externalUrl,
      })),
      experiences: t.experiences.map((e) => ({
        id: e.id,
        title: e.title,
        company: e.company,
        startDate: e.startDate?.toISOString().slice(0, 10) ?? null,
        endDate: e.endDate?.toISOString().slice(0, 10) ?? null,
        isCurrent: e.isCurrent,
        description: e.description,
      })),
      educations: t.educations.map((e) => ({
        id: e.id,
        institution: e.institution,
        fieldOfStudy: e.fieldOfStudy,
        qualification: e.qualification,
        startYear: e.startYear,
        endYear: e.endYear,
      })),
      references: t.references.map((r) => ({
        id: r.id,
        name: r.name,
        contact: r.contact,
        relationship: r.relationship,
      })),
      documents: t.documents.map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        fileName: d.fileName,
        url: this.storage.urlFor(d.fileKey),
        uploadedAt: d.createdAt.toISOString(),
      })),
      checklist: {
        identity: t.identityCheck,
        portfolio: t.portfolioCheck,
        references: t.referenceCheck,
      },
      reviews: t.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        author: r.author.name,
        createdAt: r.createdAt.toISOString(),
      })),
      upcoming: committed.map((b) => ({
        reference: b.reference,
        startDate: b.startDate.toISOString().slice(0, 10),
        endDate: b.endDate.toISOString().slice(0, 10),
        status: b.status,
      })),
      submittedAt: t.submittedAt?.toISOString() ?? null,
      verifiedAt: t.verifiedAt?.toISOString() ?? null,
      verifiedBy: t.verifiedByAdmin?.name ?? null,
      rejectionReason: t.rejectionReason,
      suspendedAt: t.suspendedAt?.toISOString() ?? null,
      suspendedReason: t.suspendedReason,
      registeredBy: t.registeredBy?.name ?? null,
      claimPending: t.claimCode !== null,
      claimCodeExpiresAt: t.claimCodeExpiresAt?.toISOString() ?? null,
    };
  }

  async cvPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const t = await this.prisma.talentProfile.findUnique({ where: { id }, include: talentInclude });
    if (!t) throw new NotFoundException('Talent not found');
    const buffer = await renderCvPdf(this.work.cvFor(t, true));
    return { buffer, filename: `${t.slug ?? 'talent'}-cv.pdf` };
  }

  /** Suspend Profile: hidden from clients and from new invitations. Open bookings go on. */
  async suspend(adminId: string, id: string, reason: string): Promise<TalentAdminProfileResponse> {
    const t = await this.prisma.talentProfile.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Talent not found');
    if (t.status === VerificationStatus.SUSPENDED) return this.profile(id);
    await this.prisma.talentProfile.update({
      where: { id },
      data: {
        status: VerificationStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedReason: reason,
      },
    });
    await this.notifications.send(t.userId, 'TALENT_PROFILE_SUSPENDED', { reason });
    await this.audit.record(
      adminId,
      'talent.suspend',
      'TalentProfile',
      id,
      { status: t.status },
      undefined,
      reason,
    );
    return this.profile(id);
  }

  async reactivate(adminId: string, id: string): Promise<TalentAdminProfileResponse> {
    const t = await this.prisma.talentProfile.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Talent not found');
    if (t.status !== VerificationStatus.SUSPENDED) {
      throw new ConflictException('Only a suspended profile can be reactivated');
    }
    await this.prisma.talentProfile.update({
      where: { id },
      data: {
        // Back to verified only if it had been verified; otherwise to review.
        status: t.verifiedAt ? VerificationStatus.VERIFIED : VerificationStatus.PENDING_REVIEW,
        suspendedAt: null,
        suspendedReason: null,
      },
    });
    await this.audit.record(adminId, 'talent.reactivate', 'TalentProfile', id);
    return this.profile(id);
  }

  /**
   * Register New Talent, for someone Eskista works with who has not joined yet. The profile
   * sits on a stand-in account until the person enters the claim code in the Mini App,
   * which moves it onto their Telegram account.
   */
  async register(adminId: string, dto: RegisterTalentDto): Promise<RegisteredTalentResponse> {
    const claimCode = newClaimCode();
    const expiresAt = new Date(Date.now() + CLAIM_DAYS * 86_400_000);
    const now = new Date();

    const profile = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.displayName,
          // Never a sign-in identity: nobody has a credential for it.
          email: `talent-${randomUUID()}@${REGISTERED_EMAIL_DOMAIN}`,
          activeRole: Role.TALENT,
          roles: { create: [{ role: Role.TALENT }] },
        },
        select: { id: true },
      });
      return tx.talentProfile.create({
        data: {
          userId: user.id,
          displayName: dto.displayName,
          phone: dto.phone,
          email: dto.email,
          location: dto.location,
          professions: dto.professions,
          pricingModel: dto.pricingModel ?? PricingModel.PER_DAY,
          baseRateMinor: dto.baseRateMinor,
          bio: dto.bio,
          registeredByAdminId: adminId,
          claimCode,
          claimCodeExpiresAt: expiresAt,
          ...(dto.verify
            ? {
                status: VerificationStatus.VERIFIED,
                verifiedAt: now,
                verifiedByAdminId: adminId,
                submittedAt: now,
              }
            : { status: VerificationStatus.DRAFT }),
        },
        select: { id: true },
      });
    });
    await this.audit.record(adminId, 'talent.register', 'TalentProfile', profile.id, undefined, {
      displayName: dto.displayName,
      verify: dto.verify ?? false,
    });
    return { id: profile.id, claimCode, claimCodeExpiresAt: expiresAt.toISOString() };
  }

  /** A fresh claim code, when the first one was lost or ran out. */
  async reissueClaim(adminId: string, id: string): Promise<RegisteredTalentResponse> {
    const t = await this.prisma.talentProfile.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    });
    if (!t) throw new NotFoundException('Talent not found');
    if (!t.user.email.endsWith(`@${REGISTERED_EMAIL_DOMAIN}`)) {
      throw new ConflictException('This profile already belongs to its talent');
    }
    const claimCode = newClaimCode();
    const expiresAt = new Date(Date.now() + CLAIM_DAYS * 86_400_000);
    await this.prisma.talentProfile.update({
      where: { id },
      data: { claimCode, claimCodeExpiresAt: expiresAt },
    });
    await this.audit.record(adminId, 'talent.claim.reissue', 'TalentProfile', id);
    return { id, claimCode, claimCodeExpiresAt: expiresAt.toISOString() };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async rates(): Promise<{ commissionBps: number; vatBps: number }> {
    const [commissionBps, vatBps] = await Promise.all([
      this.settings.commissionBps(),
      this.settings.vatBps(),
    ]);
    return { commissionBps, vatBps };
  }

  private toRow(
    t: Omit<RosterRow, 'bookings'> & { bookings: { startDate: Date; endDate: Date }[] },
    rates: { commissionBps: number; vatBps: number },
    today: Date,
  ): TalentRosterRowResponse {
    const booked = t.bookings.some((b) => b.startDate <= today && b.endDate >= today);
    const hireable = t.status === VerificationStatus.VERIFIED && t.isAvailableForHire;
    return {
      id: t.id,
      name: t.displayName,
      avatarUrl: talentAvatarUrl(t, this.storage),
      category: t.professions[0] ?? null,
      baseRateMinor: t.baseRateMinor,
      customerRateMinor:
        t.baseRateMinor === null
          ? null
          : customerUnitPrice(
              t.baseRateMinor,
              t.commissionRateBps ?? rates.commissionBps,
              rates.vatBps,
            ),
      pricingModel: t.pricingModel,
      availability: booked ? 'BOOKED' : hireable ? 'AVAILABLE' : 'UNAVAILABLE',
      status: t.status,
      statusLabel:
        t.status === VerificationStatus.PENDING_REVIEW
          ? 'Pending Verification'
          : humanise(t.status),
      location: t.location,
      rating: Number(t.ratingAvg),
      completedBookings: t.completedBookings,
      featureTier: t.featureTier,
      joinedAt: t.createdAt.toISOString(),
    };
  }
}
