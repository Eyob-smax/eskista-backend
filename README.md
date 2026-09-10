# Eskista Marketplace — API

Backend for Eskista, a managed marketplace for Ethiopia's creative industry: vendors list
equipment, customers submit rental requests, and the Eskista team advances every booking
through its lifecycle manually from an admin surface.

Delivered as a **Telegram Mini App** plus an admin dashboard.

> **Status: scaffold + data model.** All 41 customer and vendor screens have been reviewed
> and the schema is derived from them — 26 tables, 17 enums. Every non-obvious modelling
> decision is justified against a specific screen in
> [`docs/DOMAIN-ANALYSIS.md`](docs/DOMAIN-ANALYSIS.md); read it before changing the schema.
> No API modules are implemented yet beyond health.
>
> Admin screens have not been supplied; the admin surface in the analysis is inferred.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | NestJS 11 (TypeScript, `strict`) |
| Database | PostgreSQL 17 via Prisma |
| Cache | Redis 7 (global, Keyv-backed) |
| Logging | pino (`nestjs-pino`), credentials redacted |
| Validation | `class-validator` for DTOs, Zod for env |
| Files | Local disk behind a `StorageDriver` interface |
| Docs | Swagger at `/docs` (non-production only) |

## Getting started

```bash
cp .env.example .env          # then set BETTER_AUTH_SECRET and TELEGRAM_BOT_TOKEN
docker compose up -d          # postgres + redis + api (hot reload)
pnpm prisma migrate deploy    # apply migrations
```

Postgres is published on host port **5435** (not 5432) to avoid colliding with other local
Postgres instances; change `POSTGRES_PORT` if that port is taken too.

Or run the API on the host against containerised infrastructure:

```bash
docker compose up -d postgres redis
pnpm install
pnpm prisma generate
pnpm start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/api/v1/health`

### Generating secrets

```bash
openssl rand -base64 48
```

Env validation is fail-fast: a secret under 32 characters stops the app at boot rather than
surfacing as a runtime error later.

## Layout

```
prisma/schema.prisma        26 models derived from the designs
prisma/migrations/          initial migration (generated offline via `migrate diff`)
src/
  main.ts                   bootstrap: helmet, CORS, versioning, swagger, static files
  app.module.ts             config, logging, throttling, cache, feature modules
  common/filters/           global exception filter (logs internals, never returns them)
  config/env.validation.ts  Zod env schema
  modules/prisma/           global PrismaService with connect/disconnect lifecycle
  modules/storage/          StorageDriver interface + local-disk implementation
  modules/health/           terminus health check incl. Postgres ping
design/                     Figma PNG exports (see design/README.md)
docs/DOMAIN-ANALYSIS.md     screen-by-screen findings driving the data model
```

## Security posture

- `helmet` security headers; CORS restricted to a configured allowlist (denies all if unset)
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` — unknown fields are
  rejected, not silently dropped
- Global rate limiting via `@nestjs/throttler`
- Auth headers, cookies, passwords and tokens redacted from logs
- Production image runs as the non-root `node` user
- Upload filenames are UUIDs and folder paths are sanitised, so a caller cannot escape the
  storage root

## Authentication

Built on [Better Auth](https://better-auth.com) 1.7.x, which owns the `User`, `Session`,
`Account`, `Verification` and `RateLimit` tables. Everything else in the schema is domain
data keyed on `User.id`.

Mounted as raw Express middleware at **`/api/auth/*`**, so it sits outside the global `api`
prefix and URI versioning. It must be mounted **before** any body parser — Better Auth reads
the raw request stream, so `bodyParser: false` is set on the Nest app and `express.json()`
is re-applied afterwards in `main.ts`. Reordering these breaks every POST.

Three sign-in paths, in order of importance:

| Path | Endpoint | Who |
| --- | --- | --- |
| Telegram Mini App | `POST /api/auth/sign-in/telegram-mini-app` | customers, vendors |
| Email + password | `POST /api/auth/sign-in/email` | Eskista admin staff (sign-up disabled) |
| Social OAuth | `GET /api/auth/sign-in/social` | reserve; per provider, only when configured |

### Telegram Mini App

`src/modules/auth/telegram/init-data.ts` validates `initData` per
[Telegram's spec](https://core.telegram.org/bots/webapps): `secret = HMAC_SHA256(key:
"WebAppData", message: bot_token)`, then `hash = HMAC_SHA256(key: secret, message:
data_check_string)`. Three details that are easy to get wrong, and are covered by tests:

- The HMAC key/message order **inverts** between the two steps.
- Only `hash` is excluded from the check string — `signature` is included.
- This is not the Login Widget algorithm (`secret = SHA256(bot_token)`), which would reject
  everything.

On top of the signature check: `auth_date` freshness with clock-skew tolerance, rejection of
duplicate query keys, and `crypto.timingSafeEqual` for the comparison. Clients always receive
one generic `401`; the specific reason is logged server-side only.

Telegram supplies no email address, so Mini App users get a non-routable placeholder
(`<tgId>@telegram.placeholder.invalid`) to satisfy Better Auth's required-and-unique email
contract. First sign-in provisions the user and grants the `CUSTOMER` role.

### Guarding routes

`SessionGuard` is registered globally, so routes are **deny-by-default**:

```ts
@Public()                       // no session required
@Roles('ADMIN')                 // checked against granted roles, not the active experience
@CurrentUser() user: SessionUser
```

Roles come from `RoleMembership`, not from the session — switching the app into customer mode
must not drop a user's vendor authority.

## Notes on pending decisions

- **Payments** are offline/admin-confirmed (Telebirr and bank transfer): the customer
  uploads proof, an admin verifies it. No gateway integration.
- **Notification channels** need revisiting — FCM does not apply to a Mini App; a Telegram
  bot channel replaces it.
- **Double-booking guard** on approval is not yet implemented; see open question 1 in
  `docs/DOMAIN-ANALYSIS.md`.
