import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Two documents from one app:
 *
 * - `/docs`        — every endpoint, for the Mini App and backend developers.
 * - `/docs/admin`  — the operations dashboard alone: admin routes, the email/password
 *   sign-in that lives in Better Auth, and only the schemas those reference.
 *
 * JSON for code generation at `/docs-json` and `/docs/admin-json`.
 */

export const ADMIN_PATH_PREFIX = '/api/v1/admin';

/** Tags in the order of the dashboard sidebar, each with what the screen is for. */
export const ADMIN_TAGS: { name: string; description: string }[] = [
  {
    name: 'admin · auth',
    description: 'Sign in, sign out, the session, changing one’s own password (Better Auth).',
  },
  {
    name: 'admin · overview',
    description:
      'The Overview: greeting, tiles, Attention Required, Recent Bookings, sidebar badges.',
  },
  {
    name: 'admin · team',
    description:
      'Admin Users & Access Control — the signed-in admin, and the staff list (Super Admin edits).',
  },
  {
    name: 'admin · bookings',
    description:
      'Equipment OPS — Booking Requests, Active Rentals, Deliveries & Pickups, and the Booking Detail with every operational step.',
  },
  {
    name: 'admin · agreements',
    description: 'Signed contract scans waiting for review — customer, talent and vendor.',
  },
  {
    name: 'admin · payments',
    description:
      'Finance — Payments Verification: confirm, request a new slip, reject, record cash.',
  },
  {
    name: 'admin · invoices',
    description: 'Finance — invoices, combined invoices, VAT per invoice, voiding.',
  },
  {
    name: 'admin · settlements',
    description: 'Finance — Vendor Payouts & Settlements: breakdown, adjustments, Mark as Paid.',
  },
  {
    name: 'admin · equipment',
    description: 'Catalog & Gear — Equipment Management (units and listings), and Add Equipment.',
  },
  {
    name: 'admin · inspections',
    description: 'Inspections & QA, and each unit’s Condition History.',
  },
  {
    name: 'admin · categories',
    description: 'Equipment Categories and Talent Categories & Skills, with associations.',
  },
  {
    name: 'admin · review',
    description:
      'Listings and talent registrations waiting for approval, with the commission preview.',
  },
  {
    name: 'admin · hiring',
    description:
      'Talent Marketplace — Hiring Requests: invite or hire for the customer, create a request.',
  },
  {
    name: 'admin · talent roster',
    description: 'Talent Marketplace — Roster & Profiles: verify, suspend, register a talent.',
  },
  {
    name: 'admin · issues',
    description: 'Issues & Grievance Desk — equipment issues and client ↔ talent disputes.',
  },
  { name: 'admin · vendors', description: 'User Management — Vendor Accounts.' },
  { name: 'admin · customers', description: 'User Management — Customer Accounts.' },
  {
    name: 'admin · marketplace content',
    description: 'Platform Governance — what is promoted on the website and the bot.',
  },
  { name: 'admin · pricing', description: 'Platform Governance — commission, VAT and fees.' },
  {
    name: 'admin · settings',
    description:
      'Platform Governance — operating accounts and general settings (and hiring limits).',
  },
];

