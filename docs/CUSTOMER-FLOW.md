# Customer flow — analysis of the September 2026 design set

26 screens, read individually. This supersedes the customer half of `DOMAIN-ANALYSIS.md`
and answers several questions that were previously open.

---

## 1. Navigation

Five tabs, up from four: **Home · Explore · Talent · Bookings · Profile**.

**Talent is now a top-level destination**, not a later phase. That settles the earlier
scope question — the talent marketplace ships with the customer app.

## 2. The customer lifecycle — seven steps

Every status screen shows the same tracker:

```
Request Submitted → Under Review → Payment → Booking Confirmed
   → Delivery / Pickup → Return Pending → Inspection → Completed
```

Against the current `BookingStatus` enum:

| Design step | Current enum | Note |
| --- | --- | --- |
| Request Submitted | `REQUEST_SUBMITTED` | ✓ |
| Under Review | `ESKISTA_REVIEW` | renamed in UI only |
| Payment | `AWAITING_PAYMENT` | ✓ |
| Booking Confirmed | `BOOKING_CONFIRMED` | ✓ |
| Delivery / Pickup | `DELIVERY_PICKUP` | ✓ |
| Return Pending | `RETURN_SCHEDULED` | ✓ |
| Inspection | `INSPECTION` | ✓ |
| Completed | `CLOSED` | `SETTLEMENT` is internal, hidden from the customer |

**The existing machine already covers this.** `IN_PROGRESS`, `RENTAL_COMPLETED`,
`RETURN_RECEIVED` and `SETTLEMENT` simply aren't shown to customers — which is exactly the
projection the vendor-side analysis predicted.

### Payment timing is resolved

Payment sits at step 3, **before** Booking Confirmed, and the design says so explicitly:

> "Booking is not confirmed until Eskista verifies availability, provides a quotation, and
> you confirm payment."

So for the self-serve app, the original Figma sequence stands. The advance/final split in
the contracts belongs to the managed enterprise path, confirming the two-order-type answer.

## 3. Money — several questions answered

From Finalize Booking and Booking Details:

```
3 days × ETB 3,500        ETB 10,500
Delivery                  ETB    500
VAT (15%)                 ETB  1,575
Service fee               ETB    300
Security deposit          ETB  4,200
─────────────────────────────────────
Grand total               ETB 12,875
```

**VAT is exclusive, at 15%, and applies to rental + delivery but not the deposit.**
Check: (10,500 + 500) × 15% = 1,575 exactly. This is precisely what `computePriceBreakdown`
already implements — the model was right.

**The deposit is presented separately, then added.** Before approval the total reads
ETB 12,575 with the deposit shown beneath as "Refundable upon return and satisfactory
inspection"; after approval it reads ETB 16,575, deposit included. So the deposit is quoted
apart and collected with the payment.

**A "Service fee" line is new** — ETB 300, distinct from delivery. Not in the schema.

**Note a mock inconsistency:** the listing shows ETB 3,200/day, the breakdown uses ETB 3,500.
Placeholder noise; the structure is what matters.

## 4. New things the schema does not have

### 4.1 Customer profile and ID (Request Your Booking)

The request form collects **Organization / Name**, **Contact person**, phone, email, and
requires an **ID upload** (PNG/JPG/JPEG, max 5MB) — plus **Project / Purpose** and
**Production location**.

There is still no customer profile in the schema, and now customers have KYC too. This
matches EF-01's Customer/Contact block and the agreements' TIN field.

### 4.2 Draft bookings

Both request screens have **Save Draft** beside Continue. The request is a two-step wizard
(details → delivery/pricing), so a partially completed request must persist.

Needs a `DRAFT` state before `REQUEST_SUBMITTED`.

### 4.3 Courier tracking

"Track Your Equipment" shows a named courier (**Dawit Bekele**), vehicle and plate
(**Motorbike · AA 3-1024**), an **estimated arrival**, a **Call Courier** action, and its own
sub-tracker:

```
Equipment Prepared → Picked Up → Out for Delivery → Delivered
```

`Fulfilment` has `courierName` and `courierPhone` but no vehicle, plate, ETA, or delivery
sub-status. "Equipment Prepared" also matches the **Preparation** step from the PM's journey.

