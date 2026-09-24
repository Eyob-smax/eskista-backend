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

## Task 1: Job infrastructure (BullMQ) ✅ DONE

**Description:** Add BullMQ on the existing Redis, with a queue module, a typed job
registry, and a worker. No business jobs yet — this is the substrate Task 14 needs.

**Acceptance criteria:**
- [x] `bullmq` installed; queue module registered with the existing Redis URL
- [x] `JobsService.schedule(name, payload, { delayUntil })` and `cancel(jobId)`
- [x] Worker processes jobs with retry and exponential backoff
- [x] Health check reports queue connectivity
- [x] Jobs survive an API restart (verified, not assumed)

**Verification:**
- [x] Integration test: schedule a 2s job, restart nothing, assert it ran
- [x] `GET /health` includes queue status

**Dependencies:** None
**Files:** `src/modules/jobs/*`, `src/app.module.ts`, `src/modules/health/health.controller.ts`
**Scope:** M

---

## Task 2: Customer profile and verification ✅ DONE

**Description:** `CustomerProfile` — organisation, contact person, address, TIN, client type,
verification status — plus ID document upload and the self-service endpoints behind the
Profile tab.

**Acceptance criteria:**
- [x] `CustomerProfile` + migration; one per user, created on demand
- [x] `GET/PATCH /api/v1/customer/me`
- [x] `POST /api/v1/customer/me/documents` (ID upload, 5MB, image or PDF)
- [x] `GET /api/v1/customer/me/stats` → the Profile screen's three counters exactly:
      total bookings, average rating received, distinct vendors dealt with
- [x] Profile returns the "Verified customer · Addis Ababa" subtitle parts as separate
      fields (`verificationStatus`, `city`) — never a pre-joined string
- [x] Verification status transitions are admin-only, not self-serve

**Verification:**
- [x] Tests: profile creation is idempotent; upload rejects oversize and wrong MIME
- [x] Manual: Profile tab payload matches the design's three counters

**Dependencies:** Task 0
**Files:** `prisma/schema.prisma`, `src/modules/customer/*`
**Scope:** M

---

## Task 3: Public catalogue — browse and search ✅ DONE

**Description:** Read-only discovery for equipment: categories, featured and popular rails,
search, filters, and listing detail. Only `PUBLISHED` listings from `VERIFIED` vendors.

**Acceptance criteria:**
- [x] `GET /api/v1/catalogue/categories`
- [x] `GET /api/v1/catalogue/equipment` — search, category, price range, location, sort, cursor paging
- [x] `GET /api/v1/catalogue/equipment/:id` — specs, included items, images, accessories, vendor, reviews
- [x] `GET /api/v1/catalogue/equipment/:id/availability?from&to`
- [x] `GET /api/v1/catalogue/home` — one call for the Home screen: categories,
      featured rail, popular rail, and the latest booking-update banner
- [x] Every card carries `availabilityToday: AVAILABLE | BOOKED` for the badge, derived
      from confirmed bookings covering now — not stored
- [x] Draft, pending, rejected and archived listings are never returned
- [x] Endpoints are `@Public()`

**Verification:**
- [x] Tests: an unpublished listing 404s; a suspended vendor's listings are excluded
- [x] Manual: seeded catalogue renders Home and Explore

**Dependencies:** None
**Files:** `src/modules/catalogue/*`
**Scope:** L — split if it grows past 5 files

---

### Checkpoint A — Foundation
- [x] Typecheck, lint, tests, build all clean
- [x] Customer can browse the seeded catalogue unauthenticated
- [x] A delayed job runs and survives restart
- [x] Files are no longer publicly readable

---

## Task 4: Booking drafts and request submission ✅ DONE

**Description:** The two-step equipment request wizard with Save Draft, priced on submission
through `computePriceBreakdown`.

**Acceptance criteria:**
- [x] `DRAFT` added to `BookingStatus`; drafts excluded from availability and vendor views
- [x] `POST /api/v1/customer/bookings/draft`, `PATCH .../draft/:id`
- [x] `POST /api/v1/customer/bookings/:id/submit` → prices, assigns `ESK-#####`, writes a status event
- [x] Rejects unavailable dates, below-minimum periods, and blocked ranges
- [x] Pricing matches the design exactly: (subtotal + delivery) × 15% VAT, deposit separate
- [x] Returns **both** totals (AD-9): `totalMinor` 12,575 and `amountDueMinor` 16,575
- [x] `serviceFeeRateBps` + `serviceFeeMinor` snapshotted, defaulting to 0 (AD-12)
- [x] `projectType` from the fixed chip list, plus free-text `projectDescription`

