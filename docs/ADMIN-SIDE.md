# Admin side — design record

The Eskista operations dashboard, from the seven sheets in `design/admin/` (44 frames, read
one by one). Eskista sits in the middle of every transaction: customers pay Eskista, Eskista
holds and inspects equipment at its hub, confirms bookings, and pays vendors and talents.
This dashboard is where all of that happens.

Admins work in a web dashboard and sign in with **email and password** (Better Auth,
sign-up disabled — admins are created by a Super Admin). Mini App users never see any of it.

---

## 1. Frames → screens

### Navigation (every frame)

Overview · **Equipment OPS** (Rental Operations: Booking Requests / Active Rentals /
Deliveries & Pickups · Catalog & Gear: Equipment Inventory / Equipment Categories ·
Inspections & QA) · **Talent Marketplace** (Hiring & Inquiries: Hiring Requests / Issues &
Disputes · Talent Roster: Roster & Profiles / Categories & Skills) · **Finance & Settlements**
(Payment Verification / Vendor Settlements) · **User Management** (Vendor Accounts / Customer
Accounts) · **Platform Governance** (Marketplace Content / Admin Team / Settings).
Header: notification bell, admin name and **role tier** ("Super Admin"). Sidebar badges show
counts (Booking Requests 12, Active Rentals 8, Deliveries & Pickups 3).

### booking.png — Rental operations

| Frame | Screen |
|---|---|
| 0 | **Overview**: "Good Morning, Abel"; Review New Requests / Verify Payments; tiles Pending Booking Requests (+trend, "4 new in last 2 hours"), Awaiting Payment Confirmation ("quotations sent"), Payments to Verify ("slips uploaded"), Active Rentals ("gear out on field"); **Attention Required** cards (Payment Verification → Verify Payment; Booking Awaiting Approval → Review Request); Recent Bookings |
| 1 | **Booking Requests**: search, filter by status, sort by date; booking, customer/org, equipment, vendor, dates, status, amount, payment state (Receipt Uploaded / Payment Pending / Payment Confirmed / Pending Confirmation) |
| 2 | **Active Rentals**: equipment & kit, client & contact, delivery address & schedule, method (Courier Dispatch / Studio Pickup), ETA, fulfilment status (Scheduled / Returned to Hub), dispatch action (**Start Packing Gear → … → Handover Complete**) |
| 3 | **Booking detail**: 13-step lifecycle (Request Submitted · Payment · Booking Confirmed · Equipment Preparation · **Outgoing Inspection** · Handover · Rental Active · Return Scheduled · **Incoming Inspection** · Completed · Settlement · Closed); tabs Overview (summary, customer with contact, **physical unit** with serial and last inspection, project & delivery, vendor with earnings and payout status) and Delivery & Inspection (outgoing and return records) |
| 4 | Modals: **Update Manual Outgoing Inspection** (condition Pristine / Excellent / Good / Fair / Needs Attention / Damaged, note, inspector) · **Post-Shoot Return Inspection** (outgoing baseline, condition, note, inspector, **Report an Issue**, **damage/replacement deduction**) · **Payment Verification** (expected vs received, method, transaction ID, evidence, View Full Receipt, **Request New Slip / Reject Slip (reason) / Confirm Payment**) |
| 5 | Settlement tab: rental, delivery, VAT, deposit held, total charged, commission, vendor net; payment evidence |
| 6 | Documents tab: payment receipt, signed rental agreement, **outgoing inspection sheet**, each with who uploaded it and when |

### equipment category.png — Catalog & gear

