import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_INSTANCE } from './auth.constants';
import { createAuth, type Auth } from './auth.factory';
import { SessionGuard } from './session.guard';

const logger = new Logger('Auth');

@Global()
@Module({
  providers: [
    {
      provide: AUTH_INSTANCE,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService): Auth =>
        createAuth({
          // The whole validated env is handed over so the factory stays framework-free
          // and unit-testable without Nest.
          env: {
            NODE_ENV: config.get('NODE_ENV', { infer: true }),
            CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
            BETTER_AUTH_SECRET: config.get('BETTER_AUTH_SECRET', { infer: true }),
            BETTER_AUTH_URL: config.get('BETTER_AUTH_URL', { infer: true }),
            TELEGRAM_BOT_TOKEN: config.get('TELEGRAM_BOT_TOKEN', { infer: true }),
            TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: config.get(
              'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
              { infer: true },
            ),
            GOOGLE_CLIENT_ID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
            GOOGLE_CLIENT_SECRET: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
          } as Env,
          prisma,

          // Domain concern, kept out of the auth plugin: a new Telegram user starts as
          // a customer. Becoming a vendor is a separate, admin-verified step.
          onTelegramUserCreated: async ({ userId }) => {
            await prisma.roleMembership.create({
              data: { userId, role: 'CUSTOMER' },
            });
          },

          onTelegramVerificationFailure: (reason) => {
            // Logged, never returned: the client always sees one generic 401.
            logger.warn(`Telegram initData rejected: ${reason}`);
          },
        }),
    },
    SessionGuard,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AUTH_INSTANCE],
})
export class AuthModule {}
