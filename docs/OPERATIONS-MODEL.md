# Eskista — operations model from the FY2026/27 document set

Source documents (in `docs/`):

| File | What it is |
| --- | --- |
| `Forms_ESKISTA_Essential_Pack_FY2026-27.docx` | 14 operating forms, EF-01…EF-14 |
| `Vendor_Guide_ESKISTA_FY2026-27_Revised.docx` | Vendor program: categories, onboarding, models, settlement |
| `Rental_Agreement_ocal_Client_ESKISTA_LEnglish_FY2026-27.docx` | Local client rental agreement (English) |
| `Rental_Agreement_Amharic_ESKISTA_Local_Client_FY2026-27.docx` | Same agreement, Amharic |
| `Agreement_English_ESKISTA_International_Client_Rental_Support_FY2026.docx` | International client agreement |

Plus the project manager's stated customer journey:

> Inquiry → quotation → confirmation → preparation → delivery → return → inspection → payment → feedback

**Read this before changing the schema.** Several findings below invalidate assumptions the
current model is built on.

---

## 1. The five findings that break the current model

### 1.1 Bookings are multi-item — and can span multiple vendors

Every commercial document is a **line-item table**, not a single product:

| Document | Line-item columns |
| --- | --- |
| EF-01 Quotation | Item/Service, Description, Qty, Days/Units, Rate, Amount |
| EF-02 Rental Agreement | Asset/Item, Serial/ID, Qty, Accessories/Notes |
| EF-03 Handover | Asset, Serial/ID, Qty, Physical Condition, Functional Test, Accessories Complete |
| EF-04 Return | Asset, Serial/ID, Qty, Returned, Physical, Functional, Accessories, Action |
| EF-11 Settlement | Item, Qty/Units, **Customer Value**, **Vendor Agreed**, **Eskista Fee/Margin** |
| Annex A (all 3 agreements) | No., Description, Serial/ID, Qty, Days, Rate, Total — 8 to 13 rows |

`Booking` currently holds **one** `listingId` plus a quantity. That cannot represent a
camera + two lenses + a light kit on one order, which is the normal case.

Worse: EF-11 is titled *Vendor* Booking & Settlement Record and carries per-line
"Vendor Agreed" against "Customer Value". A single customer order can therefore draw items
from **several vendors**, each settled separately. `Booking.vendorId` as a single foreign
key is wrong, and `Settlement` keyed one-per-booking is wrong — it must be one per
(booking, vendor).

**Required:** `BookingItem[]` carrying its own vendor, listing, unit assignment, qty,
periods, customer rate and vendor rate. Settlement groups by vendor across those items.

### 1.2 Quotation is a first-class step, not a computed total

The PM journey has **quotation** as step 2, before confirmation. EF-01 makes it an entity
with its own number, a **Valid Until** date, payment terms, and a **Customer Acceptance**
signature line. Both rental agreements, clause 2, are explicit:

> A booking becomes confirmed only after Eskista confirms availability and the Client
> accepts the applicable quotation and payment terms.

The current model computes a price snapshot on the booking and moves straight to approval.
There is no quotation, no validity window, no acceptance record, and no way to revise a
quote and keep the history.

**Required:** `Quotation` + `QuotationItem`, versioned, with `validUntil`, acceptance
(who/when), and a link to the booking it converts into.

### 1.3 Payment timing — the current model is wrong, but so is a single "payment step"

This is the most important contradiction in the set, and it is **not** resolved by simply
moving payment later.

| Source | What it says about payment |
| --- | --- |
| PM journey | Payment is step 8, after inspection |
| Figma designs | Payment is step 3 of 6, before Booking Confirmed |
| EF-01 | "Booking becomes confirmed only after … fulfillment of agreed payment/deposit requirements" |
| EF-03 Handover | Checklist item: "Payment / Deposit Verified — Yes / No / N/A" |
| Annex A (all agreements) | Separate lines for **Advance Payment** and **Final Settlement** |
| International §4 | "advance before mobilization and final settlement within the agreed period after completion. Credit terms apply only if expressly approved" |
| EF-13 | A whole form for chasing **outstanding** invoices |

