-- Combined invoices: an invoice now belongs to a customer and has one line per booking.
-- Existing invoices (one booking each) become one-line invoices; nothing is dropped
-- before it has been copied.

-- 1. New columns, nullable until backfilled.
ALTER TABLE "Invoice"
  ADD COLUMN "combined" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customerId" UUID,
  ADD COLUMN "serviceFeeMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Payment" ADD COLUMN "declaredTotalMinor" INTEGER;

ALTER TABLE "Settlement"
  ADD COLUMN "payeeConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "payeeDisputeNote" TEXT,
  ADD COLUMN "payeeDisputedAt" TIMESTAMP(3);

CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "serviceFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "securityDepositMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- 2. Backfill: the customer from the booking, and the booking as the invoice's only line.
UPDATE "Invoice" i
SET "customerId" = b."customerId",
    "serviceFeeMinor" = b."serviceFeeMinor"
FROM "Booking" b
WHERE b."id" = i."bookingId";

INSERT INTO "InvoiceLine" (
  "id", "invoiceId", "bookingId", "description", "subtotalMinor", "deliveryFeeMinor",
  "serviceFeeMinor", "discountMinor", "taxMinor", "securityDepositMinor", "totalMinor", "sortOrder"
)
SELECT gen_random_uuid(), i."id", i."bookingId", 'Booking ' || b."reference",
       i."subtotalMinor", i."deliveryFeeMinor", b."serviceFeeMinor", i."discountMinor",
       i."taxMinor", i."securityDepositMinor", i."totalMinor", 0
FROM "Invoice" i
JOIN "Booking" b ON b."id" = i."bookingId";

-- 3. Now the old one-booking link can go, and the customer becomes required.
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_bookingId_fkey";
DROP INDEX "Invoice_bookingId_key";
ALTER TABLE "Invoice" DROP COLUMN "bookingId";
ALTER TABLE "Invoice" ALTER COLUMN "customerId" SET NOT NULL;

-- 4. Indexes and keys.
CREATE INDEX "InvoiceLine_invoiceId_sortOrder_idx" ON "InvoiceLine"("invoiceId", "sortOrder");
CREATE INDEX "InvoiceLine_bookingId_idx" ON "InvoiceLine"("bookingId");
CREATE INDEX "Invoice_customerId_status_idx" ON "Invoice"("customerId", "status");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
