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

## ⚠ Open questions

1. **Messaging contradicts the equipment designs.** The talent flow says the customer can
   "message the talent directly through Eskista", but the vendor booking screens state
   *"Eskista manages all communication with the customer. For questions or changes, contact
   Eskista Support."* Modelled as `Conversation.isAdminMediated` so the two regimes can
   coexist — talent threads direct, equipment threads admin-only. **Confirm that's intended**,
   because it means equipment vendors still cannot contact customers.
2. **Does an individual vendor need a business registration?** "Vendor (can be individual or
   company). Only business registration and Fayda Id will be required" reads as though both
   are always mandatory, which an individual freelancer may not have. Current assumption:
   Fayda ID always required; business registration required only when `kind = COMPANY`.
3. **Who signs the "rental agreement" the client lists under vendor requirements?** It is
   currently a `SupplierDocument` the vendor uploads at onboarding — distinct from the
   per-booking `Agreement` the *customer* signs. Confirm these are two different documents.
4. **Talent verification requirements** were not specified. Currently reuses
   `SupplierDocument` with Fayda ID; no portfolio verification.
5. **Tax/VAT.** `taxMinor` exists on `Booking` and `Invoice` but no rate was given. Ethiopian
   VAT is 15% — confirm whether it applies and whether prices are inclusive or exclusive.
   This changes every displayed total.
6. **Deposit handling.** Is the security deposit collected up front with the rental payment,
   or authorised separately? Currently modelled as a line on the same invoice.