| Frame | Screen |
|---|---|
| 0 | **Equipment Management**: tiles (total units, available, on rental, needs attention/QA); filter by status and category; equipment, vendor, category, status (Available / Rented / Returned), current booking; **Categories**, **Add Equipment** |
| 1–6 | **Unit detail** ("Unit #FX3-002", status): Overview & Specs (serial, daily rate, **current custody**, last inspected, description, specs, included items, media, **Feature on marketplace**) · Manual Inspection (latest record, or record one) · Rental Bookings (active booking, or "Unit is currently in the Hub Vault", availability calendar) · **Condition History** (staff inspection, outgoing check-out, routine service) |
| 7 | **Category management**: ordered list (up/down), subcategory and unit counts; detail with "Publicly Visible", counts (available / on rental / in QA), **Cross-Marketplace Associations** (Camera → Lenses, Lighting, Audio) |
| 8–9 | Create / Edit category: name, associations (equipment and talent categories), thumbnail |

### hiring & inquiry.png — Talent operations

| Frame | Screen |
|---|---|
| 0 | **Hiring Requests**: request & date, customer & phone, requested talent & category, project & venue, **contract** (Signed / Pending), amount, payment, workflow status (In Progress / Scheduled / Completed); filters |
| 1 | Talent booking detail: 6-step lifecycle (Pending Review · Approved · Talent Assigned · **Contract Active** · In Progress · Completed); customer (company, rep, phone, email, base location, **ID document on file**), requested talent (role, phone, earnings, date, time, location), project |
| 2 | Settlement tab: quoted price, platform fee, payable to talent; payment evidence |
| 3 | Payment Verification modal (as above) |
| 4 | **Issues & Grievance Desk**: "client ↔ talent" disputes (late arrival, overtime), logged/resolved, View Details, **Resolve Issue** |

### talent marketplace.png — Roster & categories

| Frame | Screen |
|---|---|
| 0 | **Talent Marketplace Management**: tiles (total / active, pending verification, active requests, open talent issues); **Create Hiring Request**, **Register New Talent**; roster (photo, name, category, day rate, availability Available/Booked, verification) |
| 1–2 | **Profile**: engagement type, base rate ("15% VAT inclusive"), **direct payout channel** + pending payout, about, payout method/account, languages, specializations, CV PDF, services, portfolio, reviews; **Suspend Profile**; for a pending one **Reject Request / Verify and Activate Profile** |
| 3 | Portfolio project modal |
| 4–5 | **Talent categories**: thumbnail, internal description, **specializations & skills**, talent count, active; Add / Edit |

### finance and settlements.png

| Frame | Screen |
|---|---|
| 0 | **Payments Verification**: payment ID (**PAY-842**), booking, customer, amount, method, submitted, status (**Confirmed / Pending / Requested Receipt**), view, download receipt; **Export Summary** |
| 1 | **Payment Metadata**: expected, received (per slip), method, **payer account / name**, evidence |
| 2 | **Vendor Payouts & Settlements**: "Rental Revenue − Commission ± Adjustments = Vendor Settlement"; **STL-842**, vendor, booking, gross, Eskista's share, net payable, status (Paid / Pending / **Overdue**); export |
| 3 | **Settlement Breakdown**: issued / due dates, PDF, breakdown, **destination bank / wallet, holder, account** |

### user management.png

| Frame | Screen |
|---|---|
| 0 | **Vendor Accounts**: vendor + joined date, location, contact rep & phone, inventory units, active rentals, status (Verified / Pending / Rejected / **Suspended**); export |
| 1 | Vendor detail: rating, **lifetime earnings**, **pending escrow settlement**, representative, **payout method + account, and an alternative**, documents (license, partnership agreement) |
| 2 | **Customer Accounts**: name, location, phone, email, bookings; filters incl. verification |
| 3 | Customer detail: representative, active bookings (Open Booking File), **Suspend User** |

### platform governance.png