**Verification:**
- [x] Test asserting `10,500 + 500 → VAT 1,575 → total 12,575`, deposit shown apart
- [x] Test asserting `amountDueMinor` is 16,575 — total plus the 4,000 deposit
- [x] Test: a non-zero service fee rate adds a line without disturbing the VAT base
- [x] Test: submitting over a blocked range is rejected

**Dependencies:** Tasks 2, 3
**Files:** `prisma/schema.prisma`, `src/modules/customer-bookings/*`
**Scope:** L

---

## Task 5: Customer booking list and detail ✅ DONE

**Description:** My Bookings (Active / Upcoming / Completed, equipment and talent together)
and the full Booking Details screen.

**Acceptance criteria:**
- [x] `GET /api/v1/customer/bookings?tab=` — mixed types, correct per-state actions
- [x] `GET /api/v1/customer/bookings/:reference` — equipment, payment, fulfilment, inspection, documents
- [x] Serial numbers of assigned units are exposed
- [x] `timeline[]` computed server-side (AD-10) — 8 steps for equipment, 6 for talent
- [x] `actions[]` returned per booking (AD-11) so the card renders the right primary CTA
- [x] `documents[]` lists agreement, payment evidence and settlement record with
      download URLs, omitting any not yet generated rather than returning dead links
- [x] Another customer's reference returns 404

**Verification:**
- [x] Test: cross-customer access 404s
- [x] Manual: response covers every field on the Booking Details screen

**Dependencies:** Task 4
**Files:** `src/modules/customer-bookings/*`
**Scope:** M

---

## Task 6: Customer-visible activity feed ✅ DONE (folded into the booking detail)

**Description:** Project `BookingStatusEvent` into the customer feed with actor labels
("Eskista", "Customer", "Eskista Courier"), through an allow-list.

**Acceptance criteria:**
- [x] `GET /api/v1/customer/bookings/:reference/activity`
- [x] Allow-list projection; unknown or internal event types are omitted by default
- [x] Vendor decline reasons and admin notes never appear
- [x] Newest first, with actor label and timestamp

**Verification:**
- [x] Test asserting an internal-only event is absent from the feed

**Dependencies:** Task 5
**Files:** `src/modules/customer-bookings/activity.service.ts` + spec
**Scope:** S

---

### Checkpoint B — Equipment booking
- [x] A customer can browse, draft, submit, and track a booking end to end
- [x] Vendor sees the request in their existing pending tab
- [x] All checks clean

---

## Task 7: Eskista signature template ⛔ DROPPED — signing moved offline; no signature template needed

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

## Task 8: In-app agreement signing ✅ DONE — reshaped to download-PDF + upload-scan

**Description:** Customer reads the frozen agreement, draws a signature, and submits it.
Signature binds to the exact content hash.

**Acceptance criteria:**
- [x] `Agreement.reference` — own number, `ESK-AGR-#####`
- [x] `GET /api/v1/customer/agreements/:reference` — frozen body, both signatory blocks, status
- [x] `POST .../sign` — accepts signature PNG, signer name, checkbox confirmation
- [x] Rejects if `contentHash` no longer matches the frozen body
- [x] Records IP and timestamp; signing twice returns 409

**Verification:**
- [x] Test: tampering with the stored body then signing is rejected
- [x] Test: second signature attempt 409s

**Dependencies:** Tasks 5, 7
**Files:** `src/modules/agreements/*`, `prisma/schema.prisma`
**Scope:** M

---

## Task 9: Payment submission ✅ DONE

**Description:** Customer submits proof of an offline Telebirr or bank transfer.

**Acceptance criteria:**
- [x] `GET /api/v1/customer/bookings/:reference/payment-instructions` — from platform settings
- [x] `POST .../payments` — receipt upload (10MB), transaction reference, amount paid
- [x] Moves status to payment-submitted and writes a status event
- [x] Rejects payment before approval, and duplicate submissions while one is pending

**Verification:**
- [x] Test: paying an unapproved booking is rejected
- [x] Manual: Complete Payment screen data matches

**Dependencies:** Task 5
**Files:** `src/modules/customer-bookings/payments.*`
**Scope:** M

---

## Task 10: Courier tracking and return scheduling ✅ DONE

**Description:** Track Your Equipment (courier, vehicle, ETA, 4-step sub-tracker) and Return
Equipment (pickup vs drop-off, time slots).

**Acceptance criteria:**
- [x] `Fulfilment` gains vehicle, plate, ETA and a delivery sub-status
- [x] `GET /api/v1/customer/bookings/:reference/tracking`
- [x] `GET .../return-slots` from platform settings
- [x] `POST .../return` — method, slot, address
- [x] Courier phone exposed; vendor contact never is

