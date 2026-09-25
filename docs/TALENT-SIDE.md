# Talent side — design record

The creative-professional ("talent") half of Eskista: onboarding, profile, portfolio, CV,
hire requests, engagements, agreements and earnings. Written from the September 25, 2026
design sheets, read frame by frame, and reconciled with the customer side already built.

Sources:

| Sheet | Frames | Covers |
|---|---|---|
| `creative customer onboarding flow(talent).png` | 16 | Role chooser → provider type → 9-step profile wizard → pending verification |
| `talent booking confirmation.png` | 7 | Talent dashboard, earnings, portfolio list / detail / edit, two confirm dialogs |
| `contract layout for talent.png` | 4 | Agreement read → sign → signed → download |
| `talent premitive pages.png` | — | **Byte-identical to `talent booking confirmation.png`** (same SHA-256). The intended sheet is missing — most likely the hire-request detail, accept/decline and bookings screens, which appear nowhere else. |

---

## 1. Frame inventory

### Onboarding (`creative customer onboarding flow`)

| # | Screen | What it collects / shows |
|---|---|---|
| OB02 | **How will you use Eskista?** | Customer ("Rent or Hire") or Vendor ("list my equipment or Services") |
| OB03 | **What will you offer?** — *Provider Registration* | Equipment Owner **or** Creative Professional. Talent is a branch of "Vendor", not a third top-level choice |
| OB04 | **Grow your creative career** | Landing: *Become a Vendor* / *Already a Vendor? Sign In* (copy says vendor; this is the talent path) |
| OB05 | Profile 1 of 8 — *basic info* (titled "Choose Profession" in error) | Full name, phone, email, location, years of experience, professional bio, **Minimum Rate ETB /day**, languages, **profile picture (required)**, **terms checkbox**. **Save** (draft) top-right. "Profile 13% complete" |
| OB06 | 2 — **Choose Profession** | Primary profession chips (Cinematographer, Photographer, Video Editor, Film Director, Sound Engineer, Model/Actor, Colorist, Production Designer, Graphic Designer, Set Designer) — "You can add more later". Specializations (optional) chips |
| OB07 | 3 — **Availability** | Working days (Mon–Sun toggles), day type (Full day 8+ h / Half day 4–8 h / Flexible project-based), unavailable dates (optional) with calendar: Available / Rented / Blocked |
| OB08 | 4 — **Work Experience** | Repeatable: job title/role, company/client, start, end, description, *currently working here* |
| OB09 | 5 — **Education** | Repeatable: institution, field of study, qualification/degree, start year, end year |
| OB10 | 6 — **Skills** | Free-text custom skills + suggested chips (Cinematography, Video Editing, DaVinci Resolve…) |
| OB11 | 7 — **Portfolio** | Repeatable project: cover image, title, client, your role, start, end, description, work link |
| OB12–15 | 8 — **CV Preview** | "Auto-generated from what you entered". Template: Classic / Minimal / Sidebar, live preview |
| OB16 | 9 — **Publish** | *What Eskista verifies*: valid Ethiopian ID or passport, **portfolio 3+ pieces**, **2 professional references**. ID upload, reference 1 & 2 (name and contact), **profile URL** `eskista.com/talent/dawit-media` with Copy. "Reviewed manually; not listed until verified." **Submit Profile** |
| OB17 | **Pending Verification** | Review checklist: Identity verification · Portfolio review · Reference check · Eskista approval, each with a state (In progress / Queued / Pending). "Typical review 2–3 business days". *Continue Dashboard* |

Step numbering in the sheet is inconsistent ("1 of 8", then "2 of 8" on every later screen)
while there are nine screens. The order above is the content order.

### Talent app (`talent booking confirmation`)

| # | Screen | Shows |
|---|---|---|
| BC02 | **Home / dashboard** | Greeting; **This month ETB 12.4k**; **Profile views 148**; **Pending Requests 9**; **Profile completion 78%** → Complete Profile; quick actions Portfolio · My CV · Opportunities · Share Profile; **"2 new opportunities"** banner (project types); **Hire Requests** list — title, *Request Received*, date, **budget range**, View Request. Nav: Home · Requests · Bookings · Earnings · Profile |
| BC03 | **Earnings** | Total revenue, today's earning, upcoming; per engagement: project, date, *your earnings*, status Upcoming / Paid / Pending |
| BC04 | **Portfolio** | Cards: cover, month, role, title, client; Edit / View; **Add Project** |
| BC05 | **Project detail** | Client, role, date range, about, products link, Remove / Edit, *Other Projects* rail |
| BC06 | **Edit project** | Same fields as OB11, *Replace Image*, Save and Exit |
| BC07/08 | Confirm dialogs | Remove project · cancel editing (client-only) |

