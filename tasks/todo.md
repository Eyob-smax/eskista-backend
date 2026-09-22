# Eskista customer side — task list

See `tasks/plan.md` for architecture decisions. Verification commands throughout:

```
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint "src/**/*.ts" "prisma/seed.ts"
pnpm exec jest
pnpm build
```

---

## Task 0: Secure the file endpoint ✅ DONE

**Description:** Uploads were served publicly from `/files/` with no authentication. That
directory holds Fayda IDs, payment receipts and signed agreements. Replaced static serving
with an authorised controller that streams a file only to someone entitled to it.

**Acceptance criteria:**
- [x] `/files/**` static serving removed from `main.ts`
- [x] `GET /api/v1/files/*key` streams only to an entitled caller: owner, counterparty, or admin
- [x] Unauthenticated request returns 401; unentitled returns 404, not 403
- [x] Correct `Content-Type` and `Content-Disposition: attachment`; `nosniff`; `no-store`

**Verification:**
- [x] 25 unit tests covering entitlement, traversal and deny-by-default
- [x] Live smoke test: old path 404, unauthenticated 401, owner 200, cross-tenant 404,
      traversal 404, zero server errors

**Notes — two further defects found and fixed while verifying:**
- `:key(*)` is Express 4 syntax; Express 5 / path-to-regexp v8 needs `*key`. Crashed at boot.
- Seeded storage keys used a `seed/` prefix that bypassed entitlement entirely, and the
  KYC document and receipt files did not exist on disk. All keys are now owner-scoped
  (`vendors/<id>/…`, `bookings/<ref>/…`, `listings/<id>/…`) with real files behind them,
  so the seed exercises the same access path as production. The `seed/` bypass branch was
  deleted rather than left in place.

**Dependencies:** None
**Files:** `src/modules/storage/{files.controller,file-access.service,file-access.service.spec,storage.module}.ts`, `src/main.ts`, `src/config/env.validation.ts`, `prisma/seed.ts`, `.env`, `.env.example`
**Scope:** M

---

## Task 1: Job infrastructure (BullMQ)

**Description:** Add BullMQ on the existing Redis, with a queue module, a typed job
registry, and a worker. No business jobs yet — this is the substrate Task 14 needs.

**Acceptance criteria:**
- [ ] `bullmq` installed; queue module registered with the existing Redis URL
- [ ] `JobsService.schedule(name, payload, { delayUntil })` and `cancel(jobId)`
- [ ] Worker processes jobs with retry and exponential backoff
- [ ] Health check reports queue connectivity
- [ ] Jobs survive an API restart (verified, not assumed)

**Verification:**
- [ ] Integration test: schedule a 2s job, restart nothing, assert it ran
- [ ] `GET /health` includes queue status

**Dependencies:** None
**Files:** `src/modules/jobs/*`, `src/app.module.ts`, `src/modules/health/health.controller.ts`
**Scope:** M

---

## Task 2: Customer profile and verification

**Description:** `CustomerProfile` — organisation, contact person, address, TIN, client type,
verification status — plus ID document upload and the self-service endpoints behind the
Profile tab.

**Acceptance criteria:**
- [ ] `CustomerProfile` + migration; one per user, created on demand
- [ ] `GET/PATCH /api/v1/customer/me`
- [ ] `POST /api/v1/customer/me/documents` (ID upload, 5MB, image or PDF)
- [ ] `GET /api/v1/customer/me/stats` → bookings count, rating, distinct vendors
- [ ] Verification status transitions are admin-only, not self-serve

**Verification:**
- [ ] Tests: profile creation is idempotent; upload rejects oversize and wrong MIME
- [ ] Manual: Profile tab payload matches the design's three counters

**Dependencies:** Task 0
**Files:** `prisma/schema.prisma`, `src/modules/customer/*`
**Scope:** M

---

## Task 3: Public catalogue — browse and search

**Description:** Read-only discovery for equipment: categories, featured and popular rails,
search, filters, and listing detail. Only `PUBLISHED` listings from `VERIFIED` vendors.

