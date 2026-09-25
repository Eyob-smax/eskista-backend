import { z } from 'zod';

const baseSchema = z.object({
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

  /// Where photos and documents live. Defaults to `cloudinary` once its credentials are
  /// set, `local` otherwise (development only — production refuses local disk).
  STORAGE_DRIVER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['local', 'cloudinary']).optional(),
  ),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),

  // ── Cloudinary (Console → Settings → API Keys). The secret stays server-side. ──
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  /// Everything is stored under this top-level folder, so one Cloudinary account can
  /// hold several environments side by side (eskista-dev, eskista-prod).
  CLOUDINARY_FOLDER: z.string().default('eskista'),
  /// Base for file URLs. Points at the authorised FilesController route, not at a
  /// static directory — uploads are never served without an entitlement check.
  STORAGE_PUBLIC_BASE_URL: z.string().default('http://localhost:3000/api/v1/files'),
  STORAGE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10_485_760),
});

export const envSchema = baseSchema
  .transform((env) => ({
    ...env,
    STORAGE_DRIVER:
      env.STORAGE_DRIVER ??
      (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
        ? ('cloudinary' as const)
        : ('local' as const)),
  }))
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 'cloudinary') {
      for (const key of [
        'CLOUDINARY_CLOUD_NAME',
        'CLOUDINARY_API_KEY',
        'CLOUDINARY_API_SECRET',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'required for Cloudinary storage' });
        }
      }
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER !== 'cloudinary') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'production stores files on Cloudinary; set the CLOUDINARY_* variables',
      });
    }
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