const ADMIN_DESCRIPTION = `
The API behind the Eskista operations dashboard. Eskista sits between every customer and
supplier: customers pay Eskista, gear passes through Eskista's hub, and Eskista pays vendors
and talents. Everything here is Eskista doing that work.

## Signing in

1. \`POST /api/auth/sign-in/email\` with \`{ "email", "password" }\` (see **admin · auth**).
2. The response sets the \`eskista.session_token\` cookie (\`__Secure-eskista.session_token\`
   over HTTPS) **and** returns the token in the \`set-auth-token\` header.
3. Send either the cookie (\`credentials: 'include'\`) or \`Authorization: Bearer <token>\` on
   every request. Sessions last 30 days and slide daily.

There is no sign-up: a Super Admin creates admins (\`POST /api/v1/admin/team\`), and the first
one is created on the server with \`pnpm admin:create\`. To try requests here, sign in with the
**admin · auth** operation — the browser keeps the cookie — or paste the token into **Authorize**.

## Role tiers

| Tier | May |
|---|---|
| SUPER_ADMIN | Everything, including the admin team and system settings |
| ADMIN | Operations: bookings, inspections, catalogue, users, content |
| FINANCE | Payments, invoices, payouts; reads everything else |
| SUPPORT | Issues and customer support; reads everything else |

Every route says which tiers it needs in its **403** response. \`GET /api/v1/admin/me\` returns
the signed-in admin's \`permissions\`, for hiding buttons.

## Conventions

- **Money** is integer minor units (ETB cents): \`1585000\` is ETB 15,850.00. Prices are
  VAT-inclusive; the supplier is paid their own price in full and Eskista's commission sits on top.
- **Dates** are ISO 8601. Calendar days are \`YYYY-MM-DD\`; instants are UTC timestamps.
- **References** are the human ids used in URLs: bookings \`ESK-10484\` / \`ESK-TLT-9001\`,
  payments \`PAY-0042\`, settlements \`STL-0012\`, issues \`ESK-INC-00042\`, invoices
  \`ESK-INV-2026-000148\`. Everything else is a UUID.
- **Lists** take \`page\` and \`limit\` (max 100) and return \`{ data, meta }\`.
- **Actions** return the refreshed resource. A Booking Detail's \`actions\` say what can happen
  next and which are disabled and why — the dashboard never has to re-derive the rules.
- **Errors** share one envelope: \`{ statusCode, message, error, path, timestamp }\`, with extra
  context on some 4xx (\`blockers\`, \`outstandingRequirements\`, \`unitIds\`). 409 means the
  resource is not at the right stage for that step; the message says why.
- **Files** come back as URLs. Public media is on the CDN; private files (IDs, receipts,
  agreements) go through \`/api/v1/files/…\`, which needs the same session.
- **Uploads** are \`multipart/form-data\`; the field names are in each operation.
- **Exports** (\`…/export\`) return CSV with the same filters as their table.
`.trim();

/** OpenAPI paths for Better Auth's email/password endpoints, which Nest does not see. */
function authPaths(): OpenAPIObject['paths'] {
  const error = (description: string, status: number, message: string) => ({
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiErrorResponse' },
        example: { statusCode: status, message, error: description },
      },
    },
  });
  const sessionUser = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Abel Tesfaye' },
      email: { type: 'string', example: 'ops@eskista.et' },
      emailVerified: { type: 'boolean', example: true },
      image: { type: 'string', nullable: true },
      activeRole: { type: 'string', example: 'ADMIN' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  };
  return {
    '/api/auth/sign-in/email': {
      post: {
        tags: ['admin · auth'],
        summary: 'Sign in with email and password',
        description:
          'Sets the session cookie and returns the bearer token in the `set-auth-token` header. ' +
          'Rate limited to 5 attempts a minute. A suspended admin is signed in by Better Auth ' +
          'but refused (403) by every API route.',
        operationId: 'adminSignIn',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'ops@eskista.et' },
                  password: { type: 'string', example: 'eskista-admin-2026' },
                  rememberMe: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Signed in.',
            headers: {
              'set-auth-token': {
                description: 'The bearer token, for `Authorization: Bearer <token>`.',
                schema: { type: 'string' },
              },
              'set-cookie': { description: 'The session cookie.', schema: { type: 'string' } },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    redirect: { type: 'boolean', example: false },
                    token: { type: 'string', description: 'The raw session token.' },
                    user: sessionUser,
                  },
                },
              },
            },
          },
          '401': error('Unauthorized', 401, 'Invalid email or password'),
          '429': error('Too Many Requests', 429, 'Too many requests. Please try again later.'),
        },
        security: [],
      },
    },
    '/api/auth/sign-out': {
      post: {
        tags: ['admin · auth'],
        summary: 'Sign out',
        description: 'Ends this session and clears the cookie.',
        operationId: 'adminSignOut',
        responses: {
          '200': {
            description: 'Signed out.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { success: { type: 'boolean', example: true } },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/get-session': {
      get: {
        tags: ['admin · auth'],
        summary: 'The current session',
        description:
          '`null` when signed out. For the admin profile and tier, use `GET /api/v1/admin/me`.',
        operationId: 'adminGetSession',
        responses: {
          '200': {
            description: 'The session and its user, or null.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    session: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        expiresAt: { type: 'string', format: 'date-time' },
                      },
                    },
                    user: sessionUser,
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['admin · auth'],
        summary: 'Change my password',
        description: 'At least 12 characters. `revokeOtherSessions` signs out every other device.',
        operationId: 'adminChangePassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 12, example: 'a-new-long-passphrase' },
                  revokeOtherSessions: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Changed.' },
          '400': error('Bad Request', 400, 'Password too short'),
          '401': error('Unauthorized', 401, 'Invalid password'),
        },
      },
    },
  };
}

/** Every `#/components/schemas/X` reachable from a value. */
function collectRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, into);
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === '$ref' && typeof v === 'string' && v.startsWith('#/components/schemas/')) {
        into.add(v.slice('#/components/schemas/'.length));
      } else {
        collectRefs(v, into);
      }
    }
  }
}

