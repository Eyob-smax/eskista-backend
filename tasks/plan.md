# Implementation Plan — Eskista customer side

## Overview

Build the customer half of the Eskista platform: discovery, booking, talent hire,
in-app agreement signing, tracking, and the scheduled notifications the designs require.
Derived from 56 screens across four September 2026 design sheets
(`docs/CUSTOMER-FLOW.md`, `docs/TALENT-FLOW.md`) and the FY2026/27 operating documents
(`docs/OPERATIONS-MODEL.md`).

The vendor supply side already exists and is verified. The admin console is deliberately
out of scope here and comes next.

---

## Architecture decisions

### AD-1 — Background jobs: BullMQ on the existing Redis

The designs require **time-triggered** notifications, not just event-triggered ones:
a *Return Reminder* the day before the due date, and a *Feedback Requested* after
completion.

`@nestjs/schedule` (cron in-process) is rejected: it fires on **every** instance, so two API
replicas send two reminders, and anything queued is lost on restart. BullMQ keeps jobs in
Redis — which is already running — giving one delivery across replicas, retries with
backoff, and survival across restarts. A reminder that silently stops firing is worse than
one that never existed.

Jobs are **scheduled per booking, not swept by a cron**: when a booking is confirmed, a
delayed job is enqueued for `dueAt - 24h`. Cancelling the booking removes the job. A nightly
reconciliation sweep is a safety net, not the mechanism.

### AD-2 — Eskista's signature is a stored template, applied automatically

Per the product owner: the customer signs in-app with a drawn signature, and **Eskista's
side is a stored template reused on every agreement** rather than a person signing each one.

So `Agreement` carries two signature slots. The customer's is a captured PNG
(`signatureImageKey`); Eskista's is resolved at issue time from platform settings — signatory
name, title, and a stored signature image. This resolves the contradiction between the app
(one signature) and the Word templates (two signature blocks): both are present, but only one
is drawn by a human.

The counter-signature is **snapshotted onto the agreement**, not referenced. If the signatory
changes next year, agreements already signed must still show who actually signed them.

### AD-3 — Price negotiation is an append-only record, not two columns

`TalentBookingDetail.budgetMinor` and `finalPriceMinor` capture the endpoints but lose the
middle. A `PriceProposal` row per round — who proposed, how much, accepted or declined, when
— keeps the negotiation auditable, exactly as `BookingStatusEvent` does for statuses.

### AD-4 — Customer-visible activity feed is a projection, never the raw log

`BookingStatusEvent` already records every transition with actor and reason. The customer
feed renders from it through an allow-list projection. Internal content — vendor decline
reasons, admin notes — must never leak. Default is to hide; events opt in to visibility.

### AD-5 — PDFs render from the frozen agreement body

`AgreementsService` already freezes the rendered body and hashes it. The PDF renderer
consumes that frozen artefact rather than re-rendering from the template, so the PDF matches
the hash that was signed. `pdfkit` (pure JS, no headless browser) is enough for these
documents.

### AD-6 — Draft bookings are the same row, not a separate table

"Save Draft" appears on both the equipment and talent request wizards. A `DRAFT` status on
`Booking` before `REQUEST_SUBMITTED` keeps one identity through the whole lifecycle, so a
draft that becomes a booking keeps its reference and history. Drafts are excluded from every
availability and listing calculation.

### AD-7 — Customer profile is separate from User

`User` is Better Auth's, and shared across roles. `CustomerProfile` holds the commercial
identity the forms need — organisation, contact person, address, TIN, client type
(local/international), verification status, ID document. A vendor who also rents gets both,
independently.

### AD-8 — Scope guard: single-item, single-vendor only

Every screen in this set shows one item from one vendor. The multi-item, multi-vendor
quotation belongs to the managed path and is **still blocked** on the open question. Nothing
in this plan assumes either shape, so neither answer invalidates it.

### AD-9 — The booking exposes two totals, because the design shows two

The Finalize screen totals **ETB 12,575** with the deposit in a separate box; the Payment
screen totals **ETB 16,575**, the same figure plus the ETB 4,000 deposit. Both are correct:
one is the value of the goods and services, the other is what the customer must transfer.