### 4.4 Incident reporting, customer-facing

"Report an Issue" is a real form: **issue type** (Physical Damage / Missing Accessory /
Technical Malfunction / Delivery Issue / Other), **when it occurred** (During Delivery /
During Rental / During Return), description, and **photo attachments**.

This is EF-05 surfaced to customers. The screen also states the mediation rule outright:

> "Eskista mediates all incidents. Do not contact the vendor directly."

### 4.5 Documents & Records

Booking Details offers three downloadable PDFs: **Rental Agreement**, **Payment Evidence**,
**Settlement Record**. Customers expect real PDFs, which makes the deferred PDF renderer a
requirement rather than a nice-to-have.

### 4.6 Customer-visible activity feed

The bottom of Booking Details is a reverse-chronological feed with actor attribution:

```
Equipment delivered to customer        Eskista Courier · Aug 18, 3:41 PM
Payment verified — ETB 12,875 + deposit ETB 4,200   Eskista · Aug 17, 10:30 AM
Payment evidence submitted             Customer · Aug 16, 2:15 PM
Booking approved. Quotation sent to customer.       Eskista · Aug 15, 5:00 PM
Availability confirmed with vendor      Eskista · Aug 15, 11:20 AM
Booking request submitted               Customer · Aug 14, 9:05 AM
```

`BookingStatusEvent` already stores actor, role, reason and timestamp — this renders
directly from it. It needs a customer-safe projection, since some events (vendor decline
reasons, internal notes) must not be exposed.

Note "Availability confirmed with vendor" appears as an Eskista action — the vendor gate is
visible to the customer only as Eskista's own step, which is consistent with full mediation.

### 4.7 Return scheduling and inspection visibility

Return Equipment offers **Schedule Pickup** vs **Drop Off**, selectable time slots, address,
and return instructions. Equipment Return then shows its own tracker:

```
Rental Completed → Pickup Scheduled → Equipment Received → Inspection → Rental Closed
```

Booking Details also exposes an **Inspection** section — physical condition, functional test,
missing accessories, damage, result, final asset status — blank until the return happens.
So inspection results are customer-visible, not internal only.

### 4.8 Serial number shown to the customer

Booking Details shows **Serial / Asset ID: SNY-FX3-0023884**. Unit-level tracking is not just
an internal concern; the customer sees which physical unit they hold.

## 5. What this confirms about existing work

- The **seven-step tracker maps onto the existing enum** with no schema change.
- **VAT arithmetic is already correct** — exclusive, 15%, excluding the deposit.
- **`BookingStatusEvent`** is exactly what the activity feed needs.
- **Unit-level serials** were the right call.
- **Eskista-mediated communication** is reinforced: "Contact Eskista Support", "Do not
  contact the vendor directly", a courier call button but no vendor contact anywhere.
- The **listing detail screen is unchanged** from the previous set, so the equipment
  catalogue API already serves it.

## 6. Changes required

| # | Change | Size |
| --- | --- | --- |
| 1 | `CustomerProfile` — organization, contact person, email, ID document, TIN | medium |
| 2 | `DRAFT` booking state + save-draft endpoints | small |
| 3 | `serviceFeeMinor` on booking and invoice | small |
| 4 | Courier fields on `Fulfilment`: vehicle, plate, ETA, delivery sub-status | small |
| 5 | `Incident` model + customer report endpoint with photo upload | medium |
| 6 | Customer-safe projection of `BookingStatusEvent` | small |
| 7 | PDF rendering for agreement, payment evidence, settlement record | medium |
| 8 | Talent browse endpoints (now a top-level tab) | medium |

None of these conflict with the multi-vendor question, because **every screen in this set
shows a single item from a single vendor**. The multi-item quotation belongs to the managed
path, which these screens are not.

## 7. Still open after this set

1. **Multi-vendor orders** — unchanged; this set does not address it, but also does not
   block customer work, since the self-serve path is single-item.
2. **Service fee** — flat, percentage, or per booking?
3. **Courier** — are couriers Eskista staff, a `Vendor` of category Logistics, or a separate
   entity? The screen says "Eskista Courier".
4. **Withholding tax** — vendor-side, untouched here.
5. **Talent booking flow** — the tab exists but no talent screens are in this set.
