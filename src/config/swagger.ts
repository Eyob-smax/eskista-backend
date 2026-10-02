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

export const VENDOR_PATH_PREFIX = '/api/v1/vendor';
export const TALENT_PATH_PREFIX = '/api/v1/talent';
export const CUSTOMER_PATH_PREFIX = '/api/v1/customer';
export const CATALOGUE_PATH_PREFIX = '/api/v1/catalogue';

export const VENDOR_TAGS: { name: string; description: string }[] = [
  {
    name: 'vendor · profile',
    description:
      'Account onboarding, business profile, verification documents (ID, business license), and the Eskista vendor agreement.',
  },
  {
    name: 'vendor · equipment',
    description:
      'Inventory catalog management, technical specifications, included accessories, photos, and calendar availability.',
  },
  {
    name: 'vendor · bookings',
    description:
      'Rental requests and operations: accept/decline, 7-point preparation checklist, handover method, tracking, return, QA inspection, and completion.',
  },
  {
    name: 'vendor · earnings',
    description:
      'Earnings overview, monthly KPI totals, and payout settlement lines.',
  },
  {
    name: 'vendor · payout accounts',
    description:
      'Receiving accounts: Telebirr and Ethiopian commercial banks (maximum 5, one primary).',
  },
  {
    name: 'vendor · issues',
    description:
      'Filing grievances, damaged equipment reports, or rental disputes directly to Eskista mediation.',
  },
];

const VENDOR_DESCRIPTION = `
The API for equipment owners and rental businesses on Eskista.

## Overview

Eskista connects equipment suppliers with production houses, filmmakers, and creators:
- Customers rent through Eskista, payments are held in escrow, gear passes through Eskista's hub or verified courier network, and suppliers are paid out upon successful return.
- **Pricing & Earnings**: The price you set on an equipment listing is your net earnings. Eskista calculates platform commission and VAT on top for the customer.
- **Money Minor Units**: All monetary amounts are integer minor units (ETB cents): \`150000\` = ETB 1,500.00.

## Rental Lifecycle (10 Stages)

1. **Request Submitted**: Customer initiates a rental booking.
2. **Booking Confirmation**: Vendor accepts or declines (\`POST /api/v1/vendor/bookings/:reference/accept\`).
3. **Payment**: Customer pays Eskista (rental fee + deposit held in escrow).
4. **Equipment Preparation**: Vendor completes the 7-item preparation checklist and condition grading, then marks ready (\`POST .../ready\`).
5. **Handover**: Vendor selects collection method (Delivery or Eskista Pickup), then confirms handover (\`POST .../handover/confirm\`).
6. **Rental Active**: Equipment is with the client or courier. Real-time courier leg tracking via \`GET .../tracking\`.
7. **Return Scheduled & Received**: Equipment is returned to Eskista's hub.
8. **Inspection**: Hub technicians perform physical and functional QA. Vendor views inspection results at \`GET .../inspection\`.
9. **Settlement**: Vendor confirms physical receipt (\`POST .../return/confirm\`) and payout receipt (\`POST .../payout/confirm\`).
10. **Rental Closed**: Booking closes, and the customer is prompted for review.

## Authentication & Authorization

Protected endpoints require:
- The session cookie (\`credentials: 'include'\`), or
- A Bearer token: \`Authorization: Bearer <token>\`.
`.trim();

/**
 * The vendor document, cut from the full one: vendor paths, vendor tags,
 * and only the schemas those reach.
 */
export function buildVendorDocument(full: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};
  for (const [path, item] of Object.entries(full.paths)) {
    if (path === VENDOR_PATH_PREFIX || path.startsWith(`${VENDOR_PATH_PREFIX}/`)) paths[path] = item;
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
      title: 'Eskista Vendor API',
      version: full.info.version,
      description: VENDOR_DESCRIPTION,
    },
    tags: VENDOR_TAGS.filter((t) => used.has(t.name)),
    paths,
    components: { ...full.components, schemas },
  };
}

export const TALENT_TAGS: { name: string; description: string }[] = [
  {
    name: 'talent · profile',
    description:
      'Profile setup, creative disciplines, portfolio projects, verification documents (ID / Passport), and availability calendar.',
  },
  {
    name: 'talent · work',
    description:
      'Engagements, client hire invitations, contracts & agreements, and payout receipt confirmations.',
  },
  {
    name: 'talent · payout accounts',
    description:
      'Receiving accounts: Telebirr and Ethiopian commercial banks (maximum 5, one primary).',
  },
  {
    name: 'talent · issues',
    description:
      'Filing grievances, disputes, overtime, or conduct issues directly to Eskista mediation.',
  },
  {
    name: 'talent · claim',
    description:
      'Claiming a talent profile pre-registered by Eskista operators.',
  },
];

