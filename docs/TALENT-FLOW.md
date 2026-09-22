# Talent marketplace & agreement signing — September 2026 designs

Covers the three additional sheets: agreement signing (4 screens), the marketplace shell
(11 screens) and the talent hire journey (15 screens).

---

## 1. Agreement signing — this reverses an earlier decision

The PM previously said customers would *"sign them and reupload their signed versions"*.
**The designs do not do that.** Signing is entirely in-app:

1. **Read** — the agreement renders as scrollable text with a header showing Ref, Rental
   period, Date and **"Governed by: Ethiopian Law"**, plus a `Pending Signature` chip.
   A checkbox confirms the terms were read.
2. **Sign** — a **drawn signature canvas** with undo, redo, clear and expand controls.
3. **Confirm** — "Agreement Signed. Your digital signature has been recorded. A copy will be
   included in your booking documents."
4. **Signed state** — chip turns green, the captured signature image is displayed alongside
   **Signed By** and **Project type**, with a **Download Agreement** action.

The legal basis is stated on screen:

> "This digital signature is legally binding under the Ethiopian Electronic Transactions
> Proclamation. Keep a copy for your records — it will be emailed to you automatically."

### What this means for the schema

The existing `Agreement` model is **closer to right than the upload approach would have
been**. `signatureImageKey` already exists and now has a clear purpose — the drawn signature
bitmap. What is missing:

- **A separate agreement reference.** The header shows `ESK-TLT82` while the booking is
  `ESK-10482`. Agreements carry their own number.
- **Automatic email delivery** of the signed copy.
- `governedBy` / jurisdiction on the template.
- Confirmation that the customer signature alone suffices — no Eskista counter-signature
  appears anywhere in these screens, which contradicts the two-signature blocks in the Word
  templates.

⚠ **Worth raising:** the Word agreements have two signature blocks (Eskista + Client, each
with Name and Title). The app only ever captures the customer's. Either Eskista counter-signs
elsewhere, or the app flow is the real one and the Word templates are the paper fallback.

## 2. Marketplace shell

**Onboarding** — the role chooser is reworded: *"I want to Rent or Hire"* and *"I want to
list my equipment or Services"*. Both roles now explicitly cover services, not just gear.

**Home** adds a promo card — *"Creative Professionals: Hire the talent. Tell the story."*
with a **Find Talent** action — alongside categories, Featured and Popular rails, and the
booking-status banner.

**Talent tab** mirrors Explore: search, category chips (Cinematographers, Photographers,
Editors, Directors, Sound Engineers, Designers, Models & Actors, Managers), a Popular rail,
and a **HOW IT WORKS** explainer — Discover → Request to Hire → Eskista Manages.

**My Bookings** has three tabs (Active / Upcoming / Completed) and now mixes **equipment and
talent in one list**. Action buttons differ by type and state: `Arrange Return`, `Complete
Payment`, `Track Booking`, `Book Again`, and for talent `Complete Service`.

**Profile** shows three counters — **Bookings, Rating, Vendors** — and the customer is
labelled **"Verified customer · Addis Ababa"**. So customers are rated and verified too. Menu:
Edit My Profile, My Bookings, Notifications, **Verification**.

**Notifications** is a real screen with read/unread state: Booking Approved, Payment
Verified, Equipment Out for Delivery, **Return Reminder** ("Tomorrow"), Booking Completed,
Payment Processed, **Feedback Requested**.

Two of those are **scheduled, not event-driven** — Return Reminder fires the day before the
due date, Feedback Requested after completion. That needs a job scheduler, which does not
exist yet.

## 3. Talent hire journey

### 3.1 Talent profile

Far richer than the current `TalentProfile`:

| Element | Current |
| --- | --- |
| Cover photo + avatar, `Available` chip | partial |
| Rating, review count, **booking count** | `completedBookings` exists |
| **Portfolio grid** with titled thumbnails | `PortfolioItem` exists |
| About | `bio` ✓ |
| **Services price list** — Full Day Commercial 4,500 / Music Video 3,000 / Documentary 3,500 / Half Day 2,500 | `TalentService` ✓ |
| Specializations as chips | ✓ |
| **Languages** | ✓ |
| **Availability calendar** (Selected / Unavailable) | `TalentBlockedDateRange` ✓ |
| **Reviews** with reviewer, project type, date | `Review` ✓ |
| Footer: day rate + **Request to Hire** | — |

