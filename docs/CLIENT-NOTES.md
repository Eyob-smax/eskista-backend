# Client review notes → implementation

Source: client comments relayed 2026-09-10. Each row records what was asked and where it
landed. Anything marked ⚠ needs a decision from you before it can be finished.

## Accepted and modelled

| Client asked for | Where it lives |
| --- | --- |
| Agreement per booking, signed by the customer | `Agreement` + versioned `AgreementTemplate`. Stores the rendered PDF key, a hash of the exact signed bytes, signer name/phone/IP and timestamp. |
| Invoice number + PDF per booking | `Invoice` (one per booking, unique `number`), numbered from `NumberSequence` inside the same transaction so numbers are gapless. |
| Two customer reviews on return | `ReviewKind.EQUIPMENT` and `ReviewKind.PLATFORM_SERVICE`, plus `TALENT` for the talent flow. `@@unique([bookingId, kind])` allows exactly one of each per booking. |
| Settlement of multiple bookings | `SettlementBatch` groups many per-booking `Settlement` rows into one payout; `Settlement.batchId` links them. |
| Additional phone number | `User.additionalPhone`, plus `Booking.additionalPhone` so it can be captured at first booking without touching the profile. |
| Vendor can be individual or company | `VendorProfile.kind` (`INDIVIDUAL` \| `COMPANY`), kept alongside the finer-grained `vendorType` the designs already used. |
| Only Fayda ID + business registration + rental agreement | `SupplierDocumentType` reduced to `FAYDA_ID`, `BUSINESS_REGISTRATION`, `RENTAL_AGREEMENT` (+ `TIN_CERTIFICATE`, `OTHER` for later). Replaces the old generic "ID" type. |
| Security deposit | `Listing.securityDepositMinor`, carried onto `Booking.securityDepositMinor`, and reconciled at `Inspection.depositReturnedMinor` / `feeMinor`. |
| B&H-style equipment spec | See below. |
| Talent marketplace | `TalentProfile`, `TalentService`, `PortfolioItem`, `TalentBlockedDateRange`, `TalentBookingDetail`, `Conversation`/`Message`. |

## B&H-style equipment structure

The client's grouping maps onto the schema as:

| Group | Fields |
| --- | --- |
| Basic Info | `name`, `categoryId`, `brand`, `model` |
| Technical Info | `mainSpecification`, `ListingSpec[]` (secondary, label/value so the UI can render a spec table), `compatibility[]`, `powerBattery` |
| Condition | `condition` (`ConditionGrade`), `conditionNotes` |
| What's Included | `ListingIncludedItem[]` with `kind: EQUIPMENT \| ACCESSORY` — the client's two separate lists |
| Rental Info | `rentalPriceMinor`, `rentalPeriodUnit`, `minRentalPeriods`/`maxRentalPeriods`, `securityDepositMinor` |
| Photos | `ListingImage[]`; the "Main Image" is the row with `isPrimary` |

Note: **condition now exists in two places on purpose.** `Listing.condition` is the
*advertised* condition shown on the listing; `EquipmentUnit.condition` is the *actual*
condition of each physical copy. They diverge as units age, and inspection updates the unit.

## Talent flow → statuses

Client flow: Browse → Filter → Evaluate → Request to Hire → Eskista Review → Confirm & Pay
→ Manage → Complete & Review.

Mapped onto the shared `BookingStatus` machine:

| Client step | Status |
| --- | --- |
| Request to Hire | `REQUEST_SUBMITTED` |
| Eskista Review (coordinates with talent) | `ESKISTA_REVIEW` + `supplierResponse` |
| Talent accepts, final price set | `TalentBookingDetail.finalPriceMinor`, `agreedAt` |
| Confirm & Pay | `AWAITING_PAYMENT` → `BOOKING_CONFIRMED` |
| Manage | `IN_PROGRESS` + `Conversation` |
| Complete & Review | `RENTAL_COMPLETED` → `SETTLEMENT` → `CLOSED` + `Review` |

Talent skips `DELIVERY_PICKUP`, `RETURN_SCHEDULED`, `RETURN_RECEIVED` and `INSPECTION` —
there is nothing to hand back.

