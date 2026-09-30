import { AdminTier, Role, type PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

/** Better Auth's credential provider: the row that holds an email/password login. */
export const CREDENTIAL_PROVIDER = 'credential';

/** Must match `emailAndPassword.minPasswordLength` in the auth factory. */
export const MIN_ADMIN_PASSWORD = 12;
export const MAX_ADMIN_PASSWORD = 128;

export interface NewAdmin {
  name: string;
  email: string;
  password: string;
  tier: AdminTier;
  phone?: string | null;
  title?: string | null;
  createdById?: string | null;
}

type Db = Pick<PrismaClient, 'user' | '$transaction'>;

/**
 * Creates a dashboard admin who signs in with email and password.
 *
 * Sign-up is disabled in Better Auth, so this is the only way an admin account comes to
 * exist: the user, the credential account holding the password hash (hashed exactly as
 * Better Auth hashes it, so its sign-in accepts it), the ADMIN role and the tier.
 *
 * Shared by the Create Admin screen, the bootstrap script and the seed.
 */
export async function createAdminUser(db: Db, input: NewAdmin): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const hash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name.trim(),
        email,
        emailVerified: true,
        activeRole: Role.ADMIN,
        roles: { create: { role: Role.ADMIN } },
        adminProfile: {
          create: {
            tier: input.tier,
            phone: input.phone ?? null,
            title: input.title ?? null,
            createdById: input.createdById ?? null,
          },
        },
      },
      select: { id: true },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        // Better Auth keys a credential account by the user id.
        accountId: user.id,
        providerId: CREDENTIAL_PROVIDER,
        password: hash,
      },
    });
    return user;
  });
}

/** Sets a new password and signs the admin out everywhere, so the old one stops working. */
export async function setAdminPassword(
  db: Pick<PrismaClient, 'account' | 'session' | '$transaction'>,
  userId: string,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const existing = await tx.account.findFirst({
      where: { userId, providerId: CREDENTIAL_PROVIDER },
      select: { id: true },
    });
    if (existing) {
      await tx.account.update({ where: { id: existing.id }, data: { password: hash } });
    } else {
      await tx.account.create({
        data: { userId, accountId: userId, providerId: CREDENTIAL_PROVIDER, password: hash },
      });
    }
    await tx.session.deleteMany({ where: { userId } });
  });
}
