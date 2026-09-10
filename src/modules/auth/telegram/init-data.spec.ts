import { createHmac } from 'node:crypto';
import { telegramDisplayName, verifyTelegramInitData } from './init-data';

const BOT_TOKEN = '123456:AAEyDpKKl0Y_abcdefghijklmnopqrstuvw';
const OTHER_BOT_TOKEN = '654321:BBFzEqLLm1Z_zyxwvutsrqponmlkjihgf';
const AUTH_DATE = 1_760_000_000; // fixed instant
const NOW_MS = AUTH_DATE * 1000 + 5_000; // 5s after auth_date

const USER = {
  id: 88_112_233,
  first_name: 'Yoseph',
  last_name: 'Bogale',
  username: 'yoseph',
  language_code: 'am',
};

/** Signs a field set exactly the way Telegram does, so the tests exercise real crypto. */
function sign(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const baseFields = (): Record<string, string> => ({
  auth_date: String(AUTH_DATE),
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify(USER),
});

const now = () => NOW_MS;

describe('verifyTelegramInitData', () => {
  it('accepts a correctly signed payload and returns the parsed user', () => {
    const result = verifyTelegramInitData(sign(baseFields()), BOT_TOKEN, { now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.user.id).toBe(USER.id);
    expect(result.data.user.username).toBe('yoseph');
    expect(result.data.authDate.getTime()).toBe(AUTH_DATE * 1000);
    expect(result.data.queryId).toBe('AAHdF6IQAAAAAN0XohDhrOrc');
  });

  it('includes the Ed25519 `signature` field in the check string', () => {
    // Regression guard: excluding `signature` (only `hash` may be excluded) would make
    // every payload from a current Telegram client fail.
    const fields = { ...baseFields(), signature: 'abc_signature_value' };

    expect(verifyTelegramInitData(sign(fields), BOT_TOKEN, { now }).ok).toBe(true);
  });

  it('rejects a payload signed with a different bot token', () => {
    const result = verifyTelegramInitData(sign(baseFields(), OTHER_BOT_TOKEN), BOT_TOKEN, {
      now,
    });

    expect(result).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a tampered user id while keeping the original hash', () => {
    const signed = sign(baseFields());
    const params = new URLSearchParams(signed);
    params.set('user', JSON.stringify({ ...USER, id: 999 }));

    const result = verifyTelegramInitData(params.toString(), BOT_TOKEN, { now });

    expect(result).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects an added field that was not covered by the hash', () => {
    const params = new URLSearchParams(sign(baseFields()));
    params.set('start_param', 'injected');

    expect(verifyTelegramInitData(params.toString(), BOT_TOKEN, { now })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects the Login Widget algorithm (sha256 of the token as the key)', () => {
    // Guards against swapping in the wrong Telegram algorithm.
    const fields = baseFields();
    const dataCheckString = Object.keys(fields)
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('\n');
    const wrongSecret = require('node:crypto')
      .createHash('sha256')
      .update(BOT_TOKEN)
      .digest();
    const hash = createHmac('sha256', wrongSecret).update(dataCheckString).digest('hex');
    const params = new URLSearchParams(fields);
    params.set('hash', hash);

    expect(verifyTelegramInitData(params.toString(), BOT_TOKEN, { now })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects duplicated fields', () => {
    const signed = sign(baseFields());

    expect(verifyTelegramInitData(`${signed}&user=%7B%22id%22%3A1%7D`, BOT_TOKEN, { now })).toEqual(
      { ok: false, reason: 'DUPLICATE_FIELD' },
    );
  });

  it.each([
    ['', 'EMPTY_INIT_DATA'],
    ['auth_date=1&user=%7B%7D', 'MISSING_HASH'],
    ['hash=nothex&auth_date=1', 'MALFORMED_HASH'],
  ])('rejects %p with %s', (input, reason) => {
    expect(verifyTelegramInitData(input, BOT_TOKEN, { now })).toEqual({ ok: false, reason });
  });

  it('rejects a stale payload', () => {
    const result = verifyTelegramInitData(sign(baseFields()), BOT_TOKEN, {
      now: () => (AUTH_DATE + 3600) * 1000,
      maxAgeSeconds: 600,
    });

    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('accepts a payload inside the freshness window', () => {
    const result = verifyTelegramInitData(sign(baseFields()), BOT_TOKEN, {
      now: () => (AUTH_DATE + 599) * 1000,
      maxAgeSeconds: 600,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects an auth_date beyond the clock-skew allowance', () => {
    const result = verifyTelegramInitData(sign(baseFields()), BOT_TOKEN, {
      now: () => (AUTH_DATE - 3600) * 1000,
    });

    expect(result).toEqual({ ok: false, reason: 'FUTURE_AUTH_DATE' });
  });

  it('tolerates small clock skew', () => {
    const result = verifyTelegramInitData(sign(baseFields()), BOT_TOKEN, {
      now: () => (AUTH_DATE - 10) * 1000,
      clockSkewSeconds: 60,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a signed payload with no auth_date', () => {
    const fields = { query_id: 'x', user: JSON.stringify(USER) };

    expect(verifyTelegramInitData(sign(fields), BOT_TOKEN, { now })).toEqual({
      ok: false,
      reason: 'MISSING_AUTH_DATE',
    });
  });

  it('rejects a signed payload with no user', () => {
    const fields = { auth_date: String(AUTH_DATE), query_id: 'x' };

    expect(verifyTelegramInitData(sign(fields), BOT_TOKEN, { now })).toEqual({
      ok: false,
      reason: 'MISSING_USER',
    });
  });

  it.each([
    ['not json', 'MALFORMED_USER'],
    ['{"id":"88112233"}', 'MALFORMED_USER'],
    ['{"first_name":"NoId"}', 'MALFORMED_USER'],
    ['{"id":1,"is_bot":true}', 'MALFORMED_USER'],
  ])('rejects a signed payload whose user is %p', (rawUser, reason) => {
    const fields = { auth_date: String(AUTH_DATE), user: rawUser };

    expect(verifyTelegramInitData(sign(fields), BOT_TOKEN, { now })).toEqual({ ok: false, reason });
  });

  it('throws rather than passing when the server has no bot token', () => {
    expect(() => verifyTelegramInitData(sign(baseFields()), '', { now })).toThrow(/bot token/i);
  });

  it('handles values containing newlines and equals signs', () => {
    // The check string is newline-delimited, so a value containing "\n" is the obvious
    // way to try to forge the layout.
    const fields = {
      auth_date: String(AUTH_DATE),
      user: JSON.stringify({ ...USER, first_name: 'a\nb=c' }),
    };
    const result = verifyTelegramInitData(sign(fields), BOT_TOKEN, { now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.user.first_name).toBe('a\nb=c');
  });
});

describe('telegramDisplayName', () => {
  it.each([
    [{ id: 1, first_name: 'Yoseph', last_name: 'Bogale' }, 'Yoseph Bogale'],
    [{ id: 1, first_name: 'Yoseph' }, 'Yoseph'],
    [{ id: 1, username: 'yoseph' }, 'yoseph'],
    [{ id: 42 }, 'Telegram 42'],
  ])('composes %p into %p', (user, expected) => {
    expect(telegramDisplayName(user)).toBe(expected);
  });
});