**Acceptance criteria:**
- [ ] `GET /api/v1/catalogue/categories`
- [ ] `GET /api/v1/catalogue/equipment` — search, category, price range, location, sort, cursor paging
- [ ] `GET /api/v1/catalogue/equipment/:id` — specs, included items, images, accessories, vendor, reviews
- [ ] `GET /api/v1/catalogue/equipment/:id/availability?from&to`
- [ ] Draft, pending, rejected and archived listings are never returned
- [ ] Endpoints are `@Public()`

**Verification:**
- [ ] Tests: an unpublished listing 404s; a suspended vendor's listings are excluded
- [ ] Manual: seeded catalogue renders Home and Explore

**Dependencies:** None
**Files:** `src/modules/catalogue/*`
**Scope:** L — split if it grows past 5 files

---

### Checkpoint A — Foundation
- [ ] Typecheck, lint, tests, build all clean
- [ ] Customer can browse the seeded catalogue unauthenticated
- [ ] A delayed job runs and survives restart
- [ ] Files are no longer publicly readable

---

## Task 4: Booking drafts and request submission

**Description:** The two-step equipment request wizard with Save Draft, priced on submission
through `computePriceBreakdown`.

**Acceptance criteria:**
- [ ] `DRAFT` added to `BookingStatus`; drafts excluded from availability and vendor views
- [ ] `POST /api/v1/customer/bookings/draft`, `PATCH .../draft/:id`
- [ ] `POST /api/v1/customer/bookings/:id/submit` → prices, assigns `ESK-#####`, writes a status event
- [ ] Rejects unavailable dates, below-minimum periods, and blocked ranges
- [ ] Pricing matches the design exactly: (subtotal + delivery) × 15% VAT, deposit separate

**Verification:**
- [ ] Test asserting `10,500 + 500 → VAT 1,575 → total 12,575`, deposit shown apart
- [ ] Test: submitting over a blocked range is rejected

**Dependencies:** Tasks 2, 3
**Files:** `prisma/schema.prisma`, `src/modules/customer-bookings/*`
**Scope:** L

---

## Task 5: Customer booking list and detail

**Description:** My Bookings (Active / Upcoming / Completed, equipment and talent together)
and the full Booking Details screen.

**Acceptance criteria:**
- [ ] `GET /api/v1/customer/bookings?tab=` — mixed types, correct per-state actions
- [ ] `GET /api/v1/customer/bookings/:reference` — equipment, payment, fulfilment, inspection, documents
- [ ] Serial numbers of assigned units are exposed
- [ ] Another customer's reference returns 404

**Verification:**
- [ ] Test: cross-customer access 404s
- [ ] Manual: response covers every field on the Booking Details screen

**Dependencies:** Task 4
**Files:** `src/modules/customer-bookings/*`
**Scope:** M

---

## Task 6: Customer-visible activity feed

**Description:** Project `BookingStatusEvent` into the customer feed with actor labels
("Eskista", "Customer", "Eskista Courier"), through an allow-list.

**Acceptance criteria:**
- [ ] `GET /api/v1/customer/bookings/:reference/activity`
- [ ] Allow-list projection; unknown or internal event types are omitted by default
- [ ] Vendor decline reasons and admin notes never appear
- [ ] Newest first, with actor label and timestamp

**Verification:**
- [ ] Test asserting an internal-only event is absent from the feed

**Dependencies:** Task 5
**Files:** `src/modules/customer-bookings/activity.service.ts` + spec
**Scope:** S

---

### Checkpoint B — Equipment booking
- [ ] A customer can browse, draft, submit, and track a booking end to end
- [ ] Vendor sees the request in their existing pending tab
- [ ] All checks clean

---

## Task 7: Eskista signature template

**Description:** Platform settings holding Eskista's signatory name, title and signature
image, snapshotted onto each agreement at issue time (AD-2).

