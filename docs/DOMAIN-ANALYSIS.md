# Eskista — Domain Analysis

**Coverage: 41 of 41 screens reviewed** (18 customer, 23 vendor). Admin screens not yet
supplied — the admin surface in §10 is *inferred* from the customer/vendor screens and is
the part most likely to change when the real designs arrive.

Sources, in order of authority:

1. **Figma designs** (`design/customer-designs.png`, `design/vendor desings.png`) — authoritative.
2. `Eskista_Marketplace_Phase_1_MVP_with_Telegram (1).docx` — business context.

Delivery target: **Telegram Mini App** + admin dashboard.

---

## 1. Roles & identity

| Fact | Evidence |
| --- | --- |
| One account, two experiences | *"Choose your experience. You can switch anytime from your profile."* |
| Vendors are **businesses** | "Afro Studio", "Ethiopian Visuals", "Addis Lens Co.", "Lalibela Grip" |
| Vendor registration is **prefilled** | Full name and Phone marked *"(Check if this is accurate)"* — supplied by Telegram, user confirms |
| Customers can also be businesses | Vendor sees customers as "Habesha Films", "Skyline Events", "Kenyan Landscapes" |

So: `User` (Telegram identity) → `RoleMembership` → optional `VendorProfile`. Not a `role`
column. Two auth paths: Mini App users via Telegram `initData` HMAC; admin staff via
email + password on a separate guard.

**Vendor type** is a required enum: `INDIVIDUAL | PRODUCTION_COMPANY | RENTAL_COMPANY | CREATIVE_STUDIO`.

## 2. Navigation → API surface

- **Customer tabs:** Home · Explore · Bookings · Profile
- **Vendor tabs:** Home · Inventory · Bookings · Profile

## 3. The booking state machine — authoritative

The vendor booking screen shows **all ten steps**; the customer screen shows six. Same
machine, different projection.

| # | Internal status | Customer sees | Advanced by |
| --- | --- | --- | --- |
| 1 | `REQUEST_SUBMITTED` | Request Submitted | Customer |
| 2 | `ESKISTA_REVIEW` | Eskista Review | Admin + **vendor accept/decline** |
| 3 | `AWAITING_PAYMENT` | Payment | Customer uploads proof |
| 4 | `BOOKING_CONFIRMED` | Booking Confirmed | Admin verifies payment |
| 5 | `DELIVERY_PICKUP` | Delivery / Pickup | Admin |
| 6 | `RENTAL_COMPLETED` | Return | Admin / time |
| 7 | `RETURN_PICKUP_SCHEDULED` | Return | Customer schedules |
| 8 | `INSPECTION` | — | Admin |
| 9 | `SETTLEMENT` | — | Admin |
| 10 | `RENTAL_CLOSED` | — | Admin |

Terminal/branch states seen as status chips: `REJECTED` (red), `CANCELLED`
("Cancel Request" + "Are you sure to cancel?"), plus `IN_PROGRESS` and `COMPLETE`.

**Vendor acceptance is a real step, not admin-only.** Vendor dashboard: *"2 Rental Requests
— Confirm equipment availability"*; chip *"Pending Confirmation"*; buttons **Accept Booking** /
**Decline Request**; modal: *"By accepting, you confirm that this equipment will be available
for the requested rental period."* So step 2 holds two independent gates — vendor confirmation
and Eskista approval — and the model needs both, not one status.

Consequences:

- A `BookingStatusEvent` append-only log (from, to, actor, actor_role, reason, timestamp) is
  mandatory — it is the audit trail and the operational data Phase 1 exists to collect.
- Transitions belong in a guarded transition table keyed by `(from, to, allowed_actor_role)`.
- Reference format is customer-visible: **`ESK-10482`**, `ESK-20234`, `ESK-56789`. Needs a
  collision-safe generator; do not expose raw ids.

### Return sub-flow

A second tracker exists: `Rental Completed → Pickup Scheduled → Equipment Received →
Inspection → Rental Closed`, with chip **Return Scheduled**.