The customer states a **budget**; the agreed figure is a separate field. Invoicing uses
`finalPriceMinor`, never `budgetMinor`.

## ✅ Resolved by the client (2026-09-11)

**1. Messaging — Eskista mediates everything, rental *and* talent.**
The talent flow's "message the talent directly" means *through* Eskista, not peer-to-peer.
`Conversation.isAdminMediated` is gone; instead each thread carries a
`party` (`CUSTOMER | VENDOR | TALENT`) and every thread is Eskista ↔ that party. A booking
therefore has up to two threads and `Conversation.bookingId` is no longer unique —
`@@unique([bookingId, party])` replaces it. There is no customer↔supplier thread anywhere
in the model, which is now a structural guarantee rather than a convention.

**2. Vendor documents depend on kind.**
`COMPANY` → Fayda ID **and** business registration. `INDIVIDUAL` → Fayda ID alone.
Enforced in `VendorService.outstandingRequirements`, and uploading a business registration
as an individual is rejected outright rather than silently stored.

**3. Two separate agreements, both with Eskista as a party.**

| | Parties | Scope | Where |
| --- | --- | --- | --- |
| Vendor agreement | Eskista ↔ Vendor | once, at onboarding | `AgreementType.VENDOR_ONBOARDING` |
| Rental agreement | Eskista ↔ Customer | per booking | `AgreementType.EQUIPMENT_RENTAL` / `TALENT_ENGAGEMENT` |

This removed `SupplierDocumentType.RENTAL_AGREEMENT` — the vendor agreement is **generated
and signed in-app**, not uploaded. `Agreement.bookingId` is now nullable and
`vendorId`/`talentProfileId` were added, with `counterpartyId` naming who must sign.

Per answer 2, the vendor agreement text **differs by vendor kind**: the company template
carries corporate-standing and signing-authority warranties an individual cannot give.
`AgreementTemplate.vendorKind` selects it, falling back to a generic template.

The agreement is issued when the vendor submits for verification — not after approval — so
they can read and sign while Eskista reviews their documents instead of waiting twice.

**4. VAT is decided per invoice.**
`PlatformSetting` holds `tax.vat_enabled` and `tax.vat_bps` (15%) as the default; each
invoice stores `taxRateBps`, `vatExempt` and `vatExemptionReason`, and `User.vatExempt`
provides a per-customer default an admin can override. `User.tinNumber` is snapshotted onto
the invoice as `billedToTin`. `Booking.taxRateBps` records the rate actually applied, so
changing the platform default can never restate an existing booking.

### Signature integrity

A signature is only worth something if you can prove what was signed. At issue time the
rendered body is frozen to storage and hashed (`contentHash`, SHA-256); signing records the
signer's name, phone and IP. Re-rendering from a later template version cannot change what
was agreed.

PDF rendering is **not yet implemented** — the frozen artefact is Markdown today. It hashes
and archives identically, so adding a PDF renderer later invalidates nothing already signed.

## ⚠ Still open

1. **Is VAT inclusive or exclusive?** Implemented as **exclusive** — 15% added on top of
   rental + delivery. If listed prices are meant to be VAT-inclusive, every total in the app
   changes and the calculation inverts.
2. **What is VAT charged on?** Currently rental + delivery, excluding the security deposit
   (a refundable holding, not consideration). Confirm the deposit is genuinely outside scope.
3. **Who sets VAT exemption?** Currently a per-customer default that an admin overrides per
   invoice. Should a customer be able to declare exemption themselves, with a TIN, or must
   Eskista set it?
4. **Does talent sign an onboarding agreement too?** `TALENT_ONBOARDING` exists in the enum
   but has no template. What does talent need to supply — Fayda ID only?
5. **Commission on talent** — the same 15% as equipment, or a different rate?
6. **Messaging scope.** Now that Eskista mediates everything: do vendors and talent get a
   messaging inbox at all, or does Eskista reach them by phone and Telegram, with threads
   existing only on the customer side?
7. **Deposit refund timing** — released at inspection, or on a later schedule?
