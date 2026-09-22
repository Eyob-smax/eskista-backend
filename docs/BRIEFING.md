# Eskista platform — briefing

Written to be read start to finish in about fifteen minutes. It covers what the platform
is, how it is built, what exists today, what is left, and the decisions worth being able to
defend in a conversation.

---

## 1. The short version

Eskista rents professional film and photography equipment in Addis Ababa. It is moving from
renting only its own gear to running a **managed marketplace**: other owners list their
equipment, customers rent it, and Eskista sits in the middle of every transaction — approving
the vendor, approving the listing, reviewing the booking, collecting the money, arranging
delivery, inspecting the gear on return, and paying the vendor.

"Managed" is the important word. This is not a listings site where two strangers transact.
Eskista is a party to everything, which is why the system is built around **an operations team
making decisions**, not around automation.

We are building the **backend** — the data, the rules, and the API. Someone else builds the
screens.

---

## 2. How the business works

Eskista's income comes from a **commission on each rental**. A vendor's camera rents for
10,500 ETB, Eskista keeps roughly 15%, and the vendor receives the rest after the gear comes
back and passes inspection.

Around that there are other revenue lines the documents mention: delivery fees, studio
rental, featured listings, verification fees and training.

Three things make this a business rather than a website:

- **Trust.** Vendors are verified with a Fayda ID and, for companies, a business
  registration. Customers sign a rental agreement. Nobody transacts anonymously.
- **Custody.** Equipment physically moves. Its condition is recorded when it goes out and
  when it comes back, because that record is what settles a dispute about a damaged lens.
- **Mediation.** Vendors and customers never deal directly. That is both a service and a
  commercial protection — it stops a vendor taking an Eskista client off-platform.

---

## 3. Who uses it

| Role | What they do |
| --- | --- |
| **Customer** | Browses gear, requests a rental, pays, returns it, leaves feedback |
| **Vendor** | Lists equipment they own, confirms availability, gets paid after settlement |
| **Talent** | Hired for skill rather than equipment — cinematographers, editors, photographers |
| **Admin (Eskista team)** | Approves everything and moves each booking through its lifecycle |

One person can hold several roles — a vendor can also rent gear as a customer. The system
stores the **roles a person has**, not a single account type, and switching between the
customer and vendor views never changes what someone is actually allowed to do.

Almost every meaningful state change is an admin action. That is a deliberate design point,
not a limitation: Eskista wants a person to look at each booking.

---

## 4. The core concept: a rental is a lifecycle

Everything in the system hangs off this. A rental is not one event, it is a chain:

```
Customer asks  →  Eskista quotes  →  Customer accepts  →  Vendor confirms availability
   →  Eskista approves  →  Payment  →  Gear goes out  →  Rental runs
   →  Gear comes back  →  Eskista inspects  →  Vendor is paid  →  Customer gives feedback
```

Each arrow is a status change, and the system records **who** did it, **when**, and **why**,
in a log that can never be edited. That history is the product. Six weeks later, when someone
argues about a scratched lens, that record is the answer.

Two subtleties worth knowing:

- **The vendor's confirmation and Eskista's approval are separate gates.** A vendor
  confirming their camera is free is not the same as Eskista approving the booking. Both must
  clear. Collapsing them into one status would lose the vendor's decision entirely.
- **Equipment is tracked as individual physical units.** If a vendor owns three identical
  FX3 bodies, the system knows which one went out, with its serial number. Without that you
  cannot attribute damage to anything.

---

## 5. What we are building, and what we are not

An app has two halves.

The **frontend** is what you see and tap. Another developer is building it. We have not
touched it.

The **backend** is everything with no screen: where data lives, what the rules are, and who is
allowed to do what. When the app shows "Sony FX3 — 3,000 ETB/day — Available", the frontend
asked the backend and the backend worked out the answer.

Crucially, **the rules must live in the backend.** The app can hide an "Approve" button from
a vendor, but only the backend can actually refuse when someone sends the request anyway.
Anyone can send a request to a server; the frontend is a convenience, not a control.