const TALENT_DESCRIPTION = `
The API for creative professionals (cinematographers, editors, sound engineers, etc.) on Eskista.

## Overview

Eskista connects creative talents with clients and production houses:
- **Direct Marketplace**: Talents register profiles, showcase portfolios, set their day rates, and receive invitations.
- **Escrow & Secure Payments**: Clients pay Eskista before the shoot. Once the engagement concludes, Eskista disburses the talent's rate in full.
- **Day Rates & Pricing**: All rates are configured in integer minor units (ETB cents): \`300000\` = ETB 3,000.00. Platform commission is calculated on top.

## Engagement Lifecycle (6 Stages)

1. **Invitation Received**: Client invites talent for an engagement (\`GET /api/v1/talent/requests\`).
2. **Talent Response**: Talent accepts or declines the invitation (\`POST .../accept\` or \`POST .../decline\`).
3. **Client Confirmation & Payment**: Client selects the talent and pays Eskista escrow. Access instructions and location notes unlock for the talent.
4. **Contract Execution**: Eskista issues the talent agreement. Talent downloads PDF, signs, and uploads scan (\`POST .../agreement/signed-copy\`).
5. **Project Execution**: Talent completes the shoot/project. Grievances or overtime can be reported to mediation (\`POST /api/v1/talent/bookings/:ref/incidents\`).
6. **Settlement & Payout**: Hub initiates payout. Talent confirms receipt (\`POST .../payout/confirm\`) and engagement closes.

## Authentication & Authorization

All talent endpoints require:
- The session cookie (\`credentials: 'include'\`), or
- A Bearer token: \`Authorization: Bearer <token>\`.
`.trim();

/**
 * The talent document, cut from the full one: talent paths, talent tags,
 * and only the schemas those reach.
 */
export function buildTalentDocument(full: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};
  for (const [path, item] of Object.entries(full.paths)) {
    if (path === TALENT_PATH_PREFIX || path.startsWith(`${TALENT_PATH_PREFIX}/`)) paths[path] = item;
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
      title: 'Eskista Talent API',
      version: full.info.version,
      description: TALENT_DESCRIPTION,
    },
    tags: TALENT_TAGS.filter((t) => used.has(t.name)),
    paths,
    components: { ...full.components, schemas },
  };
}

export const CUSTOMER_TAGS: { name: string; description: string }[] = [
  {
    name: 'catalogue · equipment',
    description:
      'Explore cinema gear, categories, verified vendor equipment details, pricing quotes, and real-time availability.',
  },
  {
    name: 'catalogue · talent',
    description:
      'Search verified creative professionals (cinematographers, editors, sound engineers), view portfolios, rates, and check calendar availability.',
  },
  {
    name: 'customer · profile',
    description:
      'Account management, personal and company profile details, identity verification documents, and rental statistics.',
  },
  {
    name: 'customer · bookings',
    description:
      'Booking drafts (equipment and creative talent), submission, hiring invitations, and cancellation.',
  },
  {
    name: 'customer · booking lifecycle',
    description:
      'End-to-end booking execution: contract signing, payment verification, delivery tracking, check-in handover PINs, condition inspections, incident reporting, and reviews.',
  },
  {
    name: 'customer · invoices',
    description:
      'Billing & Escrow Payments: viewing invoices, payment instructions (Telebirr & Ethiopian commercial banks), payment slip uploads, combined invoices, and official receipt downloads.',
  },
];

