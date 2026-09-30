-- CreateEnum
CREATE TYPE "AdminTier" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "AccountChannel" AS ENUM ('TELEBIRR', 'BANK');

-- CreateEnum
CREATE TYPE "FeatureTier" AS ENUM ('FEATURED', 'HIGHLIGHTED', 'SPOTLIGHT');

-- CreateEnum
CREATE TYPE "UnitCustody" AS ENUM ('VENDOR', 'HUB', 'CLIENT');

-- CreateEnum
CREATE TYPE "InspectionGrade" AS ENUM ('PRISTINE', 'EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_ATTENTION', 'DAMAGED');

-- CreateEnum
CREATE TYPE "InspectionKind" AS ENUM ('OUTGOING', 'RETURN', 'ROUTINE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IncidentPhase" ADD VALUE 'DURING_INSPECTION';
ALTER TYPE "IncidentPhase" ADD VALUE 'BEFORE_ENGAGEMENT';
ALTER TYPE "IncidentPhase" ADD VALUE 'DURING_ENGAGEMENT';
ALTER TYPE "IncidentPhase" ADD VALUE 'AFTER_ENGAGEMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IncidentType" ADD VALUE 'LATE_ARRIVAL';
ALTER TYPE "IncidentType" ADD VALUE 'OVERTIME';
ALTER TYPE "IncidentType" ADD VALUE 'NO_SHOW';
ALTER TYPE "IncidentType" ADD VALUE 'CONDUCT';
ALTER TYPE "IncidentType" ADD VALUE 'SCOPE_DISPUTE';
ALTER TYPE "IncidentType" ADD VALUE 'PAYMENT_DISPUTE';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'RESUBMISSION_REQUESTED';

-- DropIndex
DROP INDEX "Inspection_bookingId_key";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "createdByAdminId" UUID,
ADD COLUMN     "depositRefundMinor" INTEGER,
ADD COLUMN     "depositRefundReference" TEXT,
ADD COLUMN     "depositRefundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "description" TEXT,
ADD COLUMN     "skills" TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "EquipmentUnit" ADD COLUMN     "custody" "UnitCustody" NOT NULL DEFAULT 'VENDOR',
ADD COLUMN     "lastGrade" "InspectionGrade",
ADD COLUMN     "lastInspectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "amountMinor" INTEGER,
ADD COLUMN     "reporterRole" "Role" NOT NULL DEFAULT 'CUSTOMER';

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "grade" "InspectionGrade",
ADD COLUMN     "inspectorName" TEXT,
ADD COLUMN     "kind" "InspectionKind" NOT NULL DEFAULT 'RETURN',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "unitId" UUID,
ALTER COLUMN "bookingId" DROP NOT NULL,
ALTER COLUMN "outcome" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "featureSortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "featureTier" "FeatureTier",
ADD COLUMN     "featuredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "collectionAccountId" UUID,
ADD COLUMN     "payerAccount" TEXT,
ADD COLUMN     "payerName" TEXT,
ADD COLUMN     "receivedAmountMinor" INTEGER,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "reviewNote" TEXT;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "adjustmentMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payoutAccountName" TEXT,
ADD COLUMN     "payoutAccountNumber" TEXT,
ADD COLUMN     "payoutChannel" "AccountChannel",
ADD COLUMN     "payoutProvider" TEXT,
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "TalentProfile" ADD COLUMN     "claimCode" TEXT,
ADD COLUMN     "claimCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "featureSortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "featureTier" "FeatureTier",
ADD COLUMN     "featuredAt" TIMESTAMP(3),
ADD COLUMN     "featuredUntil" TIMESTAMP(3),
ADD COLUMN     "registeredByAdminId" UUID,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedReason" TEXT;

-- AlterTable
ALTER TABLE "VendorHandover" ADD COLUMN     "receivedAtHubAt" TIMESTAMP(3),
ADD COLUMN     "returnedToVendorAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "AdminProfile" (
    "userId" UUID NOT NULL,
    "tier" "AdminTier" NOT NULL DEFAULT 'ADMIN',
    "title" TEXT,
    "phone" TEXT,
    "createdById" UUID,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PayoutAccount" (
    "id" UUID NOT NULL,
    "vendorId" UUID,
    "talentProfileId" UUID,
    "channel" "AccountChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAccount" (
    "id" UUID NOT NULL,
    "channel" "AccountChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "merchantId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryAssociation" (
    "categoryId" UUID NOT NULL,
    "relatedId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoryAssociation_pkey" PRIMARY KEY ("categoryId","relatedId")
);

-- CreateTable
CREATE TABLE "SettlementAdjustment" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminProfile_tier_idx" ON "AdminProfile"("tier");

-- CreateIndex
CREATE INDEX "PayoutAccount_vendorId_isPrimary_idx" ON "PayoutAccount"("vendorId", "isPrimary");

-- CreateIndex
CREATE INDEX "PayoutAccount_talentProfileId_isPrimary_idx" ON "PayoutAccount"("talentProfileId", "isPrimary");

-- CreateIndex
CREATE INDEX "CollectionAccount_isActive_sortOrder_idx" ON "CollectionAccount"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "CategoryAssociation_relatedId_idx" ON "CategoryAssociation"("relatedId");

-- CreateIndex
CREATE INDEX "SettlementAdjustment_settlementId_idx" ON "SettlementAdjustment"("settlementId");

-- CreateIndex
CREATE INDEX "Inspection_unitId_inspectedAt_idx" ON "Inspection"("unitId", "inspectedAt");

-- CreateIndex
CREATE INDEX "Inspection_kind_inspectedAt_idx" ON "Inspection"("kind", "inspectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_bookingId_kind_key" ON "Inspection"("bookingId", "kind");

-- CreateIndex
CREATE INDEX "Listing_featureTier_featureSortOrder_idx" ON "Listing"("featureTier", "featureSortOrder");

-- CreateIndex
CREATE INDEX "Payment_reference_idx" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_reference_key" ON "Settlement"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "TalentProfile_claimCode_key" ON "TalentProfile"("claimCode");

-- CreateIndex
CREATE INDEX "TalentProfile_featureTier_featureSortOrder_idx" ON "TalentProfile"("featureTier", "featureSortOrder");

-- AddForeignKey
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "VendorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_talentProfileId_fkey" FOREIGN KEY ("talentProfileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentProfile" ADD CONSTRAINT "TalentProfile_registeredByAdminId_fkey" FOREIGN KEY ("registeredByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAssociation" ADD CONSTRAINT "CategoryAssociation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAssociation" ADD CONSTRAINT "CategoryAssociation_relatedId_fkey" FOREIGN KEY ("relatedId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectionAccountId_fkey" FOREIGN KEY ("collectionAccountId") REFERENCES "CollectionAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EquipmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Backfill ────────────────────────────────────────────────────────────────

-- Every existing admin keeps full access: nobody gets locked out of the team screen.
INSERT INTO "AdminProfile" ("userId", "tier", "createdAt", "updatedAt")
SELECT rm."userId", 'SUPER_ADMIN', now(), now()
FROM "RoleMembership" rm
WHERE rm."role" = 'ADMIN'
ON CONFLICT ("userId") DO NOTHING;

-- PAY-0001… in submission order. Rows of one combined-invoice transfer share a receipt
-- and so share a reference.
WITH groups AS (
  SELECT "receiptFileKey", min("submittedAt") AS first_at
  FROM "Payment"
  GROUP BY "receiptFileKey"
), numbered AS (
  SELECT "receiptFileKey", row_number() OVER (ORDER BY first_at, "receiptFileKey") AS n
  FROM groups
)
UPDATE "Payment" p
SET "reference" = 'PAY-' || lpad(numbered.n::text, 4, '0')
FROM numbered
WHERE p."receiptFileKey" = numbered."receiptFileKey";

INSERT INTO "NumberSequence" ("id", "scope", "period", "lastValue", "updatedAt")
SELECT gen_random_uuid(), 'payment', 'all', count(DISTINCT "receiptFileKey"), now()
FROM "Payment"
HAVING count(*) > 0
ON CONFLICT ("scope", "period") DO UPDATE SET "lastValue" = EXCLUDED."lastValue";

-- STL-0001… in creation order.
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n FROM "Settlement"
)
UPDATE "Settlement" s
SET "reference" = 'STL-' || lpad(numbered.n::text, 4, '0')
FROM numbered
WHERE s."id" = numbered."id";

INSERT INTO "NumberSequence" ("id", "scope", "period", "lastValue", "updatedAt")
SELECT gen_random_uuid(), 'settlement', 'all', count(*), now()
FROM "Settlement"
HAVING count(*) > 0
ON CONFLICT ("scope", "period") DO UPDATE SET "lastValue" = EXCLUDED."lastValue";

-- Existing deductions become the signed adjustment total, so net = price + adjustment.
UPDATE "Settlement" SET "adjustmentMinor" = -"deductionMinor" WHERE "deductionMinor" <> 0;

-- Eskista's collection accounts move from the payment.accounts setting into a table.
INSERT INTO "CollectionAccount" ("id", "channel", "provider", "accountName", "accountNumber", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), 'TELEBIRR', 'Telebirr',
       "value"->'telebirr'->>'accountName', "value"->'telebirr'->>'number', 0, now()
FROM "PlatformSetting"
WHERE "key" = 'payment.accounts'
  AND "value"->'telebirr'->>'number' IS NOT NULL
  AND "value"->'telebirr'->>'accountName' IS NOT NULL;

INSERT INTO "CollectionAccount" ("id", "channel", "provider", "accountName", "accountNumber", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), 'BANK', "value"->'bank'->>'bank',
       "value"->'bank'->>'accountName', "value"->'bank'->>'accountNumber', 1, now()
FROM "PlatformSetting"
WHERE "key" = 'payment.accounts'
  AND "value"->'bank'->>'bank' IS NOT NULL
  AND "value"->'bank'->>'accountName' IS NOT NULL
  AND "value"->'bank'->>'accountNumber' IS NOT NULL;

-- Featured listings keep their place on the rail.
UPDATE "Listing" SET "featureTier" = 'FEATURED', "featuredAt" = "updatedAt" WHERE "isFeatured" = true;

-- Existing inspections are return inspections; give them a grade on the new scale and
-- the booking's unit when it had exactly one.
UPDATE "Inspection" SET "grade" = CASE
  WHEN "outcome" = 'DAMAGED' THEN 'DAMAGED'::"InspectionGrade"
  WHEN "condition" IN ('NEW', 'LIKE_NEW') THEN 'PRISTINE'::"InspectionGrade"
  WHEN "condition" = 'EXCELLENT' THEN 'EXCELLENT'::"InspectionGrade"
  WHEN "condition" = 'GOOD' THEN 'GOOD'::"InspectionGrade"
  WHEN "condition" = 'FAIR' THEN 'FAIR'::"InspectionGrade"
  WHEN "outcome" = 'OK' THEN 'GOOD'::"InspectionGrade"
  ELSE 'NEEDS_ATTENTION'::"InspectionGrade"
END,
"notes" = "damageNotes";

UPDATE "Inspection" i
SET "unitId" = bu."unitId"
FROM (
  SELECT "bookingId", min("unitId"::text)::uuid AS "unitId"
  FROM "BookingUnit" GROUP BY "bookingId" HAVING count(*) = 1
) bu
WHERE i."bookingId" = bu."bookingId" AND i."unitId" IS NULL;

-- Where each unit is now, from its live booking.
UPDATE "EquipmentUnit" u SET "custody" = 'CLIENT'
FROM "BookingUnit" bu JOIN "Booking" b ON b."id" = bu."bookingId"
WHERE bu."unitId" = u."id"
  AND b."status" IN ('IN_PROGRESS', 'RENTAL_COMPLETED', 'RETURN_SCHEDULED');

UPDATE "EquipmentUnit" u SET "custody" = 'HUB'
FROM "BookingUnit" bu JOIN "Booking" b ON b."id" = bu."bookingId"
WHERE bu."unitId" = u."id"
  AND b."status" IN ('DELIVERY_PICKUP', 'RETURN_RECEIVED', 'INSPECTION');

UPDATE "EquipmentUnit" u
SET "lastInspectedAt" = i."inspectedAt", "lastGrade" = i."grade"
FROM (
  SELECT DISTINCT ON ("unitId") "unitId", "inspectedAt", "grade"
  FROM "Inspection" WHERE "unitId" IS NOT NULL
  ORDER BY "unitId", "inspectedAt" DESC
) i
WHERE u."id" = i."unitId";
