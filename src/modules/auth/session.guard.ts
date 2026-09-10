import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Role } from '@prisma/client';
import { AUTH_INSTANCE, IS_PUBLIC_KEY, ROLES_KEY } from './auth.constants';
import type { Auth } from './auth.factory';
import type { AuthenticatedRequest, SessionUser } from './auth.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Applied globally, so routes are deny-by-default and must opt out with `@Public()`.
 *
 * Session resolution is delegated to Better Auth rather than decoding a token here —
 * that keeps cookie handling, expiry and revocation in one place.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!result?.session || !result.user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Roles live in our own table, so they are fetched rather than read off the session.
    const memberships = await this.prisma.roleMembership.findMany({
      where: { userId: result.user.id },
      select: { role: true },
    });

    const raw = result.user as unknown as {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      activeRole?: Role;
      isBlocked?: boolean;
      telegramUserId?: string | null;
    };

    if (raw.isBlocked) {
      throw new ForbiddenException('This account has been suspended');
    }

    const user: SessionUser = {
      id: raw.id,
      name: raw.name,
      email: raw.email,
      image: raw.image ?? null,
      activeRole: raw.activeRole ?? ('CUSTOMER' as Role),
      isBlocked: false,
      telegramUserId: raw.telegramUserId ?? null,
      roles: memberships.map((m) => m.role),
    };

    request.authUser = user;
    request.authSessionId = result.session.id;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (required?.length && !required.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
