import { validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://eskista:pw@localhost:5435/eskista?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  BETTER_AUTH_URL: 'http://localhost:3000',
  TELEGRAM_BOT_TOKEN: '123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv({ ...valid });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS).toBe(86_400);
  });

  it('coerces numeric strings, since process.env is all strings', () => {
    const env = validateEnv({ ...valid, PORT: '8080', THROTTLE_LIMIT: '5' });

    expect(env.PORT).toBe(8080);
    expect(env.THROTTLE_LIMIT).toBe(5);
  });

  it('rejects a short auth secret at boot rather than at runtime', () => {
    expect(() => validateEnv({ ...valid, BETTER_AUTH_SECRET: 'too-short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('rejects a placeholder auth secret even when long enough', () => {
    // A 48-char placeholder would otherwise sail through the length check.
    expect(() =>
      validateEnv({ ...valid, BETTER_AUTH_SECRET: `change_me_${'x'.repeat(40)}` }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('rejects a malformed bot token', () => {
    expect(() => validateEnv({ ...valid, TELEGRAM_BOT_TOKEN: 'short' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'BETTER_AUTH_URL', 'TELEGRAM_BOT_TOKEN'])(
    'rejects a missing %s',
    (key) => {
      const partial: Record<string, unknown> = { ...valid };
      delete partial[key];

      expect(() => validateEnv(partial)).toThrow(new RegExp(key));
    },
  );

  it('leaves OAuth credentials optional, so providers are opt-in', () => {
    const env = validateEnv({ ...valid });

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });
});

const cloudinary = {
  CLOUDINARY_CLOUD_NAME: 'demo',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
};

describe('storage configuration', () => {
  it('uses Cloudinary by default once its credentials are set', () => {
    expect(validateEnv({ ...valid, ...cloudinary }).STORAGE_DRIVER).toBe('cloudinary');
  });

  it('falls back to local disk in development without credentials', () => {
    expect(validateEnv(valid).STORAGE_DRIVER).toBe('local');
  });

  it('refuses Cloudinary with a credential missing', () => {
    expect(() =>
      validateEnv({ ...valid, STORAGE_DRIVER: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'demo' }),
    ).toThrow('CLOUDINARY_API_SECRET');
  });

  it('refuses to run production on local disk', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      'production stores files on Cloudinary',
    );
  });

  it('allows local disk when asked for explicitly in development', () => {
    expect(validateEnv({ ...valid, ...cloudinary, STORAGE_DRIVER: 'local' }).STORAGE_DRIVER).toBe(
      'local',
    );
  });

  it('treats a blank STORAGE_DRIVER line as unset', () => {
    expect(validateEnv({ ...valid, ...cloudinary, STORAGE_DRIVER: '' }).STORAGE_DRIVER).toBe(
      'cloudinary',
    );
  });
});
