import { join } from 'node:path';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { Env } from './config/env.validation';
import { AUTH_INSTANCE } from './modules/auth/auth.constants';
import type { Auth } from './modules/auth/auth.factory';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Better Auth reads the raw request body, so Nest's global body parser is disabled
    // and re-applied below — after the auth handler is mounted.
    bodyParser: false,
  });
  const config: ConfigService<Env, true> = app.get(ConfigService);

  app.useLogger(app.get(PinoLogger));
  app.use(helmet());
  app.use(compression());
  app.enableShutdownHooks();

  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : false, credentials: true });

  // ── Better Auth ──────────────────────────────────────────────────────────────
  // Mounted as raw middleware at its own basePath, so it bypasses the global `api`
  // prefix and URI versioning. MUST come before any body parser: parsing the stream
  // first leaves the handler with an empty body and every POST fails.
  const auth = app.get<Auth>(AUTH_INSTANCE);
  app.use('/api/auth', toNodeHandler(auth));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Local-disk storage driver: serve uploads from the mounted volume.
  app.useStaticAssets(join(process.cwd(), config.get('STORAGE_LOCAL_ROOT', { infer: true })), {
    prefix: '/files/',
  });

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Eskista Marketplace API')
      .setDescription(
        'Managed rental marketplace — customer, vendor and admin surfaces. ' +
          'Authentication lives outside this document at /api/auth/*.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .addCookieAuth('eskista.session_token')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