The two talk through an **API** — a fixed set of addresses the app calls, like
`/vendor/equipment` to list a vendor's gear. There are 37 of them so far, and they are
documented automatically so the frontend developer can see exactly what is available.

---

## 6. The architecture

Four parts, each running in its own **Docker** container — a way of packaging software so it
behaves identically on every machine, which removes the "works on my computer" problem.

**PostgreSQL** — the database. All permanent data: users, vendors, listings, bookings,
payments, contracts. 44 tables.

**NestJS (TypeScript)** — the API. All the rules and logic. This is the bulk of the work.

**Redis** — a small, fast, temporary store. Used for caching frequent lookups and for rate
limiting, so nobody can hammer the login endpoint ten thousand times a minute.

**File storage** — photos, ID documents, receipts, signed contracts. Currently written to a
folder on disk, but behind a small interface so it can move to cloud storage later without
rewriting the code that uses it.

### Login works differently here

The app runs **inside Telegram**, so customers and vendors have no username or password.
Telegram itself proves who the person is: it sends a cryptographic signature that we verify
against our bot's secret key. If the signature matches, the person is genuinely who Telegram
says. If anything is altered, it fails.

Only Eskista staff have passwords, because they work from a dashboard rather than inside
Telegram.

This is worth being able to explain, because it sounds unusual. The short version: *"We do
not store customer passwords at all. Telegram vouches for the user, and we verify that
mathematically."*

---

## 7. Technical decisions worth being able to defend

If someone asks "why did you do it that way", these are the answers.

**Money is stored as whole numbers, never decimals.** 3,000 ETB is stored as 300000 cents.
Decimal arithmetic on money produces rounding errors that eventually make a vendor's payout
disagree with the customer's invoice by a cent. Integers cannot drift.

**Availability is calculated, never stored.** There is no "is available" checkbox. Whether a
camera is free on a date is worked out from real bookings each time. A stored flag would
eventually disagree with reality — someone cancels and the flag is never updated. The only
thing stored is dates a vendor has deliberately blocked.

**Prices are frozen onto a booking when it is approved.** If a vendor raises their day rate
next month, an existing booking must not silently change. The agreed numbers are copied onto
the booking and never recomputed.

**Verification and availability are separate ideas.** A green tick means Eskista approved the
listing. "Booked" means someone has it right now. They look similar on screen and are
completely different concepts; conflating them would be a real bug.

**Booking history is append-only.** Statuses are never overwritten in place — each change
writes a new record. That is what makes the system usable as evidence.

**Everything is denied by default.** Every endpoint requires a valid session unless it is
explicitly marked public. The safer failure is locking someone out, not letting someone in.

---

## 8. What exists today

All of this has been run against a real database and a running server, not merely written.

- **Login** via Telegram, plus the separate admin password path
- **Vendor onboarding** — profile, Fayda ID and business registration upload, the
  individual-versus-company document rule, and a live checklist of what is still missing
- **The Eskista–vendor contract**, generated from a template that differs for individuals and
  companies, frozen and fingerprinted so it can be proven later, and signed in the app
- **Equipment listings** with full specifications, photos, and individually tracked physical
  units with serial numbers
- **An availability calendar** showing four states per day: available, blocked by the vendor,
  reserved, and currently rented
- **Vendors accepting or declining** booking requests, with the reason recorded
- **Vendor earnings** and settlement records, including grouping several bookings into one
  payout
- **Demo data** — two vendors, five listings, twelve physical units, six bookings spread
  across the lifecycle, real signed agreements, and VAT applied to some invoices but not
  others

Quality position: no type errors, no lint warnings, 36 automated tests passing, and the
whole thing verified end to end against a live database.

---

## 9. What is left

Honestly, the majority. Roughly **35–40% complete**.

**The customer side does not exist yet.** No browsing, searching, or requesting a booking.

**The admin side does not exist yet.** No approving vendors or listings, no moving bookings
through the lifecycle, no verifying payments, no recording inspections, no paying vendors.
Given that Eskista's model is "a person decides everything", this is the operational heart
and it is empty.

Also outstanding: invoicing, payment verification, notifications actually being sent, PDF
generation, and the talent side beyond its database design.