**Acceptance criteria:**
- [ ] Settings: `agreement.eskista_signatory_name`, `_title`, `_signature_key`
- [ ] `Agreement` gains `eskistaSignatoryName`, `eskistaSignatoryTitle`, `eskistaSignatureKey`, `governedBy`
- [ ] Populated at issue time from settings — snapshot, never a live reference
- [ ] Changing the setting later does not alter existing agreements

**Verification:**
- [ ] Test: issue, change the setting, re-read → original values intact

**Dependencies:** None
**Files:** `prisma/schema.prisma`, `src/modules/settings/settings.service.ts`, `src/modules/agreements/agreements.service.ts`
**Scope:** S

---

## Task 8: In-app agreement signing

**Description:** Customer reads the frozen agreement, draws a signature, and submits it.
Signature binds to the exact content hash.

**Acceptance criteria:**
- [ ] `Agreement.reference` — own number, `ESK-AGR-#####`
- [ ] `GET /api/v1/customer/agreements/:reference` — frozen body, both signatory blocks, status
- [ ] `POST .../sign` — accepts signature PNG, signer name, checkbox confirmation
- [ ] Rejects if `contentHash` no longer matches the frozen body
- [ ] Records IP and timestamp; signing twice returns 409

**Verification:**
- [ ] Test: tampering with the stored body then signing is rejected
- [ ] Test: second signature attempt 409s

**Dependencies:** Tasks 5, 7
**Files:** `src/modules/agreements/*`, `prisma/schema.prisma`
**Scope:** M

---

## Task 9: Payment submission

**Description:** Customer submits proof of an offline Telebirr or bank transfer.

**Acceptance criteria:**
- [ ] `GET /api/v1/customer/bookings/:reference/payment-instructions` — from platform settings
- [ ] `POST .../payments` — receipt upload (10MB), transaction reference, amount paid
- [ ] Moves status to payment-submitted and writes a status event
- [ ] Rejects payment before approval, and duplicate submissions while one is pending

**Verification:**
- [ ] Test: paying an unapproved booking is rejected
- [ ] Manual: Complete Payment screen data matches

**Dependencies:** Task 5
**Files:** `src/modules/customer-bookings/payments.*`
**Scope:** M

---

## Task 10: Courier tracking and return scheduling

**Description:** Track Your Equipment (courier, vehicle, ETA, 4-step sub-tracker) and Return
Equipment (pickup vs drop-off, time slots).

**Acceptance criteria:**
- [ ] `Fulfilment` gains vehicle, plate, ETA and a delivery sub-status
- [ ] `GET /api/v1/customer/bookings/:reference/tracking`
- [ ] `GET .../return-slots` from platform settings
- [ ] `POST .../return` — method, slot, address
- [ ] Courier phone exposed; vendor contact never is

**Verification:**
- [ ] Test: response contains no vendor contact details

**Dependencies:** Task 5
**Files:** `prisma/schema.prisma`, `src/modules/customer-bookings/fulfilment.*`
**Scope:** M

---

### Checkpoint C — Full equipment lifecycle
- [ ] Browse → draft → submit → sign → pay → track → return, all working
- [ ] All checks clean; commit

---

## Task 11: Talent directory

**Description:** Talent tab — search, category filters, profile with portfolio, services,
specializations, languages, availability and reviews.

**Acceptance criteria:**
- [ ] `GET /api/v1/catalogue/talent` — search, category, price, location, experience, sort
- [ ] `GET /api/v1/catalogue/talent/:id` — full profile
- [ ] `GET /api/v1/catalogue/talent/:id/availability?from&to`
- [ ] Only `VERIFIED` and available-for-hire profiles listed
- [ ] Booking count and rating included

**Verification:**
- [ ] Test: unverified talent excluded
- [ ] Manual: seeded talent renders the profile screen

**Dependencies:** Task 3
**Files:** `src/modules/catalogue/talent.*`
**Scope:** M

---

## Task 12: Talent hire request

**Description:** Five-step wizard with drafts, reference files, and budget as a band or an
exact amount.

**Acceptance criteria:**
- [ ] `TalentBookingDetail` gains employment type, work mode, start/end time, city, access notes, budget band
- [ ] `TalentRequestFile` for reference uploads
- [ ] Draft and submit endpoints mirroring Task 4
- [ ] Reference `ESK-TLT-#####`
- [ ] Venue detail withheld from talent until confirmed

