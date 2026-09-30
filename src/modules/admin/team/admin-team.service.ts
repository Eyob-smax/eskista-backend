import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminTier, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from '../core/admin-audit.service';
import { greeting, humanise } from '../core/admin-format';
import { createAdminUser, setAdminPassword } from './admin-credentials';
import {
  AdminMeResponse,
  AdminMemberResponse,
  AdminTeamQuery,
  CreateAdminDto,
  ResetAdminPasswordDto,
  UpdateAdminDto,
} from './dto/admin-team.dto';

const memberInclude = {
  adminProfile: { include: { createdBy: { select: { name: true } } } },
  sessions: { select: { updatedAt: true, expiresAt: true } },
} satisfies Prisma.UserInclude;

type MemberRow = Prisma.UserGetPayload<{ include: typeof memberInclude }>;

/** What each tier may do, for the dashboard to hide what it cannot use. */
export const TIER_PERMISSIONS: Record<AdminTier, string[]> = {
  SUPER_ADMIN: ['team', 'settings', 'finance', 'operations', 'support'],
  ADMIN: ['operations', 'support'],
  FINANCE: ['finance'],
  SUPPORT: ['support'],
};

/**
 * Admin Users & Access Control: the dashboard's own staff.
 *
 * Only a Super Admin changes the team. Two guards keep the dashboard reachable: nobody
 * suspends or demotes themselves, and the last active Super Admin cannot be suspended or
 * demoted — otherwise nobody could manage the team again without a database edit.
 */
@Injectable()
export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async me(adminId: string): Promise<AdminMeResponse> {
    const member = this.toMember(await this.find(adminId));
    const first = member.name.split(' ')[0] ?? member.name;
    return {
      ...member,
      greeting: `${greeting()}, ${first}`,
      permissions: TIER_PERMISSIONS[member.tier],
    };
  }

  async list(query: AdminTeamQuery): Promise<AdminMemberResponse[]> {
    const q = query.q;
    const rows = await this.prisma.user.findMany({
      where: {
        roles: { some: { role: Role.ADMIN } },
        ...(query.status ? { isBlocked: query.status === 'SUSPENDED' } : {}),
        ...(query.tier ? { adminProfile: { tier: query.tier } } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { adminProfile: { phone: { contains: q } } },
              ],
            }
          : {}),
      },
      include: memberInclude,
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((r) => this.toMember(r));
  }

  async get(id: string): Promise<AdminMemberResponse> {
    return this.toMember(await this.find(id));
  }

  async create(actorId: string, dto: CreateAdminDto): Promise<AdminMemberResponse> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const { id } = await createAdminUser(this.prisma, {
      name: dto.name,
      email,
      password: dto.password,
      tier: dto.tier,
      phone: dto.phone,
      title: dto.title,
      createdById: actorId,
    });
    await this.audit.record(actorId, 'admin.create', 'User', id, undefined, {
      email,
      tier: dto.tier,
    });
    return this.get(id);
  }

  async update(actorId: string, id: string, dto: UpdateAdminDto): Promise<AdminMemberResponse> {
    const before = await this.find(id);
    const currentTier = before.adminProfile?.tier ?? AdminTier.ADMIN;

    if (dto.tier && dto.tier !== currentTier) {
      if (id === actorId) throw new BadRequestException('You cannot change your own role tier');
      if (currentTier === AdminTier.SUPER_ADMIN) await this.assertAnotherSuperAdmin(id);
    }
    if (dto.email && dto.email.toLowerCase() !== before.email) {
      const taken = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (taken) throw new ConflictException('An account with this email already exists');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.email ? { email: dto.email.toLowerCase() } : {}),
        adminProfile: {
          upsert: {
            create: { tier: dto.tier ?? currentTier, phone: dto.phone, title: dto.title },
            update: {
              ...(dto.tier ? { tier: dto.tier } : {}),
              ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
              ...(dto.title !== undefined ? { title: dto.title } : {}),
            },
          },
        },
      },
    });
    await this.audit.record(
      actorId,
      'admin.update',
      'User',
      id,
      { name: before.name, email: before.email, tier: currentTier },
      dto,
    );
    return this.get(id);
  }

  async resetPassword(
    actorId: string,
    id: string,
    dto: ResetAdminPasswordDto,
  ): Promise<AdminMemberResponse> {
    await this.find(id);
    await setAdminPassword(this.prisma, id, dto.password);
    await this.audit.record(actorId, 'admin.password.reset', 'User', id);
    return this.get(id);
  }

  /** Suspend Admin: blocks sign-in and ends every session at once. */
  async suspend(actorId: string, id: string, reason: string): Promise<AdminMemberResponse> {
    if (id === actorId) throw new BadRequestException('You cannot suspend yourself');
    const admin = await this.find(id);
    if (admin.isBlocked) return this.toMember(admin);
    if (admin.adminProfile?.tier === AdminTier.SUPER_ADMIN) await this.assertAnotherSuperAdmin(id);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isBlocked: true, blockedAt: now, blockedReason: reason },
      }),
      this.prisma.adminProfile.upsert({
        where: { userId: id },
        create: { userId: id, suspendedAt: now, suspendedReason: reason },
        update: { suspendedAt: now, suspendedReason: reason },
      }),
      this.prisma.session.deleteMany({ where: { userId: id } }),
    ]);
    await this.audit.record(actorId, 'admin.suspend', 'User', id, undefined, undefined, reason);
    return this.get(id);
  }

  async reactivate(actorId: string, id: string): Promise<AdminMemberResponse> {
    await this.find(id);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isBlocked: false, blockedAt: null, blockedReason: null },
      }),
      this.prisma.adminProfile.updateMany({
        where: { userId: id },
        data: { suspendedAt: null, suspendedReason: null },
      }),
    ]);
    await this.audit.record(actorId, 'admin.reactivate', 'User', id);
    return this.get(id);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async assertAnotherSuperAdmin(exceptId: string): Promise<void> {
    const others = await this.prisma.adminProfile.count({
      where: { tier: AdminTier.SUPER_ADMIN, userId: { not: exceptId }, user: { isBlocked: false } },
    });
    if (others === 0) {
      throw new ConflictException('This is the last active Super Admin; appoint another first');
    }
  }

  private async find(id: string): Promise<MemberRow> {
    const user = await this.prisma.user.findFirst({
      where: { id, roles: { some: { role: Role.ADMIN } } },
      include: memberInclude,
    });
    if (!user) throw new NotFoundException('Admin not found');
    return user;
  }

  private toMember(u: MemberRow): AdminMemberResponse {
    const p = u.adminProfile;
    const tier = p?.tier ?? AdminTier.ADMIN;
    const now = Date.now();
    const live = u.sessions.filter((s) => s.expiresAt.getTime() > now);
    // Whichever is later: the guard's touch, or Better Auth refreshing a session.
    const sessionSeen = u.sessions.reduce<Date | null>(
      (latest, s) => (!latest || s.updatedAt > latest ? s.updatedAt : latest),
      null,
    );
    const lastActive = [p?.lastActiveAt ?? null, sessionSeen]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: p?.phone ?? u.phone,
      avatarUrl: u.image,
      tier,
      tierLabel: humanise(tier),
      title: p?.title ?? null,
      status: u.isBlocked ? 'SUSPENDED' : 'ACTIVE',
      suspendedAt: (p?.suspendedAt ?? u.blockedAt)?.toISOString() ?? null,
      suspendedReason: p?.suspendedReason ?? u.blockedReason,
      lastActiveAt: lastActive?.toISOString() ?? null,
      activeSessions: live.length,
      createdByName: p?.createdBy?.name ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