/**
 * The admin document, cut from the full one: admin paths, the Better Auth sign-in paths,
 * the admin tags in sidebar order, and only the schemas those reach. Pure, so it is tested
 * without booting the app.
 */
export function buildAdminDocument(full: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = { ...authPaths() };
  for (const [path, item] of Object.entries(full.paths)) {
    if (path === ADMIN_PATH_PREFIX || path.startsWith(`${ADMIN_PATH_PREFIX}/`)) paths[path] = item;
  }

  // Schemas used by the paths, and the schemas those use, transitively.
  const all = full.components?.schemas ?? {};
  const needed = new Set<string>(['ApiErrorResponse']);
  collectRefs(paths, needed);
  let size = -1;
  while (size !== needed.size) {
    size = needed.size;
    for (const name of [...needed]) collectRefs(all[name], needed);
  }
  const schemas = Object.fromEntries(Object.entries(all).filter(([name]) => needed.has(name)));

  const used = new Set<string>();
  for (const item of Object.values(paths)) {
    for (const op of Object.values(item as Record<string, { tags?: string[] }>)) {
      for (const tag of op?.tags ?? []) used.add(tag);
    }
  }

  return {
    ...full,
    info: {
      title: 'Eskista Admin API',
      version: full.info.version,
      description: ADMIN_DESCRIPTION,
    },
    tags: ADMIN_TAGS.filter((t) => used.has(t.name)),
    paths,
    components: { ...full.components, schemas },
  };
}

/** Both documents, built from the app's routes without serving them. */
export function buildDocuments(
  app: INestApplication,
  version: string,
): { full: OpenAPIObject; admin: OpenAPIObject } {
  const config = new DocumentBuilder()
    .setTitle('Eskista Marketplace API')
    .setDescription(
      'Managed rental and talent marketplace — customer, vendor, talent and admin surfaces. ' +
        'Sign-in lives in Better Auth at /api/auth/*. The admin dashboard has its own, ' +
        'narrower document at /docs/admin.',
    )
    .setVersion(version)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'The `set-auth-token` from sign-in.' },
      'bearer',
    )
    .addCookieAuth('eskista.session_token', {
      type: 'apiKey',
      in: 'cookie',
      description: 'Set by sign-in (`__Secure-eskista.session_token` over HTTPS).',
    })
    .build();

  const full = SwaggerModule.createDocument(app, config);
  return { full, admin: buildAdminDocument(full) };
}

export function setupSwagger(app: INestApplication, version: string): void {
  const { full, admin } = buildDocuments(app, version);
  const uiOptions = {
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true,
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
    },
  };

  SwaggerModule.setup('docs/admin', app, admin, {
    ...uiOptions,
    customSiteTitle: 'Eskista Admin API',
    jsonDocumentUrl: 'docs/admin-json',
  });
  SwaggerModule.setup('docs', app, full, {
    ...uiOptions,
    customSiteTitle: 'Eskista API',
    jsonDocumentUrl: 'docs-json',
  });
}