Collapsing them into one field guarantees the frontend picks the wrong one somewhere. The
API returns both, named for what they mean:

- `totalMinor` — rental + delivery − discount + VAT. The invoice and VAT base. Excludes the deposit.
- `amountDueMinor` — `totalMinor` + refundable deposit. What the customer actually pays.

`securityDepositMinor` stays separate and is never taxed.

### AD-10 — The status timeline is computed by the backend, not hardcoded by the client

Three different timelines appear in this design set: equipment has **8** steps, talent has
**6** (Request Submitted → Talent Confirmation → Payment → Booking Confirmed → Project/Hire →
Completed), delivery tracking has **4**, and return has **5**.

Hardcoding three step lists in the client guarantees they drift from `BookingStatus` the
first time a status is added. The API returns the timeline as data:

```jsonc
"timeline": [
  { "key": "REQUEST_SUBMITTED", "label": "Request Submitted", "state": "DONE",        "occurredAt": "…" },
  { "key": "ESKISTA_REVIEW",    "label": "Under Review",      "state": "IN_PROGRESS", "occurredAt": null },
  { "key": "AWAITING_PAYMENT",  "label": "Payment",           "state": "PENDING",     "occurredAt": null }
]
```

The client renders whatever it receives. Adding a status never requires a frontend release.

### AD-11 — Available actions are returned with the booking

Every booking card and detail screen shows a different primary action: *Complete Payment*,
*Track Booking*, *Arrange Return*, *Complete Service*, *Book Again*, *Cancel Request*. Which
one is legal depends on status, payment state, supplier response and agreement state — rules
that live in the service layer and are already enforced there.

Re-deriving them in the client means the same rules written twice, in two languages, drifting
apart. Each booking therefore carries:

```jsonc
"actions": [
  { "key": "COMPLETE_PAYMENT", "label": "Complete Payment", "primary": true,  "enabled": true },
  { "key": "CANCEL_REQUEST",   "label": "Cancel Request",   "primary": false, "enabled": true }
]
```

The endpoints still enforce every rule independently — this list is for rendering, never for
authorisation.

### AD-12 — The service fee is a configured rate, snapshotted, defaulting to zero

The Booking Details screen shows a **Service fee** line (ETB 300) that no other screen
mentions and no document defines. Rather than block on it, it is modelled the way commission
and VAT already are: a platform setting in basis points, applied to the rental subtotal,
snapshotted onto the booking as `serviceFeeRateBps` + `serviceFeeMinor`.

It defaults to **0**, so the line is absent until Eskista configures it, and no existing
arithmetic changes. When the answer arrives it is a settings change, not a migration.

### AD-13 — The talent price is proposed by the talent, and the customer accepts it

The *Price Modification* dialog reads "The Service Provider requested specific payment amount
of ETB 14,500", with Decline and Accept. That settles open question 2: the customer states a
**budget** (a band or an exact figure), the talent counter-proposes a **specific amount**, and
the customer accepts or declines.

`PriceProposal` (AD-3) therefore records `proposedByRole`, and a customer-side accept is what
sets `finalPriceMinor` and reprices the booking. A booking is never priced from the budget.

---

## Dependency graph

```
CustomerProfile ──┬── Booking request (drafts)
                  │        │
Public catalogue ─┘        ├── Agreement signing ── PDF rendering
   (browse/search)         │
                           ├── Payment submission
                           ├── Activity feed projection
                           ├── Courier tracking
                           └── Incident reporting
Talent directory ── Hire wizard ── Price negotiation
Job scheduler ───────────────────── Scheduled notifications
```

---

## Task list

Tasks live in `tasks/todo.md`.

**Phase 1 — Foundation:** customer profiles, public catalogue, job infrastructure
**Phase 2 — Equipment booking:** drafts, submission, agreement signing, payment, tracking
**Phase 3 — Talent:** directory, hire wizard, negotiation
**Phase 4 — Supporting:** incidents, PDFs, notifications, activity feed