Return options: **Schedule Pickup** ("We collect from you") vs **Drop Off** ("Return at
vendor"), a selectable **time slot** (`Aug 21 · 10:00 AM`), and an address. Note the due
date carries a **time**: *"return by Wednesday, October 16th, no later than 5:00 PM"* — so
`due_at` is a timestamp, not a date.

## 4. Listing (equipment) state machine

Separate from bookings: `Equipment Added → Eskista Review → Published → Available for
Booking`, chip **Pending Approval**. Admin approves listings — matching "create verify the
product".

`DRAFT → PENDING_REVIEW → PUBLISHED → (SUSPENDED | REJECTED)`.

**Verification ≠ availability.** The green ✓ badge is admin approval (persisted); the
`Available`/`Booked` chip is derived from bookings. Two orthogonal concepts — conflating
them is a modeling bug.

## 5. Availability — four date states

The vendor "Set Availability" calendar has an explicit legend:

| State | Origin |
| --- | --- |
| **Available** | default |
| **Blocked** | vendor-authored — *"Blocked dates prevent Eskista from accepting rental requests"* |
| **Reserved** | derived — approved/upcoming booking |
| **Rented** | derived — booking currently in use |

*"Tap a date to cycle its status."* So store only vendor **blocked** dates
(`EquipmentBlockedDate`, or a date range table); compute Reserved/Rented from bookings.
Never persist an `is_available` boolean.

## 6. Money model

Two different breakdowns appear, and both matter:

**Customer-facing** (listing detail):
```
3 days × ETB 900     ETB 2,700
Delivery             ETB   500
─────────────────────────────
Total                ETB 3,200
```

**Vendor-facing** (booking request):
```
Gross rental              ETB 10,500
Rented Item Quantity         2 Items
Eskista commission        -ETB  1,500
─────────────────────────────────────
Your estimated earnings   ETB  9,000
```

- Currency **ETB** throughout; store integer minor units + currency code.
- Pricing is a **day rate**; `days × rate` plus a **delivery fee** line item.
- **`Rented Item Quantity: 2 Items`** — a booking carries a **quantity** of a listing.
- Commission is deducted from gross to give vendor earnings. Needs a commission rate
  (global default, likely overridable per vendor or category).
- Totals are labelled **"Estimated total"** while pending — the figure is provisional until
  admin confirms, so persist a priced snapshot on approval rather than recomputing.
- *"Payment is managed by Eskista."* Eskista collects, then settles vendors.

## 7. Payment — offline, admin-verified

Methods: **Telebirr** (to `0911 23 45 67`, "Eskista Equipment Rentals") and **Bank
Transfer** (CBE, "Eskista Marketplace PLC", acct `1000 2345 6789 01`). Both are *Eskista's*
accounts, not the vendor's.

Submission form captures:

| Field | Notes |
| --- | --- |
| Receipt file | *"PNG, JPG or PDF up to 10MB"* |
| **Transaction reference** (required) | e.g. `TBR8842190XZ` |
| **Amount paid** (required) | e.g. `ETB 9,600` |

Then: *"Eskista is verifying your payment. Your booking will be confirmed once payment is
approved."* → `Payment { method, reference, amount, receipt_file, status: SUBMITTED |
VERIFIED | REJECTED, verified_by_admin_id, verified_at }`.

Payment is gated on approval: *"Payment is not required until approval."*

## 8. Vendor settlement

Earnings screen: Total Revenue, Today's Earning, Upcoming. Per-booking rows with
`ESK-#####`, a date (or "Expected Aug 24"), the vendor's earnings, and a chip **Paid** /
**Pending**.

→ `Settlement { booking_id, vendor_id, gross, commission, net, status: PENDING | PAID,
expected_at, paid_at, admin_id }`.

## 9. Other entities evidenced

**Equipment/Listing** — from the 3-step Add wizard and detail screens:
name, category (FK), brand, model, description, location, **images (multiple, one starred
primary)**, spec tags (`Weather sealed`, `24-70mm`, `f/2.8`, `E / EF-mount`), **included
items with quantities** (`2x NP-FZ100 Batteries`), condition, **replacement value**
(ETB 240,000), **min rental period** (1 day), rental requirements (free text),
day rate, `featured` flag, rating aggregate + review count (`4.4 (61 Reviews)`),
**related accessories** (self-referencing listing↔listing relation).

**Categories** — Cameras, Lenses, Lighting, Audio, plus "Camera Set"; doc adds Grip &
Support, Drones, Bundles. First-class entity with images (used as Browse Categories tiles).

**Reviews** — booking-scoped, star rating + free text, submitted after `RENTAL_CLOSED`
("Rate Your Experience" → "How was your experience?").