These only reconcile one way: **payment is not one event.** It is an advance or deposit
before handover, then a final settlement after completion — possibly on credit terms, which
is why a receivables-chasing form exists at all. The "N/A" option on the handover checklist
is the credit case.

The Figma pay-in-full-upfront flow is most likely the **self-serve marketplace** path, while
these forms describe the **managed / enterprise** path. Both are real and must coexist.

**Required:** multiple `Payment` rows per booking typed `DEPOSIT | ADVANCE | FINAL`,
invoices carrying a balance and due date, and payment terms selected per quotation
(prepaid vs credit).

### 1.4 Condition must be captured at handover, not only at return

Local agreement §4, and international §8:

> In the absence of a recorded exception at handover, the equipment shall be presumed
> received in the condition shown in the handover record.

That clause is load-bearing. Without a handover record, damage cannot be attributed to the
customer at all — the presumption runs against Eskista. EF-03 captures per-asset **Physical
Condition, Functional Test, Accessories Complete** at release, and EF-04 captures the mirror
image at return.

The current model has `Inspection` on return only.

**Required:** a condition report at both ends, per assigned unit, with photos.
EF-04 also drives unit state directly: *Final Asset Status — Available / Inspection /
Maintenance / Hold*.

### 1.5 Two taxes, not one

The open VAT question is only half the tax story. EF-11 and EF-14 both separate:

```
Gross  −  Tax / Withholding  =  Net Payable to Vendor
```

Local agreement §3 requires withholding "supported by the appropriate official evidence or
certificate". **Withholding tax on vendor payouts** is a completely different mechanism from
VAT charged to customers, and the current `Settlement` has neither it nor a certificate
reference.

---

## 2. Entities the documents require that do not exist

| Form | Entity | Why it cannot be folded into something existing |
| --- | --- | --- |
| EF-01 | `Quotation`, `QuotationItem` | Own number, validity window, acceptance signature |
| EF-03 | `Handover` / condition report (outbound) | Legally load-bearing; see §1.4 |
| EF-05 | `Incident` | Damage/loss/theft/late return with its own management-review workflow, police reference, claim action, case status |
| EF-06 | `MaintenanceRecord` | Fault → diagnosis → cost approval → parts → functional retest → return to service, plus next preventive check |
| EF-07 | `Studio`, `StudioBooking` | Hourly (start/end time), setup requirements, readiness checklist, overtime |
| EF-08 | `ProductionProject` | Bundles equipment + crew + studio + logistics + talent under one brief |
| EF-12 | `FeedbackCase` | Not a review: complaint type, root cause, corrective action, owner, due date, status |
| EF-13 | `Receivable`, `ReceivableFollowUp` | Per-contact collection log, escalation level, promise-to-pay |
| EF-14 | `PaymentRequest` | Internal outbound payment control with a Verified → Approved → Paid chain |
| EF-09 | `VendorBankAccount` | Settlement cannot pay anyone without it |

`FeedbackCase` deserves emphasis: EF-12 covers *both* praise and complaints, with root-cause
analysis and corrective action. The current `Review` (star + comment) is the public-facing
slice of it, not a replacement.

## 3. Vendor model is richer than implemented

| Dimension | Documents | Currently |
| --- | --- | --- |
| Categories | Equipment Owner, Studio, Creative Professional/Talent, Production Service Provider, Logistics, Strategic Partner | 4 `VendorType` values |
| Partnership model | On-Demand, Managed Inventory, Project-Specific/Strategic, Credit/Barter | none |
| Recognition level | Verified → Preferred → Strategic Partner | none |
| Onboarding stages | Registration → Verification → Equipment/Service Review → Commercial Alignment → Agreement → Activation | 3 states |
| Verification outcome | Pending / Verified / **Approved with Conditions** / Declined | no conditional state |
| Contact preference | Phone / WhatsApp / Telegram / Email | none |
| Bank details | required before settlement | none |

