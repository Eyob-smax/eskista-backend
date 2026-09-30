/**
 * Creates the first Super Admin, or any admin, from the command line — for a fresh
 * production database, where nobody can sign in to the dashboard to create one.
 *
 *   pnpm admin:create --email abel@eskista.et --name "Abel Tesfaye" --tier SUPER_ADMIN
 *
 * The password is read from ADMIN_PASSWORD so it never lands in shell history; it must be
 * at least 12 characters.
 */
import { existsSync } from 'node:fs';
import { AdminTier, PrismaClient } from '@prisma/client';
import { createAdminUser, MIN_ADMIN_PASSWORD } from '../src/modules/admin/team/admin-credentials';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const email = arg('email');
  const name = arg('name');
  const tier = (arg('tier') ?? AdminTier.SUPER_ADMIN) as AdminTier;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !name) throw new Error('Usage: --email <email> --name "<name>" [--tier SUPER_ADMIN]');
  if (!Object.values(AdminTier).includes(tier)) throw new Error(`Unknown tier ${tier}`);
  if (!password || password.length < MIN_ADMIN_PASSWORD) {
    throw new Error(`Set ADMIN_PASSWORD (at least ${MIN_ADMIN_PASSWORD} characters)`);
  }

  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email: email.toLowerCase() } })) {
      throw new Error(`${email} already has an account`);
    }
    const { id } = await createAdminUser(prisma, { name, email, password, tier });
    console.log(`Created ${tier} ${email} (${id}). Sign in at POST /api/auth/sign-in/email.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
