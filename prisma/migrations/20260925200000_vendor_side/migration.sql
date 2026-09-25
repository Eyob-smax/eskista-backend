-- CreateEnum
CREATE TYPE "HandoverCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_ATTENTION');

-- AlterEnum
ALTER TYPE "SupplierDocumentType" ADD VALUE 'BUSINESS_LICENSE';

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "functionalPassed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "missingItems" TEXT,
ADD COLUMN     "physicalPassed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "conditionRating" INTEGER;

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VendorHandover" (
    "bookingId" UUID NOT NULL,
    "checklist" JSONB NOT NULL,
    "condition" "HandoverCondition",
    "preparedAt" TIMESTAMP(3),
    "method" "CollectionMethod",
    "address" TEXT,
    "contactPhone" TEXT,
    "methodChosenAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "returnConfirmedAt" TIMESTAMP(3),
    "returnDisputedAt" TIMESTAMP(3),
    "returnDisputeNote" TEXT,
    "payoutConfirmedAt" TIMESTAMP(3),
    "payoutDisputedAt" TIMESTAMP(3),
    "payoutDisputeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorHandover_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "VendorHandoverPhoto" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorHandoverPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorHandoverPhoto_bookingId_idx" ON "VendorHandoverPhoto"("bookingId");

-- AddForeignKey
ALTER TABLE "VendorHandover" ADD CONSTRAINT "VendorHandover_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorHandoverPhoto" ADD CONSTRAINT "VendorHandoverPhoto_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "VendorHandover"("bookingId") ON DELETE CASCADE ON UPDATE CASCADE;