### Agreement (`contract layout for talent`)

Identical to the customer contract layout at 2× resolution — still titled "Equipment Rental
Agreement / Sony FX3" and showing the in-app **signature pad**. The September 23 meeting
replaced the pad with *Download Agreement (PDF) + Upload Scanned Agreement* "on both Client
and Talent portals", so the talent uses the same scan-upload flow the customer already has:
`AWAITING_UPLOAD → UNDER_REVIEW → APPROVED`.

---

## 2. Conflicts with the September 23 meeting notes — decided: the designs win

The September 25 designs are newer than the September 23 meeting, so where they disagree the
API follows the designs. The rule used for "required": **a field is required unless the
design labels it "(optional)"** — specializations, unavailable dates, experience and
portfolio descriptions, work links and the suggested-skill chips are the optional ones.

| Design shows | Meeting said | API (follows the design) |
|---|---|---|
| Availability step (working days, day type, blocked dates) | Remove it | Working days and day type **required**; blocked dates optional |
| Work Experience, repeatable | Remove it | **At least one** entry; title, company, start required; end required unless "Currently working here" |
| Education, repeatable | One "Highest Education" line | **At least one** entry, every field required. `highestEducation` kept only for old data |
| Separate Skills step | Merge into profession | **At least one** skill |
| "Select your primary profession. You can add more later." | Multi-select | Wizard sends one; the Profile tab can add more (`professions[0]` is the primary) |
| CV template: Classic / Minimal / Sidebar | One standard layout | `cvTemplate`, default `CLASSIC`, all three render |
| Step 1: email, years of experience, language | — | **Required** (not marked optional) |
| Portfolio project: cover, title, client, role, dates | — | **Required**; description and work link optional; 3–5 projects |
| "Reference 1 — name and contact" (one box) | — | `name` holds the box's text; `contact` optional |
| Signature pad | Scan and upload | Scan and upload (the meeting's later decision; the pad is not in the app) |

**The missing sheet.** `talent premitive pages.png` duplicates another sheet. The screens it
most likely held (hire-request detail, accept / decline, bookings) were built from the rest
of the flow and the customer side's matching screens; see section 4.

---

## 3. How it joins the customer side

The customer already has the five-step hire wizard, fixed talent rates, the 6-step talent
timeline, reference files, and **Complete Service**. What changes is the hire itself,
following the multi-talent flow approved on September 24:

1. The customer invites **1–5 talents** to one request (`talentProfileIds`).
2. Each talent has **48 h** to accept or decline. Silence is `EXPIRED`.
3. The customer picks from those who accepted, within **72 h** of the first acceptance —
   or opts in to **hire the first to accept** (`autoHireFirstAccept`), which covers the
   reading "if one accepts first".
4. Picked talents are **HIRED**; everyone else who responded sees **REJECTED**, as asked.
5. Only a hire prices the booking — each talent has their own fixed rate, so nothing can be
   priced while several are invited. Hiring issues two agreements (Customer ↔ Eskista and
   Eskista ↔ Talent) and moves the booking to payment.
6. Headcount > 1 hires several talents; each gets their own booking so each has its own
   agreement, payout and review.

All three limits are admin settings.

**Privacy.** A talent never sees the client's name, company or contact — only the brief,
project type, dates, times, city, headcount and budget. Venue access notes and reference
files unlock only once hired.

**Timeline mapping.** Request Submitted → *Talent Confirmation* (invitations out) → Payment
(hired) → Booking Confirmed → Project / Hire → Completed.

---

## 4. Decisions made without a design

| Need | Decision |
|---|---|
| Hire request detail, accept / decline | Built; the missing sheet presumably covers them |
| "Opportunities" vs "Pending Requests" | Opportunities = invitations not yet opened; Pending = not yet answered |
| Services price list (shown on the customer's profile screen, no talent screen) | CRUD endpoints for the talent's own services |
| Profile views | Counted on each customer view of the public profile, never the talent's own |
| Review checklist states | Set on submission; the admin approve marks all passed |
| Portfolio size | 3–5 pieces, per the meeting; 3 required to submit |
| Earnings | Upcoming = confirmed, not finished; Pending = finished, not paid out; Paid = settled |

---

## 5. API

All under `/api/v1`. Full request/response shapes are in Swagger (`/docs`), tags
`talent · profile`, `talent · work`, `talent · notifications`, `customer · bookings`,
`admin · settings`.

### Onboarding and profile (`talent · profile`)

| Screen | Endpoint |
|---|---|
| Creative Professional → step 1 | `POST /talent/onboarding` — creates the profile, grants TALENT, switches the app |
| Every wizard **Save**, Profile edits | `PATCH /talent/me` |
| Wizard progress, Profile tab, Pending Verification | `GET /talent/me` — `steps`, `completionPercent`, `submitBlockers`, `reviewChecklist` |
| Profile picture | `POST /talent/me/avatar` |
| Work experience / Education / References | `PUT /talent/me/experience`, `/education`, `/references` (replace the list) |
| Portfolio list / detail / add / edit / remove / reorder | `GET·POST /talent/me/portfolio`, `GET·PATCH·DELETE /talent/me/portfolio/:id`, `PUT /talent/me/portfolio/order` — multipart, cover as `cover` |
| Services price list | `GET·POST /talent/me/services`, `PATCH·DELETE /talent/me/services/:id` |
| Availability calendar | `GET /talent/me/availability`, `POST /talent/me/blocked-dates`, `DELETE /talent/me/blocked-dates/:id` |
| ID / passport | `POST /talent/me/id-document` |
| Profile URL | `GET /talent/slug-availability?slug=` |
| Submit Profile | `POST /talent/me/submit` |

### Work (`talent · work`)

| Screen | Endpoint |
|---|---|
| Home | `GET /talent/me/dashboard` |
| Earnings | `GET /talent/me/earnings` |
| My CV | `GET /talent/me/cv`, `GET /talent/me/cv.pdf` |
| Requests tab / detail | `GET /talent/requests?status=`, `GET /talent/requests/:id` (marks seen) |
| Accept / Decline / Withdraw | `POST /talent/requests/:id/accept`, `/decline`, `/withdraw` |
| Bookings tab / detail | `GET /talent/bookings?tab=`, `GET /talent/bookings/:reference` |
| Agreement read / PDF / upload scan / decline | `GET /talent/bookings/:reference/agreement`, `…/agreement/pdf`, `POST …/agreement/signed-copy`, `POST …/agreement/decline` |
| Notifications | `/talent/notifications` — same inbox as `/customer/notifications` |

### Customer side of the hire (`customer · bookings`)

| Screen | Endpoint |
|---|---|
| Hire wizard | `POST·PATCH /customer/bookings/talent/draft` — `talentProfileIds` (1–5), `autoHireFirstAccept` |
| Submit | `POST /customer/bookings/draft/:id/submit` — sends the invitations; nothing priced yet |
| Choose Talent | `GET /customer/bookings/:reference/invitations` — each talent's answer and price |
| Invite more | `POST /customer/bookings/:reference/invitations` |
| Hire | `POST /customer/bookings/:reference/hire` |
| Cards | `hiring` summary on each talent card; `CHOOSE_TALENT` action once someone accepts |

### Catalogue and admin

- `GET /catalogue/talent/by-slug/:slug` — the shared profile link.
- `GET /catalogue/talent/:id/cv.pdf` — the CV without contact details.
- `GET /admin/review/talent/:id` — now includes the `dossier` (ID, references, portfolio).
  Approve marks all three checks passed and notifies the talent; reject notifies with the reason.
- `GET·PATCH /admin/settings/hiring` — max invitations, answer window, choice window.

## 6. Hire lifecycle

```
customer submits ──► every invitation INVITED (48 h clock), request ESKISTA_REVIEW
talent accepts   ──► ACCEPTED; first acceptance starts the customer's 72 h clock
                     (autoHireFirstAccept: hired on the spot, up to the headcount)
talent declines  ──► DECLINED       silence ──► EXPIRED     pulls out ──► WITHDRAWN
customer hires   ──► chosen HIRED; everyone still in the running REJECTED
                     booking priced from the hired talent's rate, AWAITING_PAYMENT,
                     both agreements issued (TALENT_ENGAGEMENT + TALENT_SERVICE)
nobody left, or 72 h pass ──► request EXPIRED, customer told
customer cancels ──► open invitations CANCELLED, talents told
```

Clocks run as BullMQ jobs (`hiring.invitation-expiry`, `hiring.selection-reminder` at 24 h
left, `hiring.selection-deadline`). Every read also settles anything past its time, so a lost
job never leaves a stale "Reply within 0 hours".

Headcount > 1: the first hire takes over the request booking; each further hire becomes a
sibling booking (`parentBookingId`) with its own reference, agreement, payment and payout.
Siblings share the request's reference files.