---

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Multi-vendor answer arrives mid-build and reshapes `Booking` | High | AD-8: nothing here assumes single or multi. Line items would be additive. |
| Uploaded files are still served with no access control | High | Task 0 — fix before any customer uploads ID documents. |
| Two admins approving at once could double-book a unit | Medium | Deferred: the constraint depends on whether periods sit on the booking or the item. |
| Redis becomes a durability dependency for reminders | Medium | BullMQ persists to Redis, which has AOF enabled in compose. Nightly reconciliation sweep as backstop. |
| Drawn signature images could be replayed | Medium | Bind signature to `contentHash` + capture IP and timestamp; reject if the frozen body changed. |
| Scope creep from admin features | Medium | Admin is explicitly out of scope; customer endpoints never mutate vendor state. |

---

## Open questions

Carried from `docs/TALENT-FLOW.md` §5 and `docs/OPERATIONS-MODEL.md` §7, revised after the
September 2026 design set. **Answered by the designs** are recorded as decisions and are not
blocking; the rest are assumptions I have made explicit so they are cheap to correct.

### Answered by the designs

1. **Does Eskista counter-sign each agreement?** No — a stored template, applied at issue
   time and snapshotted (AD-2). Confirmed by the product owner.
2. **Who proposes the final talent price?** The talent. The *Price Modification* dialog says
   "The Service Provider requested specific payment amount of…", and the customer accepts or
   declines (AD-13).
5. **What are the valid employment types, and is on-site/remote separate?** Both exist and are
   separate dimensions — the request detail shows "Booking type: **Full Time · On-site**".
   Employment type and work mode are modelled as two enums.

### Decided by me, flagged for correction

6. **Service fee — flat, percentage, or per booking?** Modelled as a configurable rate in
   basis points, defaulting to 0 so the line stays hidden until Eskista sets it (AD-12). If
   it is meant to be a flat ETB amount, that is a settings change, not a migration.
3. **What does "Verified customer" require?** Assumed: an admin has approved the uploaded ID
   document. `CustomerProfile.verificationStatus` is admin-only; the customer can upload but
   never self-verify. The Profile screen's "Verified customer" label reads from it.
4. **Who rates customers, and where?** `ReviewKind` already has no CUSTOMER variant. The
   Profile screen shows a 4.9 rating for the customer, so one is needed. Assumed: the vendor
   rates the customer after inspection closes, via a `CUSTOMER` review kind. Not built in this
   phase — the customer side only needs to *read* the aggregate.

### Still genuinely open — none blocking

7. **Are couriers Eskista staff, a Logistics vendor, or their own entity?** The tracking
   screen shows a named courier with a vehicle and plate, labelled "Eskista Courier".
   Modelled as fields on `Fulfilment` rather than a `Courier` entity, which is the cheapest
   shape to promote later if couriers need their own logins.
8. **Can one customer order span multiple vendors?** Every screen in this set still shows one
   item from one vendor. AD-8 holds: nothing here assumes either shape.
9. **What closes a talent booking?** The equipment path ends in return → inspection →
   settlement. Talent has no equipment to return, and the card CTA is *Complete Service*.
   Assumed: the customer confirms completion, which opens the review and the settlement.

---

## Pricing model — final (September 24, 2026)

Supersedes every earlier VAT note in this plan and in the commit history.

**Markup, not extraction.** The supplier sets the price they want to *earn*. Eskista adds its
commission on top, VAT is added on top of that, and the customer sees the all-in figure —
which is what "all prices are VAT-inclusive" means. The supplier is always paid exactly what
they listed; commission never comes out of it.

    talent asks 3,000/day × 3 days      9,000.00   paid to the talent in full
    + commission 15%                    1,350.00   Eskista
    + VAT 15% of 10,350                 1,552.50   tax authority
    = customer pays                    11,902.50   (3 × 3,967.50)

**Commission is editable**, most specific level wins: listing → vendor or talent → platform
default (15%). An admin sets these at approval through `/admin/pricing`. Every change is
audited, moves the catalogue immediately, and never reprices a booking already made — each
booking snapshots the rate it was priced at.

**Assumptions to confirm:** equipment follows the same model as talent; Eskista's own fees
(delivery, service fee) are entered before VAT, and VAT is added to them too.

**Counting days:** a rental is charged by the night (Aug 18 → 21 is 3); a talent by each date
worked (Nov 23 → 24 is 2).
