import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api'),
  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),
  CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(30_000),

  // ── Better Auth ──────────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
    .refine((v) => !/^change_me/i.test(v), 'BETTER_AUTH_SECRET must not be the placeholder'),
  BETTER_AUTH_URL: z.string().url(),

  // ── Telegram Mini App ────────────────────────────────────────────────────
  /// From @BotFather. The Mini App must belong to this bot, or initData never validates.
  TELEGRAM_BOT_TOKEN: z.string().min(20, 'TELEGRAM_BOT_TOKEN looks malformed'),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),

  // ── Social OAuth (reserve path; each provider activates only when both are set) ──
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  /// Base for file URLs. Points at the authorised FilesController route, not at a
  /// static directory — uploads are never served without an entitlement check.
  STORAGE_PUBLIC_BASE_URL: z.string().default('http://localhost:3000/api/v1/files'),
  STORAGE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10_485_760),
});

export type Env = z.infer<typeof envSchema>;

/** Fail fast at boot rather than surfacing a misconfiguration mid-request. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
