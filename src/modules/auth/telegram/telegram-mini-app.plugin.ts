/* eslint-disable @typescript-eslint/only-throw-error --
 * Better Auth's APIError does extend Error at runtime. Its type chain lives in
 * @better-auth/core, which is a transitive dependency and not resolvable from this
 * project under pnpm's strict node_modules layout, so the rule cannot prove it.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';
import {
  telegramDisplayName,
  verifyTelegramInitData,
  type InitDataFailureReason,
} from './init-data';

/**
 * Sign-in with a Telegram Mini App.
 *
 * There is no official Telegram provider in Better Auth, and the Mini App flow is not
 * OAuth, so this is a custom plugin modelled on Better Auth's shipped `siwe` plugin:
 * verify an external proof of identity, then mint a normal Better Auth session so the
 * rest of the framework (session cookies, `getSession`, revocation) works unchanged.
 *
 * Imports deliberately come only from `better-auth/*`. The bundled plugins import some
 * helpers from `@better-auth/core/*`, but that package is a transitive dependency and is
 * not resolvable from this project under pnpm's strict node_modules layout.
 */

export const TELEGRAM_PROVIDER_ID = 'telegram';

/** RFC 6761 reserved TLD, so these addresses can never be routed or accidentally emailed. */
const PLACEHOLDER_EMAIL_DOMAIN = 'telegram.placeholder.invalid';

export interface TelegramMiniAppOptions {
  /** Bot token from @BotFather. The Mini App must belong to this bot. */
  botToken: string;
  /** Reject initData older than this. Default 24h, per Telegram's guidance. */
  maxAgeSeconds?: number;
  /**
   * Called after a brand-new user is provisioned, inside the same request. Use it for
   * domain concerns (e.g. granting the default CUSTOMER role) so this plugin stays
   * focused on authentication.
   */
  onUserCreated?: (args: { userId: string; telegramUserId: string }) => Promise<void>;
  /** Failed verifications land here. Never returned to the client. */
  onVerificationFailure?: (reason: InitDataFailureReason) => void;
}

function placeholderEmail(telegramUserId: string): string {
  return `${telegramUserId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

interface AccountRow {
  id: string;
  userId: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isBlocked?: boolean;
  activeRole?: string;
  telegramUsername?: string | null;
}

export const telegramMiniApp = (options: TelegramMiniAppOptions): BetterAuthPlugin => {
  if (!options.botToken) {
    // Fail at construction, not at first request — a server with no token must not boot
    // into a state where every sign-in silently 401s.
    throw new Error('telegramMiniApp plugin requires a botToken');
  }

  return {
    id: 'telegram-mini-app',
    endpoints: {
      signInTelegramMiniApp: createAuthEndpoint(
        '/sign-in/telegram-mini-app',
        {
          method: 'POST',
          body: z
            .object({
              /** The raw `window.Telegram.WebApp.initData` query string, unmodified. */
              initData: z.string().min(1).max(8192),
            })
            .strict(),
          requireRequest: true,
          metadata: {
            openapi: {
              summary: 'Sign in with a Telegram Mini App',
              description:
                'Validates Telegram initData (HMAC-SHA256 against the bot token) and ' +
                'issues a session. Creates the user on first sign-in.',
              responses: {
                200: { description: 'Session issued' },
                401: { description: 'initData missing, tampered with, or expired' },
                403: { description: 'Account is blocked' },
              },
            },
          },
        },
        async (ctx) => {
          const verified = verifyTelegramInitData(ctx.body.initData, options.botToken, {
            maxAgeSeconds: options.maxAgeSeconds,
          });

          if (!verified.ok) {
            options.onVerificationFailure?.(verified.reason);
            // One generic message for every failure mode: never tell a caller whether a
            // signature was wrong, replayed, or stale.
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'Invalid Telegram credentials',
              status: 401,
              code: 'TELEGRAM_INVALID_INIT_DATA',
            });
          }

          const tgUser = verified.data.user;
          const telegramUserId = String(tgUser.id);
          const displayName = telegramDisplayName(tgUser);

          const existingAccount = await ctx.context.adapter.findOne<AccountRow>({
            model: 'account',
            where: [
              { field: 'providerId', value: TELEGRAM_PROVIDER_ID },
              { field: 'accountId', value: telegramUserId },
            ],
          });

          let user: UserRow;
          let isNewUser = false;

          if (existingAccount) {
            const found = await ctx.context.internalAdapter.findUserById(existingAccount.userId);
            if (!found) {
              // Account row orphaned from its user — refuse rather than silently
              // provisioning a second identity for the same Telegram id.
              throw APIError.fromStatus('UNAUTHORIZED', {
                message: 'Invalid Telegram credentials',
                status: 401,
                code: 'TELEGRAM_INVALID_INIT_DATA',
              });
            }
            user = found;

            // Telegram is the source of truth for these, so refresh them on every login.
            const changes: Record<string, unknown> = {};
            if (user.name !== displayName) changes.name = displayName;
            if (tgUser.photo_url && user.image !== tgUser.photo_url) {
              changes.image = tgUser.photo_url;
            }
            if ((user.telegramUsername ?? undefined) !== tgUser.username) {
              changes.telegramUsername = tgUser.username ?? null;
            }
            if (Object.keys(changes).length > 0) {
              user = await ctx.context.internalAdapter.updateUser(user.id, changes);
            }
          } else {
            isNewUser = true;
            user = await ctx.context.internalAdapter.createUser(
              {
                name: displayName,
                // Telegram never gives us an address; a placeholder keeps Better Auth's
                // required-and-unique email contract satisfied without pretending the
                // address is real or verified.
                email: placeholderEmail(telegramUserId),
                emailVerified: false,
                image: tgUser.photo_url ?? null,
                telegramUserId,
                telegramUsername: tgUser.username ?? null,
                languageCode: tgUser.language_code ?? 'en',
              },
              { method: 'telegram-mini-app' },
            );

            await ctx.context.internalAdapter.createAccount({
              userId: user.id,
              providerId: TELEGRAM_PROVIDER_ID,
              accountId: telegramUserId,
            });

            await options.onUserCreated?.({ userId: user.id, telegramUserId });
          }

          if (user.isBlocked) {
            throw APIError.fromStatus('FORBIDDEN', {
              message: 'This account has been suspended',
              status: 403,
              code: 'ACCOUNT_BLOCKED',
            });
          }

          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw APIError.fromStatus('INTERNAL_SERVER_ERROR', {
              message: 'Could not create session',
              status: 500,
            });
          }

          await setSessionCookie(ctx, { session, user: user as never });

          return ctx.json({
            token: session.token,
            isNewUser,
            user: {
              id: user.id,
              name: user.name,
              image: user.image ?? null,
              activeRole: user.activeRole ?? 'CUSTOMER',
              telegramUserId,
            },
          });
        },
      ),
    },
  };
};