And from the newest documents: quotations, handover condition records, incident reports,
maintenance logs, customer feedback cases, receivables chasing, internal payment approvals,
studios and production projects.

A fair way to describe it: **the supply side is built, the demand side and the operations
console are not.**

---

## 10. The open decisions — what to raise

These are genuinely undecided and the answers change the work. Raising them yourself is a
strength, not an admission.

**1. Can one customer order contain gear from two different vendors?**
Currently an order holds one item from one vendor. The operational forms suggest a customer
gets one quotation listing several items, which may come from different owners. If that is
right, it is a restructure of the core of the system — and every day spent building on the
current shape is a day of rework. This is the single most expensive open question.

**2. When does the customer actually pay?**
The designs show paying upfront. The contracts show a deposit before collection and the
balance after return, sometimes on credit, with a whole form for chasing unpaid invoices.
Both are probably real — the quick self-service path and the managed path for production
companies. Confirmed as two order types, but the detail is still open.

**3. Is VAT included in the listed price or added on top?**
If a camera is listed at 3,000 ETB, is that the final price or does 15% get added? It changes
every number the customer sees.

**4. Withholding tax on vendor payments.** The forms show it deducted from every payout. The
rate, who it applies to, and whether we issue a certificate are all unknown.

**5. Are studios in scope now?** There is a full studio booking form, and studios work
differently — booked by the hour, with overtime, and no return or inspection.

---

## 11. Risks worth naming

**A known security gap.** Uploaded files — including Fayda ID scans and payment receipts —
are currently served without any access check. The filenames are unguessable, but that is not
access control. It needs fixing before anything real is uploaded, and it is a small,
self-contained job.

**A concurrency gap.** Two admins approving at the same moment could in principle double-book
the same camera. It needs a database-level guard, which is waiting on question 1 above.

**Requirements are still moving.** Three separate sources — the original brief, the designs,
and the operational documents — describe somewhat different businesses. That is normal at
this stage, but it is why the open questions above matter more than writing more code.

---

## 12. Questions you are likely to be asked

**"How far along are we?"**
The supply side is done and tested — vendors can register, get verified, list equipment and
manage availability. The customer side and the admin console are not started. Around 35–40%.

**"Why isn't it finished if the designs have been ready for weeks?"**
The designs cover the customer app. The operational documents that arrived later describe a
larger business — quotations, multi-item orders, deposits and credit terms, condition records,
withholding tax. They contradict the designs in places. Building the wrong foundation and
redoing it costs more than waiting for a few answers.

**"What's blocking you?"**
Mainly one question: whether a customer order can span multiple vendors. It determines the
shape of the core of the system.

**"Can we demo something by [date]?"**
The supply side can be demonstrated now with real data. An end-to-end rental cannot, because
the customer and admin halves are not built. Two of the three safe next pieces would make a
complete supply-side story demonstrable.

**"Is it secure?"**
Reasonably. Passwords are not stored for customers at all. Everything is denied by default.
Credentials are stripped from logs. There is one known gap — uploaded documents are not
access-controlled yet — which is identified and small to fix.

**"What happens if the vendor and the customer disagree about damage?"**
The system records equipment condition at handover and at return, tied to a specific serial
number, with photos, plus a complete unchangeable history of the booking. The return side is
built; the handover side is identified and not yet built.

---

## 13. Ten sentences to have in your head

1. Eskista is a managed marketplace — Eskista is a party to every transaction, not a
   middleman website.
2. Income is a commission on each rental, taken after the gear comes back and passes
   inspection.
3. Four kinds of user: customers, vendors, talent, and the Eskista team, and one person can
   be several of them.
4. The heart of the system is a rental lifecycle where a person approves each step and every
   change is recorded permanently.
5. We are building the backend — the data and the rules; someone else builds the screens.
6. Customers log in through Telegram, so we never store their passwords.
7. Equipment is tracked as individual physical units with serial numbers, which is what makes
   damage attributable.
8. The supply side is built and tested; the customer side and admin console are not.
9. The main thing blocking progress is whether one order can include gear from several
   vendors.
10. There is one known security gap — uploaded documents are not yet access-controlled — and
    it is small and identified.