| Frame | Screen |
|---|---|
| 0 | **Marketplace Content**: featured equipment and talent "promoted on the website hero grid and Telegram booking bot"; tiers **Featured / Highlighted / Spotlight / Standard**; Add / Remove / Pin |
| 1–4 | **Admin Users & Access Control**: staff, **role tier** (Super Admin / Admin / e.g. Support Admin), phone & email, **last active session**; Create Admin (name, email, phone, password, role), Reset Password, Admin Detail (edit, **Suspend Admin**) |
| 5–6 | **System Settings**: standard commission %, **Eskista operating accounts** (Telebirr merchant ID, CBE, Awash, **Add Account**: bank/wallet, number, holder) |

---

## 2. Decisions

| Topic | Decision |
|---|---|
| Money model | The mocks show commission **deducted** from the vendor ("rental − 15% = vendor net"). The client's confirmed model is **markup**: the supplier is paid their price in full, commission and VAT are added on top. The admin screens get the same rows — gross, Eskista's share, net payable — with markup figures. |
| Equipment custody | Gear flows **vendor → Eskista hub → client → hub → vendor**. Each unit records its custody (`VENDOR` / `HUB` / `CLIENT`), updated by the operational steps. |
| Inspections | Two per booking — **outgoing** (at the hub, before dispatch) and **return** — plus **routine** records on a unit outside any booking. One `Inspection` model covers all three, with the design's six-grade scale. The return inspection carries the damage deduction and "Report an Issue". |
| Lifecycle | The admin's 13 steps are derived from the booking status plus the vendor's handover record and the inspections, like the customer's 8 and the vendor's 10. Only admins move a booking between statuses. |
| Talent lifecycle | Invitations still go out at submission (the approved multi-invite flow). "Pending Review" is the request awaiting a hire; "Approved/Talent Assigned" is a hire; "Contract Active" is both agreements signed and payment confirmed; then In Progress and Completed. Admins can also invite and hire on a customer's behalf. |
| Payments | Each payment gets a human reference (**PAY-…**). Confirming records the received amount and the payer's account name; the booking is confirmed once its invoice is fully paid. "Request New Slip" is a status of its own so the customer is prompted to upload again. |
| Settlements | Each gets a reference (**STL-…**), a destination snapshot (the payee's payout account at the time), and a signed adjustment. **Overdue** is derived: not paid and past its expected date. Vendor settlements are created when a rental is settled; talent ones on Complete Service (already built). |
| Payout accounts | Vendors and talents get **payout accounts** (primary + alternatives: Telebirr, CBE, other banks), managed in their own apps and read by admins. |
| Operating accounts | Eskista's collection accounts become a **list** (Telebirr, CBE, Awash, …) edited in Settings; the customer payment screens show all of them. |
| Categories | Gain a description, a thumbnail, a skills list (talent), manual ordering, visibility, and **associations** to other categories (equipment ↔ equipment, equipment ↔ talent). |
| Featured content | Listings and talent get a **feature tier** (Featured / Highlighted / Spotlight). Promo codes are named in a subtitle but have no screen — not built. |
| Admin roles | Tiers **SUPER_ADMIN / ADMIN / FINANCE / SUPPORT**. Super Admin manages the team and settings; Finance verifies payments and pays out; Support handles incidents and reads everything; Admin runs operations. Each admin endpoint declares the tiers it allows. |
| Last active | From the admin's most recent session activity. |
| Notifications | Admins get notifications too (new request, payment slip uploaded, incident reported, agreement uploaded) on `/admin/notifications`. |
| Exports | "Export Summary" returns CSV for vendors, payments and settlements. |
| Issues | Talents can report incidents on their engagements as well as customers; new types for late arrival, overtime and conduct. |

---

## 3. How it is built

Everything admin lives in `src/modules/admin/`. Every route is behind `@AdminAccess(...)`
(`admin/core/admin-access.ts`): the ADMIN role, then the tier. A Super Admin passes every
tier check; an admin with no profile yet counts as ADMIN, never Super Admin.

### Signing in

`POST /api/auth/sign-in/email { email, password }` (Better Auth, sign-up disabled). It sets
the `eskista.session_token` cookie and returns the token in the `set-auth-token` response
header (Better Auth's bearer plugin, signed tokens only). The dashboard sends either the
cookie (`credentials: 'include'`) or `Authorization: Bearer <token>`; CORS exposes
`set-auth-token` so a dashboard on another origin can read it.

The first Super Admin on a fresh database: `ADMIN_PASSWORD=… pnpm admin:create --email … --name "…"`.
Seeded: `ops@eskista.et` (Super Admin), `finance@eskista.et`, `support@eskista.et`, password
`eskista-admin-2026` (or `SEED_ADMIN_PASSWORD`).

### API documentation

Outside production, Swagger serves two documents:

- **`/docs/admin`** — the admin API alone: every admin route, the Better Auth sign-in /
  sign-out / session / change-password operations, tags in sidebar order, typed responses
  with examples, the error envelope and each route's 401 / 403 (with the tiers it needs) /
  400 / 404 / 409. JSON at `/docs/admin-json` for client generation.
- **`/docs`** — every endpoint. JSON at `/docs-json`.

To try requests, run the **admin · auth → Sign in** operation (the browser keeps the cookie),
or paste the `set-auth-token` value into **Authorize → bearer**. The document is cut from the
full one by `src/config/swagger.ts` (`buildAdminDocument`).

### Endpoints, by screen

| Screen | Endpoints (`/api/v1/…`) |
|---|---|
| Header, Overview | `GET admin/me` · `GET admin/overview` (tiles, Attention Required, Recent Bookings, every sidebar badge) |
| Admin team | `GET/POST admin/team` · `GET/PATCH admin/team/:id` · `POST …/reset-password` · `POST …/suspend` · `POST …/reactivate` |
| Booking Requests / Active Rentals / Deliveries | `GET admin/bookings?view=requests\|active\|deliveries\|completed` · `GET admin/bookings/counts` |
| Booking Detail (all tabs) | `GET admin/bookings/:ref` — `timeline` (13 or 6 steps), `actions`, `overview`, `delivery`, `settlement`, `documents`, `agreements`, `incidents`, `activity` |
| Booking operations | `POST …/approve` · `…/reject` · `…/cancel` · `PUT …/units` (+ `GET …/units`) · `POST …/receive-at-hub` · `…/inspections/outgoing` · `…/delivery` · `…/return` · `…/inspections/return` · `…/deposit-refund` · `…/settle` · `…/return-to-vendor` · `…/close` · talent: `…/start` · `…/complete` |
| Agreement scans | `GET admin/agreements` · `GET …/:id` · `GET …/:id/pdf` · `POST …/:id/approve` · `…/reject` |
| Payments Verification | `GET admin/payments` · `…/summary` · `…/export` · `GET …/:PAY-ref` · `POST …/confirm` · `…/request-new-slip` · `…/reject` · `POST admin/bookings/:ref/payments` (cash / direct) |
| Vendor Payouts & Settlements | `GET admin/settlements` · `…/summary` · `…/export` · `GET …/:STL-ref` · `…/pdf` · `POST …/pay` · `POST/DELETE …/adjustments` · `POST …/hold` |
| Hiring Requests | `GET/POST admin/hiring` · `POST …/:ref/invitations` · `POST …/:ref/hire` (detail is `admin/bookings/:ref`) |
| Talent Roster | `GET/POST admin/talent` · `…/kpis` · `GET …/:id` · `…/cv.pdf` · `POST …/verify` · `…/reject` · `…/suspend` · `…/reactivate` · `…/claim-code` |
| Equipment Management | `GET admin/equipment/kpis` · `…/units` · `GET/PATCH …/units/:id` · `…/listings` (CRUD, images, submit, units, suspend) |
| Inspections & QA | `GET admin/inspections` · `GET …/:id` · `…/:id/sheet.pdf` · `GET/POST admin/units/:id/inspections` (condition history, routine check) |
| Categories (equipment and talent) | `GET/POST admin/categories?kind=` · `GET/PATCH/DELETE …/:id` · `PUT …/order/:kind` · `POST …/:id/move` · `POST …/:id/thumbnail` |
| Vendor / Customer Accounts | `GET admin/vendors` · `…/export` · `GET …/:id` · `POST …/verify\|reject\|suspend\|reactivate`; `GET admin/customers` · `…/export` · `GET …/:id` · `POST …/verify\|reject-verification\|suspend\|reactivate` |
| Marketplace Content | `GET admin/content/featured?kind=` · `…/candidates` · `PUT/DELETE …/featured/listings/:id` · `…/featured/talent/:id` · `PUT …/featured/order` |
| System Settings | `admin/pricing` (commission, VAT, fees — already existed) · `GET/POST/PATCH/DELETE admin/settings/operating-accounts` · `PUT …/order` · `GET/PATCH admin/settings/general` |
| Issues & Grievance Desk | `GET admin/incidents?bookingType=` · `…/summary` · `GET …/:ref` · `POST …/review` · `…/resolve` (optional payout adjustment) · `…/dismiss` |
| Invoices (existing) | `admin/invoices` — now tier-guarded (Finance) |
| Listing / talent review (existing) | `admin/review` — now tier-guarded; listing decisions now notify the vendor |

### An equipment rental, end to end

1. Customer submits → the bell rings. Vendor accepts → `ESKISTA_REVIEW`, the bell rings.
2. **Approve** → `AWAITING_PAYMENT`: price frozen, return deadline 5 PM on the last day,
   free units held (or pick with Assign Unit), the customer's agreement and invoice issued.
3. Customer uploads the signed scan and pays. **Approve the scan** and **Confirm Payment**,
   in either order: whichever comes last moves the booking to `BOOKING_CONFIRMED`.
4. Vendor prepares and confirms handover. **Receive at Hub** (confirms the vendor's handover
   if they forgot), custody → HUB.
5. **Outgoing inspection** (a Damaged grade blocks dispatch). **Start Packing Gear** →
   `DELIVERY_PICKUP`; move the courier; **Handover Complete** → `IN_PROGRESS`, custody →
   CLIENT, the return reminder is scheduled.
6. Customer arranges the return (or Eskista does); **Received by Eskista** → `RETURN_RECEIVED`,
   custody → HUB.
7. **Return inspection** → `INSPECTION`; the deduction is withheld from the deposit and
   passed to the vendor as a settlement adjustment. **Report an Issue** opens an incident.
8. **Record Deposit Refund**, **Move to Settlement** (creates STL-…), **Pay Vendor** (copies
   their payout account), optionally **Return Gear to Vendor**, then the vendor confirms and
   completes — or **Close Booking**.

A talent engagement: invite / hire (customer or admin) → the customer's scan approved and paid
→ `BOOKING_CONFIRMED` → **Start Engagement** once the talent's agreement is approved too →
Complete Service (customer) or **Mark Completed** → **Move to Settlement** → **Pay Talent** →
the talent confirms and completes.

### What changed on the other sides

- **Everyone** — admin actions raise the notifications the apps were written for (Booking
  Approved, Agreement Ready, Out for Delivery, Delivered, Payment Verified / Needs Attention
  / New Slip, Inspection Complete, Deposit Refunded, Booking Completed, Payout Sent…).
- **Customer** — payment screens list every operating account (`accounts`), and a payment may
  name the account paid into (`collectionAccountId`). The inspection block shows the deposit
  refund. Categories carry `related` (associations) and `skills`; the Featured rail follows
  Marketplace Content order and end dates.
- **Vendor** — payout accounts: `GET/POST/PATCH/DELETE /vendor/payout-accounts`. Issues:
  `POST/GET /vendor/bookings/:ref/incidents`. The payout block shows `paidTo` and the note
  names the payout channel, not the customer's payment method.
- **Talent** — payout accounts at `/talent/payout-accounts`; issues at
  `/talent/bookings/:ref/incidents` (late arrival, overtime…); `payout.paidTo`;
  `POST /talent/claim { code }` takes over a profile Eskista registered.
- **Bell** — new bookings, vendor answers, hires, uploaded scans, payment slips, handovers,
  returns, completed services, issues, payout and return disputes, new registrations and
  listing submissions notify the admins whose tier handles them (`/notifications`).

### Review fixes (cross-side consistency)

- **One cancel routine** (`BookingWrapUpService`): a customer's cancel and an admin's cancel or
  reject both void agreements, reject slips still awaiting review, void unpaid invoices (a
  combined one whole), return hub gear to the vendor, cancel jobs, close a talent request and
  tell the supplier. A customer's cancel also rings the admin bell with the refund due.
  The status write is guarded, so it cannot undo a step Eskista just took.
- **Confirm Payment** refuses a slip on a booking that is no longer awaiting payment.
- **Assign Talent** is recorded as the admin, and the customer is told to sign and pay.
- **Mark as Paid** can be repeated for a payout the payee reported missing (clearing the
  dispute); an undisputed one still cannot be paid twice, and two admins cannot both pay.
- A vendor confirms the **return** before the payout only when the gear was sent back to them.
- **Move to Settlement** starts the 24-hour auto-close if the payee had already confirmed.
- Vendors are told of **new requests**; the **return reminder** only fires while the customer
  holds the gear; Start Packing is disabled after a Damaged outgoing check; the talent
  timeline stays on Contract Active until Start Engagement; payment columns use the invoice
  (VAT-exempt aware). `POST /talent/claim` is limited to 5 tries a minute.

Known and left as is: auto-hire on first accept with a headcount above one hires only the
first talent; talents get "the client cancelled" wording when Eskista rejects a request.

### Schema

Migration `20260928150000_admin_side`: `AdminProfile` (tier), `PayoutAccount`,
`CollectionAccount` (backfilled from `payment.accounts`), `CategoryAssociation`,
`SettlementAdjustment`; inspections gain `kind` / `grade` / `unitId` (one per booking and
kind); units gain `custody` / `lastGrade` / `lastInspectedAt`; payments gain `reference`
(PAY-…, backfilled), the received amount, payer and `RESUBMISSION_REQUESTED`; settlements gain
`reference` (STL-…, backfilled), `adjustmentMinor` and the destination snapshot; feature tiers
on listings and talent; suspension and deposit-refund fields; new incident types and phases.

### Not built

Promo codes (named in a subtitle, no screen); SMS / Telegram delivery of notifications
(in-app only, as before); payout batches from the dashboard (the model exists).

---

## 4. Build order (as planned)

1. **Schema** — admin tiers, payout accounts, inspections (kinds, grades, units), unit custody,
   payment and settlement references, categories, feature tiers, incident types.
2. **Admin access** — tier guard, admin team (create, edit, reset password, suspend, last active),
   admin notifications.
3. **Payments** — list, detail, confirm / reject / request new slip, export.
4. **Equipment bookings** — requests (approve / reject), unit assignment, agreement review,
   hub receipt, outgoing inspection, dispatch and delivery stages, return, return inspection,
   settlement, close; the 13-step detail; active rentals; deliveries & pickups; overview dashboard.
5. **Settlements** — list, breakdown, mark paid, adjust, PDF, export; payout accounts in the
   vendor and talent apps.
6. **Talent operations** — hiring requests and detail, admin hire on behalf, start / complete;
   roster, profile, verify / reject / suspend, register talent; talent categories.
7. **Catalog** — inventory, unit detail and condition history, routine inspections, categories
   with associations, admin-created equipment.
8. **Users** — vendor and customer accounts, detail, verify / suspend, export.
9. **Governance** — featured content, operating accounts.
10. **Issues** — incident desk for equipment and talent, resolve; talent reporting.