**Verification:**
- [ ] Test: venue is absent from the talent-facing projection pre-confirmation
- [ ] Test: budget accepts either a band or an amount, not neither

**Dependencies:** Tasks 4, 11
**Files:** `prisma/schema.prisma`, `src/modules/customer-bookings/talent-request.*`
**Scope:** L

---

## Task 13: Price negotiation

**Description:** `PriceProposal` rounds — proposed, accepted, declined (AD-3).

**Acceptance criteria:**
- [ ] `PriceProposal` model: amount, proposedBy, status, timestamps
- [ ] `GET /api/v1/customer/bookings/:reference/price-proposal` — latest pending
- [ ] `POST .../price-proposal/accept` and `/decline`
- [ ] Accepting sets `finalPriceMinor` and reprices the booking
- [ ] Only one pending proposal at a time

**Verification:**
- [ ] Test: accepting updates the final price and closes the round
- [ ] Test: declining leaves the booking open, not cancelled

**Dependencies:** Task 12
**Files:** `prisma/schema.prisma`, `src/modules/customer-bookings/price-proposal.*`
**Scope:** M

---

### Checkpoint D — Talent
- [ ] Hire request submitted, negotiated and paid end to end
- [ ] All checks clean; commit

---

## Task 14: Notifications with scheduled reminders

**Description:** Notification delivery plus the two time-triggered jobs the designs require.

**Acceptance criteria:**
- [ ] `NotificationsService.send(userId, type, data, channels)` writing in-app rows
- [ ] `GET /api/v1/customer/notifications`, `POST .../:id/read`, `POST .../read-all`
- [ ] Return reminder scheduled at `dueAt - 24h` on confirmation; cancelled if the booking ends early
- [ ] Feedback request scheduled after completion
- [ ] Telegram bot channel behind the same interface
- [ ] Nightly reconciliation sweep as a backstop

**Verification:**
- [ ] Test: confirming enqueues a job with the right delay; cancelling removes it
- [ ] Integration: a job due in the past is not duplicated by the sweep

**Dependencies:** Tasks 1, 5
**Files:** `src/modules/notifications/*`, `src/modules/jobs/handlers/*`
**Scope:** L

---

## Task 15: Incident reporting

**Description:** Customer-facing EF-05 — issue type, when it occurred, description, photos.

**Acceptance criteria:**
- [ ] `Incident` + `IncidentPhoto` models
- [ ] `POST /api/v1/customer/bookings/:reference/incidents` with photo upload
- [ ] `GET .../incidents` — own incidents with status
- [ ] Incident notifies Eskista admin; vendor is never contacted directly

**Verification:**
- [ ] Test: incident on someone else's booking 404s

**Dependencies:** Tasks 5, 14
**Files:** `prisma/schema.prisma`, `src/modules/incidents/*`
**Scope:** M

---

## Task 16: PDF rendering

**Description:** Render the three downloadable documents from frozen artefacts (AD-5).

**Acceptance criteria:**
- [ ] `pdfkit` installed; `DocumentRenderer` interface with a PDF implementation
- [ ] Rental agreement PDF includes both signature blocks and the content hash
- [ ] Payment evidence and settlement record PDFs
- [ ] `GET /api/v1/customer/bookings/:reference/documents/:kind` streams the PDF
- [ ] Rendered from the frozen body, never re-rendered from the template

**Verification:**
- [ ] Test: PDF bytes are produced and the hash matches the signed body
- [ ] Manual: open a generated agreement PDF

**Dependencies:** Task 8
**Files:** `src/modules/documents/*`
**Scope:** M

---

### Checkpoint E — Complete
- [ ] Every acceptance criterion met
- [ ] Typecheck, lint, tests, build clean
- [ ] Seed extended to cover talent bookings and a negotiation
- [ ] End-to-end smoke test passes against a live database
- [ ] Reviewed before moving to the admin console
