import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.constants';
import type { AuthenticatedRequest, SessionUser } from './auth.types';

/** Opt a route out of the globally applied session guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restrict a route to users holding at least one of these roles.
 *
 * Checked against the user's granted role memberships, not their currently active
 * experience — switching the app into "customer" mode must not drop vendor authority.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated user, or a single property of it. */
export const CurrentUser = createParamDecorator(
  (property: keyof SessionUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authUser;
    return property ? user?.[property] : user;
  },
);
