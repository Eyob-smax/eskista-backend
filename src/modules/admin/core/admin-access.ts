import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { AdminTier, Role } from '@prisma/client';
import { ApiErrorResponse } from '../../../common/dto/api-docs';
import { Roles } from '../../auth/auth.decorators';
import type { AuthenticatedRequest } from '../../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

export const ADMIN_TIERS_KEY = 'eskista:adminTiers';

/** How often "last active" is written, at most. Every request would be a write per click. */
const TOUCH_EVERY_MS = 5 * 60_000;

export interface AdminRequest extends AuthenticatedRequest {
  adminTier?: AdminTier;
}

/**
 * Whether a tier may use a route declared for `allowed`. Super Admins may use every route;
 * an empty list means any admin.
 */
export function tierAllows(tier: AdminTier, allowed: readonly AdminTier[]): boolean {
  return tier === AdminTier.SUPER_ADMIN || allowed.length === 0 || allowed.includes(tier);
}

/**
 * Restricts a controller or route to admins of these tiers. On a controller it sets the
 * default; a route's own `@AdminAccess(...)` replaces it.
 *
 * - `@AdminAccess()` — any admin (reading, mostly).
 * - `@AdminAccess(AdminTier.FINANCE)` — Finance and Super Admins.
 */
export function AdminAccess(...tiers: AdminTier[]) {
  return applyDecorators(
    Roles(Role.ADMIN),
    SetMetadata(ADMIN_TIERS_KEY, tiers),
    UseGuards(AdminTierGuard),
    ApiBearerAuth(),
    ApiCookieAuth(),
    ApiExtraModels(ApiErrorResponse),
    ApiUnauthorizedResponse({
      description: 'No session, or it expired. Sign in again at `POST /api/auth/sign-in/email`.',
      schema: {
        allOf: [{ $ref: getSchemaPath(ApiErrorResponse) }],
        example: {
          statusCode: 401,
          message: 'Authentication required',
          error: 'Unauthorized',
          path: '/api/v1/admin/overview',
          timestamp: '2026-09-28T09:41:00.000Z',
        },
      },
    }),
    ApiForbiddenResponse({
      description: tiers.length
        ? `Not an admin, suspended, or the wrong tier. Allowed: ${[AdminTier.SUPER_ADMIN, ...tiers].join(', ')}.`
        : 'Not an admin, or the account is suspended.',
      schema: {
        allOf: [{ $ref: getSchemaPath(ApiErrorResponse) }],
        example: {
          statusCode: 403,
          message: tiers.length
            ? `This needs one of: ${[AdminTier.SUPER_ADMIN, ...tiers].join(', ')}`
            : 'Insufficient role',
          error: 'Forbidden',
          path: '/api/v1/admin/…',
          timestamp: '2026-09-28T09:41:00.000Z',
        },
      },
    }),
  );
}

/** The signed-in admin's tier, resolved by the guard. */
export const CurrentAdminTier = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminTier | undefined =>
    ctx.switchToHttp().getRequest<AdminRequest>().adminTier,
);

/**
 * Runs after the global session guard, which has already checked the ADMIN role and that
 * the account is not suspended. Resolves the admin's tier, checks it against the route,
 * and keeps "last active" fresh.
 *
 * An admin with no profile yet — created before tiers existed — counts as ADMIN, never as
 * Super Admin: an unknown tier must not unlock the team screen.
 */
@Injectable()
export class AdminTierGuard implements CanActivate {
  private readonly logger = new Logger(AdminTierGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const user = request.authUser;
    if (!user?.roles.includes(Role.ADMIN)) throw new ForbiddenException('Admins only');

    const allowed =
      this.reflector.getAllAndOverride<AdminTier[] | undefined>(ADMIN_TIERS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const profile = await this.prisma.adminProfile.findUnique({
      where: { userId: user.id },
      select: { tier: true, lastActiveAt: true },
    });
    const tier = profile?.tier ?? AdminTier.ADMIN;
    request.adminTier = tier;

    if (!tierAllows(tier, allowed)) {
      throw new ForbiddenException(
        `This needs one of: ${[AdminTier.SUPER_ADMIN, ...allowed].join(', ')}`,
      );
    }

    const now = Date.now();
    if (
      profile &&
      (!profile.lastActiveAt || now - profile.lastActiveAt.getTime() > TOUCH_EVERY_MS)
    ) {
      // Not awaited into the request: last-active is a courtesy, never a reason to fail.
      this.prisma.adminProfile
        .update({ where: { userId: user.id }, data: { lastActiveAt: new Date(now) } })
        .catch((error: unknown) =>
          this.logger.warn(`Could not touch last active: ${String(error)}`),
        );
    }
    return true;
  }
}