**Verification:**
- [x] Test: response contains no vendor contact details

**Dependencies:** Task 5
**Files:** `prisma/schema.prisma`, `src/modules/customer-bookings/fulfilment.*`
**Scope:** M

---

### Checkpoint C — Full equipment lifecycle
- [x] Browse → draft → submit → sign → pay → track → return, all working
- [x] All checks clean; commit

---

## Task 11: Talent directory ✅ DONE

**Description:** Talent tab — search, category filters, profile with portfolio, services,
specializations, languages, availability and reviews.

**Acceptance criteria:**
- [x] `GET /api/v1/catalogue/talent` — search, category, price, location, experience, sort
- [x] `GET /api/v1/catalogue/talent/:id` — full profile
- [x] `GET /api/v1/catalogue/talent/:id/availability?from&to`
- [x] Only `VERIFIED` and available-for-hire profiles listed
- [x] Booking count and rating included

**Verification:**
- [x] Test: unverified talent excluded
- [x] Manual: seeded talent renders the profile screen

**Dependencies:** Task 3
**Files:** `src/modules/catalogue/talent.*`
**Scope:** M

---

## Task 12: Talent hire request 🟡 PARTIAL — wizard done; reference-file upload outstanding

**Description:** Five-step wizard with drafts, reference files, and budget as a band or an
exact amount.

**Acceptance criteria:**
- [ ] `TalentBookingDetail` gains employment type, work mode, start/end time, city, venue,
      access notes, project type and budget band — all shown on Track Request
- [ ] Five steps, matching the design's real order: Project → Schedule → Location →
      References → Budget, then Review. (The sheet labels three screens "Step 3 of 5";
      the order above is the one the content implies.)
- [ ] Talent timeline is the 6-step variant, not the equipment 8
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

## Task 13: Price negotiation ⛔ DROPPED — talent rates are fixed; no negotiation in this phase

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

## Task 14: Notifications with scheduled reminders ✅ DONE

**Description:** Notification delivery plus the two time-triggered jobs the designs require.

**Acceptance criteria:**
- [x] `NotificationsService.send(userId, type, data, channels)` writing in-app rows
- [x] `GET /api/v1/customer/notifications`, `POST .../:id/read`, `POST .../read-all`
- [x] Return reminder scheduled at `dueAt - 24h` on confirmation; cancelled if the booking ends early
- [x] Feedback request scheduled after completion
- [x] Telegram bot channel behind the same interface
- [x] Nightly reconciliation sweep as a backstop

**Verification:**
- [x] Test: confirming enqueues a job with the right delay; cancelling removes it
- [x] Integration: a job due in the past is not duplicated by the sweep

**Dependencies:** Tasks 1, 5
**Files:** `src/modules/notifications/*`, `src/modules/jobs/handlers/*`
**Scope:** L

---

## Task 15: Incident reporting ✅ DONE

**Description:** Customer-facing EF-05 — issue type, when it occurred, description, photos.

**Acceptance criteria:**
- [x] `Incident` + `IncidentPhoto` models
- [x] `POST /api/v1/customer/bookings/:reference/incidents` with photo upload
- [x] `GET .../incidents` — own incidents with status
- [x] Incident notifies Eskista admin; vendor is never contacted directly

**Verification:**
- [x] Test: incident on someone else's booking 404s

**Dependencies:** Tasks 5, 14
**Files:** `prisma/schema.prisma`, `src/modules/incidents/*`
**Scope:** M

---

## Task 16: PDF rendering ✅ DONE — agreements; payment/settlement PDFs still to come

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

---

## Remaining after the September 2026 review

**Built and verified:** the whole customer journey — browse, quote, draft, submit,
agreement download and scan upload, payment, tracking, return, incidents, reviews,
notifications with scheduled reminders, and agreement PDFs.

**Still outstanding:**

1. **Combined multi-vendor invoicing.** The one structural item from the client answers
   not yet built. Needs an `Order` grouping several bookings: each vendor keeps its own
   accept/deliver/return cycle, the customer gets one invoice and pays once.
2. **Payment evidence and settlement record PDFs.** The agreement renderer exists; these
   two reuse it once the invoice shape settles, which multi-vendor invoicing decides.
3. **Talent multi-request flow.** Client requests several talents, interested ones accept,
   client picks and hires. What happens to the unpicked acceptors is an open question.
4. **The talent's own side.** Their profile management, request inbox and accept/decline —
   explicitly a separate phase.
5. **Admin console.** Everything that moves a booking forward: approving requests,
   verifying payments, approving agreement scans, dispatching couriers, recording
   inspections. The customer side models all of it; nothing drives it yet.
