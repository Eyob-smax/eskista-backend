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

Carried from `docs/TALENT-FLOW.md` §5 and `docs/OPERATIONS-MODEL.md` §7. None block Phase 1.

1. Does Eskista counter-sign per agreement, or is the stored template sufficient? **Assumed
   resolved** — stored template (AD-2).
2. Who proposes the final talent price — the talent, or Eskista on their behalf?
3. What does "Verified customer" require beyond the ID upload in the booking flow?
4. Who rates customers, and where is that captured?
5. What are the valid employment types, and is on-site/remote a separate dimension?
6. Service fee — flat, percentage, or per booking?
7. Are couriers Eskista staff, a Logistics vendor, or their own entity?
8. **Can one customer order span multiple vendors?** Still the biggest open item, but no
   longer blocking, per AD-8.