**Managed Inventory matters structurally**: equipment placed in Eskista's custody. That
changes who holds the asset and who is responsible for maintenance, so it cannot be a label.

Note also, from the guide: *"No vendor should assume a commission … unless stated in the
applicable signed commercial schedule."* Commission is therefore **per agreement**, not a
single platform default — the current `commissionRateBps` default plus per-vendor override
is close, but the authoritative value belongs on the signed commercial schedule.

## 4. Client types and agreement variants

Three client agreement templates exist, varying on two axes:

| | Local | International |
| --- | --- | --- |
| **English** | ✓ | ✓ |
| **Amharic** | ✓ | — |

The international agreement adds: **country**, project location, **multi-currency (ETB, USD,
EUR or agreed)**, bank-charge allocation, permits/visas/customs responsibility, **travel,
accommodation and per diems**, and an insurance requirement.

So `AgreementTemplate` needs `locale` and `clientType`, and there must be a **customer
profile** — none exists today. EF-01/EF-02 need Customer/Organization, Contact Person,
Address, **TIN**, and client type. Currently there is only `User`.

### Annex A is generated from the booking

All three agreements end in *Annex A — Equipment / Service & Commercial Schedule*: the
line items with serial numbers, then Subtotal, VAT/Taxes, Grand Total, Advance Payment,
Final Settlement, Delivery/Collection, Special Conditions. That is precisely the merge the
PM described — the system fills customer and product data into a preloaded template.

### Signing is by uploaded counter-signed copy

Per the PM: *"the system can just update the customer info and the product info per order so
customers can sign them and reupload their signed versions."*

Both agreements carry **two** signature blocks — Eskista and Client — each with Name,
**Title**, Signature, Date. The current model assumes a typed in-app signature by one
counterparty.

**Required:** keep the generated document, accept an **uploaded signed copy**
(`signedDocumentKey`), and record both signatories with their titles. The existing
`contentHash` still works — it proves which generated version was sent for signature.

## 5. What the documents confirm about the current model

Worth stating, because these were judgement calls that turned out right:

- **Unit-level inventory with serial numbers.** EF-02, EF-03, EF-04 and Annex A all carry a
  Serial/ID column per line.
- **Eskista mediates all communication.** The vendor guide's circumvention clause makes this
  a commercial rule, not just a UI decision.
- **Money as integers with explicit currency** — now doubly justified by multi-currency.
- **Append-only status history.** Agreement §9 lists quotation, invoice, booking messages,
  signed agreement, handover form, return form, delivery records and incident reports as the
  evidentiary record.
- **Security deposit** is real and verified at handover.
- **Late return** is a chargeable event, and already an `InspectionOutcome`.

## 6. Proposed sequencing

The first item is foundational; nothing else should be built on the current shape.

1. **Restructure booking around line items** — `BookingItem[]` with per-item vendor, and
   settlement grouped per vendor. Breaking, and it invalidates parts of the vendor API.
2. **Quotation entity** and the inquiry → quotation → acceptance → confirmation flow.
3. **Payments as a schedule** — deposit/advance/final, invoice balances, credit terms.
4. **Condition reports at handover and return**, driving unit status.
5. **Customer profiles**, client type, TIN, and the three agreement templates with real text.
6. Operational records: incidents, maintenance, feedback cases, receivables, payment requests.
7. Studios and production projects.

## 7. Questions this raises

1. **Is the self-serve Mini App flow (pay upfront) genuinely separate from the managed flow
   (quotation, advance, credit terms)?** If so they are two order types with different rules,
   and that shapes everything above.
2. **Can one customer order really span multiple vendors?** EF-11 implies yes. Confirm,
   because it drives the settlement model.
3. **Withholding tax rate and when it applies** — which vendor types, what rate, what
   certificate is required?
4. **Are studios in scope now?** EF-07 is a full form, and studios are a listed vendor
   category.
5. **Who countersigns for Eskista**, and is a countersignature required before the booking
   can proceed?
6. **Managed Inventory** — does Eskista custody change availability, maintenance duty and
   settlement? It appears to.
