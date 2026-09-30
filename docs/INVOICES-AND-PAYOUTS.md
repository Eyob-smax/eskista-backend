# Invoices and payouts

## Invoices

Every priced booking has an invoice, issued the first time it is needed (the payment
screen, the PDF). An invoice has one **line** per booking; a **combined** invoice has
several, from any mix of vendors and talents, so one transfer pays them all.

### Pay together (customer)

| Step | Endpoint |
|---|---|
| Pick bookings | `GET /customer/invoices/payable` — awaiting payment, no payment yet, not already combined |
| Combine | `POST /customer/invoices` `{ bookingReferences: [...] }` (2–20) — their single invoices are voided and replaced |
| Review | `GET /customer/invoices/:number` — lines, totals, `canPay` / `blockers` per booking |
| How to pay | `GET /customer/invoices/:number/payment-instructions` — use the invoice number as the reference |
| Pay | `POST /customer/invoices/:number/payments` (multipart `receipt`, `method`, `transactionReference`, `amountMinor`) |
| PDF | `GET /customer/invoices/:number/pdf` |
| Undo | `DELETE /customer/invoices/:number` — only before any payment |
| History | `GET /customer/invoices` |

Paying records **one payment per booking**, all sharing the receipt and transaction
reference, with the declared amount split by what each booking owes (the parts always add
up to exactly what was declared). Each booking then shows "Payment Submitted" exactly as a
single payment would, and each supplier is paid out for their own booking only. They never
see the other bookings.

A booking on a combined invoice cannot be paid on its own. The booking's payment
instructions return `combinedInvoice: true` and the invoice number.

Every booking on the invoice must be payable: agreement uploaded, nothing already being
verified. Otherwise `blockers` names each one.

Receipts are stored under the customer, not the booking, because suppliers can read their
booking's files and a receipt carries the customer's bank details and every other booking
on it.

### Admin

`GET /admin/invoices`, `POST /admin/invoices` (combine on a customer's behalf),
`GET /admin/invoices/:number`, `PATCH /admin/invoices/:number/vat` (the per-invoice VAT
exemption, before any payment), `POST /admin/invoices/:number/void`, `GET …/pdf`.

Payments are verified at `/admin/payments` (see docs/ADMIN-SIDE.md). A transfer gets one
`PAY-…` reference, shared by its per-booking rows; confirming it calls
`InvoicesService.recomputePaid`, which moves the invoice to PARTIALLY_PAID or PAID, and
confirms each booking that is now paid in full with its agreement approved.

### VAT

Prices are VAT-inclusive. An invoice shows "VAT included (15%)"; a VAT-exempt invoice takes
the VAT out of every line and shows "VAT exempt" with the reason. Supplier earnings and
commission never change. The customer's `vatExempt` flag sets the default; an admin can
change it per invoice.

Eskista's details at the top of the PDF come from the `company.details` setting
(`legalName`, `tin`, `vatNumber`, `address`, `phone`, `email`).

## Payouts (settlements)

Each booking's supplier, vendor or talent, is owed their listed price in full; commission
and VAT are on the customer's side.

- **Talent:** the customer's **Complete Service** creates the settlement (PENDING, expected
  after `payout.delay_days`, default 7).
- **Vendor:** created when Eskista moves the rental to Settlement after the return
  inspection. Damage withheld from the customer's deposit is added as an adjustment.
- Eskista pays it at `/admin/settlements/:STL-ref/pay`, which copies the payee's primary
  payout account onto the settlement. The payee then **Confirm Payment** and **Complete**,
  or the booking closes itself 24 hours after the confirmation.

| Talent screen | Endpoint |
|---|---|
| Engagement detail | `payout` and `documents` (Settlement Record) on `GET /talent/bookings/:ref` |
| Confirm Payment | `POST /talent/bookings/:ref/payout/confirm` `{ confirmed, note? }` |
| Complete | `POST /talent/bookings/:ref/complete` |
| Settlement Record | `GET /talent/bookings/:ref/settlement-record.pdf` |

Vendors have the same three on `/vendor/bookings/:ref/…`. Both close through one shared
`SettlementsService`, so vendor and talent bookings close, and ask the customer for a
review, the same way.
