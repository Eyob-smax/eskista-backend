# Vendor side — design record

The equipment-owner half of Eskista, from the September 25, 2026 sheets, read frame by frame
and mapped to the API.

| Sheet | Covers |
|---|---|
| `vendor flow.png` | Role chooser → Create Your Vendor Account → Home → My Equipment → Add Equipment (3 steps) → Equipment Submitted → Equipment Detail → Booking Requests → Profile → Earnings → Business profile view / edit |
| `booking complete flow.png` | **Byte-identical to `vendor flow.png`** (same SHA-256). |
| `contract layout vendor.png` | Despite the name, the whole vendor **booking** lifecycle: request → accept → prepare → handover → track → return → inspection → payout → completed |

Where the designs are silent or contradict themselves, the design wins over older notes and
the decision is recorded below.

---

## 1. Frames → endpoints

### Onboarding and profile

| Frame | Endpoint | Notes |
|---|---|---|
| How will you use Eskista? / What will you offer? | `PATCH /me/active-role`, then onboarding | |
| Create Your Vendor Account | `POST /vendor/onboarding` | Full name (`contactName`), Business name*, phone, Email*, Location*, Vendor type*, `acceptTerms: true`. Individual vs company is **derived from the vendor type** — the form never asks |
| Upload profile picture | `POST /vendor/me/logo` | |
| Upload Your ID* (front + back) | `POST /vendor/me/documents` `type=FAYDA_ID\|PASSPORT` | Up to **two** files; a third is 409 until one is removed |
| Business License* | `POST /vendor/me/documents` `type=BUSINESS_LICENSE` | Required for companies. `BUSINESS_REGISTRATION` also accepted |
| Profile tab | `GET /vendor/me` | `joinedLabel` "Joined Since July 23, 2026", `stats` Rentals · Equipment · Rating |
| Business Information (view / edit) | `GET·PATCH /vendor/me`, `DELETE /vendor/me/documents/:id` | `verification.id` / `verification.businessLicense` with the green tick |
| Verification | `POST /vendor/me/submit`, `GET /vendor/me/agreement` | |
| Notifications | `/vendor/notifications` | The same inbox as the other apps |
| Help & Support | `supportPhone` on every booking detail | |

### Home

`GET /vendor/me/dashboard`: greeting (Addis time), business name with the verified tick,
the four tiles, **Needs Your Attention** (rental requests, bookings to prepare, returns,
incomplete listings) and **Upcoming Rentals**, which show the client's organisation
("Habesha Films") and a status chip.

### Inventory

| Frame | Endpoint |
|---|---|
| My Equipment (search, Booked / Available, Price/Day, due date) | `GET /vendor/equipment?q=` |
| Add Equipment 1/3: name, category, brand, model, description*, photos* (star = main), location | `POST /vendor/equipment`, `POST …/:id/images`, `PATCH …/images/:imageId` |
| 2/3: included accessories, **Condition*** (10 stars), replacement value, min rental period, rental requirements | `PATCH /vendor/equipment/:id` with `conditionRating` 1–10; `PUT …/included-items` |
| Set Availability ("Tap a date to cycle its status") | `GET …/availability`, `POST …/availability/:date/toggle` |
| 3/3 Equipment Submitted: Added → Eskista Review → Published → Available for Booking | `POST …/:id/submit`; `reviewSteps` on the detail |
| Equipment Detail | `GET /vendor/equipment/:id` |

### Bookings

