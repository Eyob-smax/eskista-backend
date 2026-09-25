import { createKeyv } from '@keyv/redis';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv, type Env } from './config/env.validation';
import { AccountModule } from './modules/account/account.module';
import { AdminPricingModule } from './modules/admin-pricing/admin-pricing.module';
import { AdminReviewModule } from './modules/admin-review/admin-review.module';
import { AgreementsModule } from './modules/agreements/agreements.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { CustomerBookingsModule } from './modules/customer-bookings/customer-bookings.module';
import { CustomerModule } from './modules/customer/customer.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { SettingsModule } from './modules/settings/settings.module';
import { VendorBookingsModule } from './modules/vendor-bookings/vendor-bookings.module';
import { VendorModule } from './modules/vendor/vendor.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        return {
          pinoHttp: {
            level: isProd ? 'info' : 'debug',
            transport: isProd
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
            // Keep credentials and tokens out of the logs.
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.token',
            ],
          },
        };
      },
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        stores: [createKeyv(config.get('REDIS_URL', { infer: true }))],
        ttl: config.get('CACHE_TTL_MS', { infer: true }),
      }),
    }),

    // Infrastructure
    PrismaModule,
    StorageModule,
    NumberingModule,
    SettingsModule,
    AgreementsModule,
    AuthModule,
    HealthModule,
    NotificationsModule,
    JobsModule,

    // Vendor-side feature modules
    VendorModule,
    EquipmentModule,
    VendorBookingsModule,

    // Shared by every experience
    AccountModule,

    // Admin
    AdminPricingModule,
    AdminReviewModule,

    // Customer-side feature modules
    CatalogueModule,
    CustomerModule,
    CustomerBookingsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