**Notifications** — bell with badge on every screen; vendor "Needs Your Attention" feed
(rental requests, equipment returns, listings missing availability). Persisted rows + a
Telegram bot channel.

**Vendor KYC** — profile picture, **ID documents (multiple, PDF)**, **Business License
(PDF)**, each independently marked verified. Uploads capped at **5MB** here vs **10MB** for
payment receipts, so limits are per-purpose.

**No vendor↔customer messaging.** *"Eskista manages all communication with the customer. For
questions or changes, contact Eskista Support."* Do not build chat; build support contact.

## 10. Inferred admin surface (unverified — designs pending)

Everything below follows from the screens above; treat as a proposal.

1. **Vendor approval queue** — review KYC docs, approve/reject per document and per vendor.
2. **Listing approval queue** — `PENDING_REVIEW → PUBLISHED | REJECTED` with reason.
3. **Booking pipeline board** — one column per status; each transition an explicit action
   with actor and reason recorded.
4. **Payment verification** — view receipt, compare stated reference/amount against expected
   total, then verify or reject.
5. **Delivery / pickup coordination** — assign and track; doc adds courier partners.
6. **Return & inspection** — record condition on receipt, damage notes, and any fee.
7. **Settlement** — mark vendor payouts Paid, with commission applied.
8. **Reference data** — categories, commission rates, delivery fees, featured listings.
9. **Reporting** — the KPIs in the doc.

## 11. Decisions taken

| Question | Decision | Consequence in the schema |
| --- | --- | --- |
| Quantity vs units | **Individually tracked units** | `EquipmentUnit` holds each physical copy with its own serial, condition and status; `BookingUnit` records which units admin assigned. Damage becomes attributable to a unit. |
| Date locking | **Lock only on approval** | Overlapping requests coexist freely; no reservation rows. Admin resolves the conflict by approving one and rejecting the other. No expiry job needed. |
| Bookable scope | **Equipment only** | No polymorphic bookable resource. Talent and studios would require reshaping `Booking`. |

### Still open

1. **Concurrency guard on approval.** With overlap allowed until approval, two admins
   approving simultaneously could double-book a unit. Options: a Postgres `EXCLUDE USING
   gist` constraint (needs `btree_gist` plus `startDate`/`endDate` denormalised onto
   `BookingUnit`, since an exclusion constraint can only reference its own table), or a
   trigger, or `SELECT … FOR UPDATE` inside the approval transaction. **Not yet
   implemented** — application-level checking alone is not safe under concurrency.
2. **Vendor decline vs admin reject** — distinct statuses, or one `REJECTED` plus a reason?
   Currently modelled as `Booking.vendorResponse = DECLINED` (with reason) *separate* from
   `status = REJECTED`, so both are recoverable.
3. **Deposits.** "Refundable deposit" appears only inside *rental requirements* free text,
   and `replacementValueMinor` exists, but no deposit line appears in any total. In scope?
4. **Delivery fee** — flat, per-zone, or admin-set per booking? Currently a per-booking
   `deliveryFeeMinor` with the default expected to come from `PlatformSetting`.
5. **Bundles** (doc category) — composite listings? Availability would need every member free.
6. **Condition scale** — stored as `conditionScore` 1–10 per the Add wizard; the detail
   view's word ("Excellent") is treated as a derived label. Confirm the buckets.

## 12. Design inconsistencies to confirm

These look like mock-data noise, but each hides a real decision:

| Observation | Question |
| --- | --- |
| Condition is a **10-star scale** in Add Equipment but **"Status: Excellent"** in the detail view | Numeric score or enum? |
| Phone number field displays `Aug 18, 2026` (vendor registration and profile) | Copy/paste slip in the mock |
| Earnings tabs are `Overview \| Settlements` on one frame, `Overview \| Upcoming \| Completed` on others | Which tab set is real? |
| Customer form says *"Anything the vendor should know…"*; vendor list shows **Purpose**; vendor detail shows **Project description** | One field or two? |
| `3 days × ETB 900 + 500 = 3,200` vs `Estimated total 9,600` vs `Gross rental 10,500` across screens | Mock noise — but confirms structure, not amounts |
| Vendor tracker uses "Delivery / Pickup" (step 5) **and** "Pickup Scheduled" (step 7, the return) | Rename to avoid collision |
| Explore grid repeats "Canon EOS R5 Body / Addis Lens Co." for nearly every tile | Placeholder, or genuinely multiple units? (see Q1) |