The listing card shows role, rating, **booking count** and location — a directory entry, not
just a profile.

### 3.2 Five-step hire wizard

```
1. Project     — customer & contact, ID upload, project type chips, description
2. Schedule    — employment type, start/end date, start/end TIME, calendar
3. Location    — city, venue, access notes
3. References  — optional file uploads (moodboards, briefs, scripts) PNG/DOCX/EPG
3. Budget      — banded ranges OR a specific amount
   → Review Request → Submit
```

Note the design labels steps 3–5 all as "Step 3 of 5" — a mock slip, not a real branch.

**New fields not in `TalentBookingDetail`:**

- **Employment type** (Full-Time shown; the tracker also shows "Full Time · On-site", so
  there is an on-site/remote dimension too)
- **Start and end time** — talent is booked by the hour within a day, not just by date
- **City** separate from venue, plus access notes
- **Reference files** — a file collection on the request
- **Budget as a band** (`Under 5,000`, `5,000–10,000`, …) *or* an exact figure

Privacy rule on screen: *"Exact location details are shared with the talent only after
booking confirmation."* So venue detail must be withheld from the talent until confirmed.

### 3.3 Talent lifecycle — six steps, different from equipment

```
Request Submitted → Talent Confirmation → Payment → Booking Confirmed
    → Project / Hire → Completed
```

No delivery, no return, no inspection — as predicted. Against the shared `BookingStatus`
enum, `Talent Confirmation` maps to `ESKISTA_REVIEW` + `supplierResponse`, and `Project /
Hire` to `IN_PROGRESS`. **No new statuses are needed.**

Reference prefix differs: **`ESK-TLT82`**, `ESK-TLT-8847` for talent versus `ESK-10482` for
equipment.

### 3.4 Price negotiation — genuinely new

A modal:

> **Price Modification** — "The Service Provider requested specific payment amount of:
> **ETB 14,500**" → **Decline** / **Accept and Continue**

The customer submits a **budget** (12,000 in the tracker, or a band), the talent responds
with a **specific figure**, and the customer accepts or declines. The tracker's Budget field
changes from `ETB 5,000 – 10,000` to `ETB 12,000` once agreed.

`TalentBookingDetail` has `budgetMinor` and `finalPriceMinor`, which covers the endpoints —
but not the **negotiation round**: who proposed, when, and whether it was accepted or
declined. That needs its own record for auditability, the same way booking statuses do.

Also note **reference files are "2 files (via Eskista)"** — mediated, consistent with
Eskista sitting between both parties everywhere else.

## 4. Changes required, consolidated

| # | Change | Notes |
| --- | --- | --- |
| 1 | `Agreement.reference` — own number (`ESK-TLT82`) | small |
| 2 | Signature capture already fits; add email delivery of signed copy | small |
| 3 | `TalentBookingDetail`: employment type, on-site/remote, start/end time, city vs venue, access notes | small |
| 4 | `TalentBookingRequestFile` — reference file uploads | small |
| 5 | Budget **band** as well as exact amount | small |
| 6 | `PriceProposal` — proposed amount, by whom, accepted/declined, timestamp | medium |
| 7 | Talent reference prefix `ESK-TLT-#####` | small |
| 8 | Customer verification + rating (Profile shows "Verified customer", rating 4.9) | medium |
| 9 | Scheduled notifications — return reminder, feedback request | medium, needs a scheduler |
| 10 | Talent directory endpoints: search, filter, profile, availability | medium |

## 5. Open questions added by these sheets

1. **Does Eskista counter-sign?** The app captures only the customer signature; the Word
   templates have two blocks.
2. **Who sets the final talent price** — the talent proposes and Eskista relays, or Eskista
   sets it? The modal says "The Service Provider requested".
3. **Customer verification** — what does "Verified customer" require? ID upload is in the
   booking flow, but there is a separate Verification menu item.
4. **Customer rating 4.9** — who rates customers? Vendors and talent presumably, but no
   screen shows it being given.
5. **Employment type values** — Full-Time is shown; what else? And is on-site/remote separate?
