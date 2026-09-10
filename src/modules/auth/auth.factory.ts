import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.validation';
import { telegramMiniApp } from './telegram/telegram-mini-app.plugin';

/**
 * Builds the Better Auth instance.
 *
 * Three sign-in paths, deliberately ranked:
 *   1. Telegram Mini App  — the primary path for customers and vendors (custom plugin).
 *   2. Email + password   — for Eskista admin staff, who work from a dashboard.
 *   3. Social OAuth       — reserve path, enabled per provider only when configured.
 *
 * Better Auth owns the User / Session / Account / Verification tables; every other table
 * in the schema is domain data keyed on User.id. See docs/DOMAIN-ANALYSIS.md.
 */
export type Auth = ReturnType<typeof createAuth>;

export interface CreateAuthDeps {
  env: Env;
  prisma: PrismaClient;
  /** Grants the default CUSTOMER role to a freshly provisioned Telegram user. */
  onTelegramUserCreated?: (args: { userId: string; telegramUserId: string }) => Promise<void>;
  onTelegramVerificationFailure?: (reason: string) => void;
}

export function createAuth({
  env,
  prisma,
  onTelegramUserCreated,
  onTelegramVerificationFailure,
}: CreateAuthDeps) {
  const trustedOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }

  return betterAuth({
    appName: 'Eskista Marketplace',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',

    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    trustedOrigins,

    // Admin staff only. Mini App users have no password — their credential is Telegram.
    emailAndPassword: {
      enabled: true,
      // Admins are provisioned by Eskista, never self-registered.
      disableSignUp: true,
      minPasswordLength: 12,
      requireEmailVerification: false,
    },

    socialProviders,

    plugins: [
      telegramMiniApp({
        botToken: env.TELEGRAM_BOT_TOKEN,
        maxAgeSeconds: env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
        onUserCreated: onTelegramUserCreated,
        onVerificationFailure: onTelegramVerificationFailure,
      }),
    ],

    user: {
      // Columns beyond Better Auth's canonical four. `input: false` keeps every one of
      // them server-assigned — a client must never be able to set its own role.
      additionalFields: {
        telegramUserId: { type: 'string', required: false, input: false, unique: true },
        telegramUsername: { type: 'string', required: false, input: false },
        phone: { type: 'string', required: false, input: false },
        languageCode: { type: 'string', required: false, input: false, defaultValue: 'en' },
        activeRole: { type: 'string', required: false, input: false, defaultValue: 'CUSTOMER' },
        isBlocked: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },

    account: {
      // Lets an admin who also uses the Mini App end up as one user rather than two.
      accountLinking: { enabled: true, trustedProviders: ['google'] },
      encryptOAuthTokens: true,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days — a Mini App should not ask again weekly
      updateAge: 60 * 60 * 24, // slide the expiry at most once a day
      freshAge: 60 * 60, // re-auth window for sensitive admin actions
    },

    rateLimit: {
      enabled: true,
      // Persisted so limits survive restarts and hold across multiple API instances.
      storage: 'database',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/telegram-mini-app': { window: 60, max: 10 },
        '/sign-in/email': { window: 60, max: 5 },
        '/forget-password': { window: 300, max: 3 },
      },
    },

    advanced: {
      // Better Auth's default id is a random string, which Postgres rejects for our
      // `@db.Uuid` columns. This makes it emit UUIDs instead.
      database: { generateId: 'uuid' },
      useSecureCookies: env.NODE_ENV === 'production',
      cookiePrefix: 'eskista',
      defaultCookieAttributes: { sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
  });
}
