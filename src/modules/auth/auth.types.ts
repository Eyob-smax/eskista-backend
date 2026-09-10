import type { Role } from '@prisma/client';
import type { Request } from 'express';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  activeRole: Role;
  isBlocked: boolean;
  telegramUserId: string | null;
  /** Every role granted to this user, independent of the active experience. */
  roles: Role[];
}

export interface AuthenticatedRequest extends Request {
  authUser?: SessionUser;
  authSessionId?: string;
}
