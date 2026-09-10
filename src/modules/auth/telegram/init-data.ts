import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validation of Telegram Mini App `initData`.
 *
 * Spec: https://core.telegram.org/bots/webapps
 *   secret_key       = HMAC_SHA256(key: "WebAppData", message: bot_token)
 *   data_check_string= every received field EXCEPT `hash`, sorted alphabetically by
 *                      key, formatted `key=value`, joined with "\n"
 *   valid            <=> hex(HMAC_SHA256(key: secret_key, message: data_check_string)) === hash
 *
 * Notes that are easy to get wrong, and are the reason this lives in its own file:
 *
 *  - The HMAC key/message order is inverted between the two steps. The bot token is the
 *    *message* of the first HMAC, not the key.
 *  - Only `hash` is excluded from the check string. `signature` (Telegram's newer
 *    Ed25519 field for third-party validation) IS included, because Telegram computed
 *    the HMAC over it too. Excluding it makes every signed payload fail.
 *  - Values go into the check string **percent-decoded**, which is what
 *    `URLSearchParams` yields.
 *  - This is NOT the Login Widget algorithm. That one uses
 *    `secret = SHA256(bot_token)`. Using it here silently rejects everything.
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
  is_bot?: boolean;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
  queryId?: string;
  chatInstance?: string;
  chatType?: string;
  startParam?: string;
}

export type InitDataFailureReason =
  | 'EMPTY_INIT_DATA'
  | 'MALFORMED_INIT_DATA'
  | 'DUPLICATE_FIELD'
  | 'MISSING_HASH'
  | 'MALFORMED_HASH'
  | 'BAD_SIGNATURE'
  | 'MISSING_AUTH_DATE'
  | 'MALFORMED_AUTH_DATE'
  | 'EXPIRED'
  | 'FUTURE_AUTH_DATE'
  | 'MISSING_USER'
  | 'MALFORMED_USER';

export type InitDataResult =
  | { ok: true; data: ValidatedInitData }
  | { ok: false; reason: InitDataFailureReason };

export interface VerifyInitDataOptions {
  /** Reject payloads older than this. Telegram suggests checking auth_date; 24h is a sane cap. */
  maxAgeSeconds?: number;
  /** Tolerance for clock skew when auth_date is in the future. */
  clockSkewSeconds?: number;
  /** Injectable for deterministic tests. */
  now?: () => number;
}

const DEFAULT_MAX_AGE_SECONDS = 86_400;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * Verifies an `initData` query string against the bot token.
 *
 * Returns a discriminated result rather than throwing, so the caller decides what to
 * expose. Never surface `reason` to the client — it is for logs only.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: VerifyInitDataOptions = {},
): InitDataResult {
  const {
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
    clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
    now = Date.now,
  } = options;

  if (!botToken) {
    // A misconfigured server must never be able to "pass" validation.
    throw new Error('verifyTelegramInitData called without a bot token');
  }
  if (typeof initData !== 'string' || initData.length === 0) {
    return { ok: false, reason: 'EMPTY_INIT_DATA' };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'MALFORMED_INIT_DATA' };
  }

  // Reject repeated keys outright: which duplicate "wins" differs between our parser
  // and Telegram's, which is exactly the ambiguity a smuggling attempt would exploit.
  const seen = new Set<string>();
  const fields: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    if (seen.has(key)) return { ok: false, reason: 'DUPLICATE_FIELD' };
    seen.add(key);
    fields.push([key, value]);
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'MISSING_HASH' };
  if (!HEX_64.test(hash)) return { ok: false, reason: 'MALFORMED_HASH' };

  const dataCheckString = fields
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const provided = Buffer.from(hash, 'hex');

  // Lengths are equal by construction (HEX_64 above), but timingSafeEqual throws on a
  // mismatch, so keep the guard.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  // ── Signature is valid from here on; now validate the payload itself. ──

  const rawAuthDate = params.get('auth_date');
  if (!rawAuthDate) return { ok: false, reason: 'MISSING_AUTH_DATE' };
  if (!/^\d+$/.test(rawAuthDate)) return { ok: false, reason: 'MALFORMED_AUTH_DATE' };

  const authDateSeconds = Number(rawAuthDate);
  if (!Number.isSafeInteger(authDateSeconds)) {
    return { ok: false, reason: 'MALFORMED_AUTH_DATE' };
  }

  const nowSeconds = Math.floor(now() / 1000);
  if (authDateSeconds > nowSeconds + clockSkewSeconds) {
    return { ok: false, reason: 'FUTURE_AUTH_DATE' };
  }
  if (maxAgeSeconds > 0 && nowSeconds - authDateSeconds > maxAgeSeconds) {
    return { ok: false, reason: 'EXPIRED' };
  }

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'MISSING_USER' };

  let user: TelegramUser;
  try {
    const parsed: unknown = JSON.parse(rawUser);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, reason: 'MALFORMED_USER' };
    }
    const candidate = parsed as Partial<TelegramUser>;
    if (typeof candidate.id !== 'number' || !Number.isSafeInteger(candidate.id)) {
      return { ok: false, reason: 'MALFORMED_USER' };
    }
    if (candidate.is_bot === true) {
      return { ok: false, reason: 'MALFORMED_USER' };
    }
    user = candidate as TelegramUser;
  } catch {
    return { ok: false, reason: 'MALFORMED_USER' };
  }

  return {
    ok: true,
    data: {
      user,
      authDate: new Date(authDateSeconds * 1000),
      queryId: params.get('query_id') ?? undefined,
      chatInstance: params.get('chat_instance') ?? undefined,
      chatType: params.get('chat_type') ?? undefined,
      startParam: params.get('start_param') ?? undefined,
    },
  };
}

/** Composes Telegram's name parts into Better Auth's single required `name` column. */
export function telegramDisplayName(user: TelegramUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (user.username) return user.username;
  return `Telegram ${user.id}`;
}
