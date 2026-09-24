import { ConflictException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExperienceResponse, MeResponse } from './dto/account.dto';

/**
 * The experiences a user can switch between from the role chooser.
 *
 * ADMIN is deliberately absent: the admin console is a separate surface, not an
 * experience inside the Mini App.
 */
const EXPERIENCES: { role: Role; label: string; onboardingEndpoint: string | null }[] = [
  { role: Role.CUSTOMER, label: 'I want to Rent or Hire', onboardingEndpoint: null },
  {
    role: Role.VENDOR,
    label: 'I want to list my equipment or services',
    onboardingEndpoint: 'POST /api/v1/vendor/onboarding',
  },
  {
    role: Role.TALENT,
    label: 'I want to offer my creative skills',
    onboardingEndpoint: 'POST /api/v1/talent/onboarding',
  },
];

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { select: { role: true } },
        vendor: { select: { id: true } },
        talent: { select: { id: true } },
      },
    });

    // Everyone can be a customer; it needs no onboarding, so it is always granted.
    const roles = [...new Set<Role>([Role.CUSTOMER, ...user.roles.map((r) => r.role)])];

    const hasProfile: Record<string, boolean> = {
      [Role.CUSTOMER]: true,
      [Role.VENDOR]: user.vendor !== null,
      [Role.TALENT]: user.talent !== null,
    };

    const experiences: ExperienceResponse[] = EXPERIENCES.map((e) => {
      const granted = roles.includes(e.role);
      return {
        role: e.role,
        label: e.label,
        granted,
        hasProfile: hasProfile[e.role] ?? false,
        onboardingEndpoint: granted ? null : e.onboardingEndpoint,
      };
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      phone: user.phone,
      telegramUsername: user.telegramUsername,
      activeRole: user.activeRole,
      roles,
      experiences,
      needsExperienceChoice: user.experienceChosenAt === null,
    };
  }

  /**
   * Switches the experience the app opens in.
   *
   * Only ever to a role already held — switching must never *grant* authority. Becoming a
   * vendor or a talent is onboarding, which creates the profile and grants the role; this
   * endpoint only moves between what the user already is. CUSTOMER is the exception: it
   * needs no profile, so it is granted on first switch.
   */
  async switchRole(userId: string, role: Role): Promise<MeResponse> {
    if (role === Role.ADMIN) {
      throw new ConflictException('The admin console is not an experience in the app.');
    }

    if (role === Role.CUSTOMER) {
      await this.prisma.roleMembership.upsert({
        where: { userId_role: { userId, role } },
        create: { userId, role },
        update: {},
      });
    } else {
      const held = await this.prisma.roleMembership.findUnique({
        where: { userId_role: { userId, role } },
      });
      if (!held) {
        const path = EXPERIENCES.find((e) => e.role === role)?.onboardingEndpoint;
        throw new ConflictException(
          `You are not a ${role.toLowerCase()} yet.${path ? ` Start with ${path}.` : ''}`,
        );
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { activeRole: role },
    });
    // Only the first choice is recorded; later switches leave it alone.
    await this.prisma.user.updateMany({
      where: { id: userId, experienceChosenAt: null },
      data: { experienceChosenAt: new Date() },
    });

    return this.me(userId);
  }
}