const CUSTOMER_DESCRIPTION = `
The API behind the Eskista Customer Mini App and Web Marketplace.

## Overview

Eskista connects filmmakers, agencies, production houses, and event creators with verified cinema equipment suppliers and creative talent across Ethiopia:
- **Equipment Catalogue & Instant Quotes**: Browse gear, inspect specifications and condition grades, check calendar availability, and get instant quotes including Ethiopian VAT (15%), platform commission, and refundable security deposits.
- **Creative Talent Directory**: Hire verified cinematographers, directors, gaffers, and sound recordists with fixed transparent day rates and verified portfolios.
- **Managed Escrow**: Eskista acts as the trusted escrow intermediary. Customers transfer funds to Eskista via Telebirr or Ethiopian commercial bank transfer. Funds are held in escrow until rentals and projects are completed satisfactorily.

## Booking & Rental Lifecycle (7 Stages)

1. **Cart & Drafting**: Customer adds equipment or configures talent project requirements into a draft (\`POST /api/v1/customer/bookings/drafts/*\`).
2. **Submission & Matching**: Customer submits the draft (\`POST .../drafts/:id/submit\`). For talent requests, customer reviews bids/invitations and hires the selected professional (\`POST .../bookings/:ref/hire\`).
3. **Invoicing & Escrow Payment**: Eskista issues an invoice. Customer accesses bank payment instructions (\`GET /api/v1/customer/invoices/:number/instructions\`), transfers funds, and uploads the bank deposit slip (\`POST .../invoices/:number/pay\`).
4. **Agreements & KYC**: Customer downloads the digital rental agreement, signs, and uploads the signed scan (\`POST .../bookings/:ref/agreement/signed-copy\`).
5. **Dispatch & Check-In Handover**: Gear passes through the Eskista Hub for inspection, then is dispatched for delivery or hub pickup. Customer confirms custody with the handover PIN (\`POST .../bookings/:ref/check-in/confirm\`).
6. **Return & Incident Mediation**: Customer returns gear. Post-rental check-out inspection determines if the deposit is refunded in full or applied to damage/incidents (\`POST .../bookings/:ref/incidents\`).
7. **Wrap-up & Reviews**: Customer rates and reviews equipment and talent (\`POST .../bookings/:ref/reviews\`).

## Monetary Values

All monetary amounts (\`totalMinor\`, \`subtotalMinor\`, \`vatMinor\`, \`securityDepositMinor\`, \`dayRateMinor\`) are represented as integer minor units (ETB cents):
- \`10000\` = ETB 100.00
- \`450000\` = ETB 4,500.00
All catalogue prices and quote summaries include Ethiopian VAT (15%).
`.trim();

/**
 * The customer document, cut from the full one: customer and catalogue paths,
 * customer tags, and only the schemas those reach.
 */
export function buildCustomerDocument(full: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};
  for (const [path, item] of Object.entries(full.paths)) {
    if (
      path === CUSTOMER_PATH_PREFIX ||
      path.startsWith(`${CUSTOMER_PATH_PREFIX}/`) ||
      path === CATALOGUE_PATH_PREFIX ||
      path.startsWith(`${CATALOGUE_PATH_PREFIX}/`)
    ) {
      paths[path] = item;
    }
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
      title: 'Eskista Customer API',
      version: full.info.version,
      description: CUSTOMER_DESCRIPTION,
    },
    tags: CUSTOMER_TAGS.filter((t) => used.has(t.name)),
    paths,
    components: { ...full.components, schemas },
  };
}

/** Documents built from the app's routes without serving them. */
export function buildDocuments(
  app: INestApplication,
  version: string,
): {
  full: OpenAPIObject;
  admin: OpenAPIObject;
  vendor: OpenAPIObject;
  talent: OpenAPIObject;
  customer: OpenAPIObject;
} {
  const config = new DocumentBuilder()
    .setTitle('Eskista Marketplace API')
    .setDescription(
      'Managed rental and talent marketplace — customer, vendor, talent and admin surfaces. ' +
        'Sign-in lives in Better Auth at /api/auth/*. Role-specific portals: ' +
        '/docs/admin (operations dashboard), /docs/vendor (equipment suppliers), /docs/talent (creative professionals), and /docs/customer (clients and productions).',
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
  return {
    full,
    admin: buildAdminDocument(full),
    vendor: buildVendorDocument(full),
    talent: buildTalentDocument(full),
    customer: buildCustomerDocument(full),
  };
}

export function setupSwagger(app: INestApplication, version: string): void {
  const { full, admin, vendor, talent, customer } = buildDocuments(app, version);
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
  SwaggerModule.setup('docs/vendor', app, vendor, {
    ...uiOptions,
    customSiteTitle: 'Eskista Vendor API',
    jsonDocumentUrl: 'docs/vendor-json',
  });
  SwaggerModule.setup('docs/talent', app, talent, {
    ...uiOptions,
    customSiteTitle: 'Eskista Talent API',
    jsonDocumentUrl: 'docs/talent-json',
  });
  SwaggerModule.setup('docs/customer', app, customer, {
    ...uiOptions,
    customSiteTitle: 'Eskista Customer API',
    jsonDocumentUrl: 'docs/customer-json',
  });
  SwaggerModule.setup('docs', app, full, {
    ...uiOptions,
    customSiteTitle: 'Eskista API',
    jsonDocumentUrl: 'docs-json',
  });
}