| Frame | Endpoint |
|---|---|
| Booking Requests (Pending · Upcoming · Active · Completed) | `GET /vendor/bookings?tab=` |
| Booking Request #ESK-… (summary, money, info note) | `GET /vendor/bookings/:ref` |
| Accept This Booking? / Decline Request | `POST …/accept`, `POST …/decline` |
| Rental Accepted ("Your next step: Prepare the equipment before Aug 28") | the accept response — `nextStep` |
| Prepare Equipment: checklist 2/7, condition photos, condition, Mark as Ready | `GET·PUT …/preparation`, `POST·DELETE …/preparation/photos`, `POST …/preparation/ready` |
| Choose Handover Options → Select Collection Method (Delivery + address / Pickup + phone) | `PUT …/handover-method` |
| Confirm Handover → Equipment Handed Over | `POST …/handover/confirm` |
| Track Your Equipment ("Only the admin will be updating this status") | `GET …/tracking` |
| Confirm Delivery / Confirm Return (Confirm · Not-Confirmed) | `POST …/return/confirm` |
| Inspection Results | `GET …/inspection` |
| Confirm Payment → Payment Received! (auto-close in 24 h) | `POST …/payout/confirm` |
| Complete the booking | `POST …/complete` |
| Completed booking: accordions, Documents & Records | `GET …/:ref`, `GET …/settlement-record.pdf` |

### Earnings

`GET /vendor/earnings?tab=overview|upcoming|completed`: Total Revenue, Today's Earning,
Upcoming, and one row per booking ("ESK-10482 · Aug 24, 2026", Paid / Pending).
`GET /vendor/earnings/settlements` backs the Settlements tab.

---

## 2. The vendor's steps inside Eskista's stages

The booking status is Eskista's: only Eskista moves a rental from stage to stage. The
vendor's own actions are recorded beside it in `VendorHandover` — prepared, handover method,
handed over, return confirmed, payout confirmed — so a vendor tapping a button can never skip
a stage Eskista has not reached.

| Tracker step | Booking status | Vendor action | Allowed when |
|---|---|---|---|
| Request Submitted | REQUEST_SUBMITTED | — | |
| Booking Confirmation | ESKISTA_REVIEW | Accept / Decline | vendor has not answered |
| Payment | AWAITING_PAYMENT | (may start preparing) | accepted |
| Equipment Preparation | BOOKING_CONFIRMED | Prepare → Mark as Ready | every item ticked, condition chosen |
| Handover | BOOKING_CONFIRMED / DELIVERY_PICKUP | Choose option → Confirm Handover | **client has paid** (BOOKING_CONFIRMED or later) |
| Rental Active | IN_PROGRESS / RENTAL_COMPLETED | Track | |
| Return Scheduled | RETURN_SCHEDULED | Track | |
| Equipment Returned | RETURN_RECEIVED / INSPECTION | View Inspection Results | once inspected |
| Settlement | SETTLEMENT | Confirm Return → Confirm Payment → Complete | payout only once return confirmed and Eskista has paid |
| Rental Closed | CLOSED | — | vendor completes, or 24 h after payout confirmation |

"Not-Confirmed" on either confirmation records a dispute with the vendor's note for Eskista
to follow up, and moves nothing.

---

## 3. Decisions made without a design

| Need | Decision |
|---|---|
| Money on the request | **Gross rental = earnings + commission** (net of VAT). The mock's 10,500 − 1,500 = 9,000 with an "estimated total" of 9,600 does not reconcile; the API's figures always do. Estimated total = what the client pays, VAT included |
| Checklist items | The listing name, each included item, then Original accessories · Equipment tested · Equipment cleaned |
| Condition photos | Optional (no asterisk), up to six, stored under the booking so Eskista can compare with the return |
| Handover "Delivery" address | Pre-filled from the booking's delivery address |
| Units | The wizard has no units screen: a first unit is created on submission |
| Main specification | Not on the wizard, so no longer required to submit |
| 10-star condition | `conditionRating` 1–10 → advertised grade: 10 New · 9 Like new · 7–8 Excellent · 5–6 Good · 1–4 Fair |
| Calendar legend | Available / Blocked are the vendor's; Rented / Reserved come from bookings and cannot be tapped |
| Documents & Records | Rental Agreement = the vendor's own Eskista agreement (vendors are never party to the client's). Payment Evidence = the payout record, not the client's receipt, which carries the client's bank details |
| Client identity | Organisation name only ("Habesha Films"). No personal name, phone or email anywhere on the vendor side |
