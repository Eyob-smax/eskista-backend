-- CreateEnum
CREATE TYPE "CustomerDocumentType" AS ENUM ('BUSINESS_LICENSE', 'COMMERCIAL_REGISTRATION', 'TIN_CERTIFICATE');

-- CreateEnum
CREATE TYPE "EngagementModel" AS ENUM ('PER_DAY', 'PER_PROJECT');

-- AlterEnum
BEGIN;
CREATE TYPE "AgreementStatus_new" AS ENUM ('DRAFT', 'AWAITING_UPLOAD', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DECLINED', 'VOID');
ALTER TABLE "public"."Agreement" ALTER COLUMN "status" DROP DEFAULT;
-- Map the retired signing statuses onto the scan-and-upload ones before the swap.
-- SENT meant "issued, waiting for the counterparty"; that is now AWAITING_UPLOAD.
-- SIGNED meant "in force"; under the new flow that is APPROVED.
ALTER TABLE "Agreement" ALTER COLUMN "status" TYPE TEXT USING ("status"::text);
UPDATE "Agreement" SET "status" = 'AWAITING_UPLOAD' WHERE "status" = 'SENT';
UPDATE "Agreement" SET "status" = 'APPROVED' WHERE "status" = 'SIGNED';
ALTER TABLE "Agreement" ALTER COLUMN "status" TYPE "AgreementStatus_new" USING ("status"::"AgreementStatus_new");
ALTER TYPE "AgreementStatus" RENAME TO "AgreementStatus_old";
ALTER TYPE "AgreementStatus_new" RENAME TO "AgreementStatus";
DROP TYPE "public"."AgreementStatus_old";
ALTER TABLE "Agreement" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ReviewKind_new" AS ENUM ('EQUIPMENT', 'TALENT', 'PLATFORM_SERVICE');
ALTER TABLE "Review" ALTER COLUMN "kind" TYPE "ReviewKind_new" USING ("kind"::text::"ReviewKind_new");
ALTER TYPE "ReviewKind" RENAME TO "ReviewKind_old";
ALTER TYPE "ReviewKind_new" RENAME TO "ReviewKind";
DROP TYPE "public"."ReviewKind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Agreement" DROP CONSTRAINT "Agreement_signedById_fkey";

-- DropForeignKey
ALTER TABLE "PriceProposal" DROP CONSTRAINT "PriceProposal_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "PriceProposal" DROP CONSTRAINT "PriceProposal_proposedById_fkey";

-- DropForeignKey
ALTER TABLE "PriceProposal" DROP CONSTRAINT "PriceProposal_respondedById_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_customerProfileId_fkey";

-- DropIndex
DROP INDEX "Review_customerProfileId_isPublished_idx";

-- AlterTable
ALTER TABLE "Agreement" DROP COLUMN "signatureImageKey",
DROP COLUMN "signedAt",
DROP COLUMN "signedById",
DROP COLUMN "signerIpAddress",
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID,
ADD COLUMN     "scannedCopyKey" TEXT,
ADD COLUMN     "scannedCopyMimeType" TEXT,
ADD COLUMN     "scannedCopyName" TEXT,
ADD COLUMN     "scannedCopySizeBytes" INTEGER,
ADD COLUMN     "uploadedAt" TIMESTAMP(3),
ADD COLUMN     "uploadedById" UUID;

-- AlterTable
ALTER TABLE "CustomerProfile" DROP COLUMN "idDocumentKey",
DROP COLUMN "idDocumentMimeType",
DROP COLUMN "idDocumentName",
DROP COLUMN "idDocumentSizeBytes",
DROP COLUMN "idDocumentUploadedAt",
DROP COLUMN "ratingAvg",
DROP COLUMN "ratingCount",
ADD COLUMN     "documentKey" TEXT,
ADD COLUMN     "documentMimeType" TEXT,
ADD COLUMN     "documentName" TEXT,
ADD COLUMN     "documentSizeBytes" INTEGER,
ADD COLUMN     "documentType" "CustomerDocumentType",
ADD COLUMN     "documentUploadedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PortfolioItem" ADD COLUMN     "clientOrAgency" TEXT;

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "customerProfileId";

-- AlterTable
ALTER TABLE "TalentBookingDetail" DROP COLUMN "employmentType",
DROP COLUMN "workMode",
ADD COLUMN     "engagementModel" "EngagementModel" NOT NULL DEFAULT 'PER_DAY';

-- AlterTable
ALTER TABLE "TalentProfile" DROP COLUMN "specializations",
ADD COLUMN     "highestEducation" TEXT,
ADD COLUMN     "professions" TEXT[];

-- DropTable
DROP TABLE "PriceProposal";

-- DropEnum
DROP TYPE "EmploymentType";

-- DropEnum
DROP TYPE "PriceProposalStatus";

-- DropEnum
DROP TYPE "ProposerRole";

-- DropEnum
DROP TYPE "WorkMode";

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

