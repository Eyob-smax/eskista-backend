-- CreateEnum
CREATE TYPE "CustomerKind" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('COMMERCIAL_PRODUCTION', 'WEDDING', 'EVENT', 'MUSIC_VIDEO', 'DOCUMENTARY', 'CORPORATE_CONTENT', 'SOCIAL_MEDIA_CONTENT', 'PHOTOGRAPHY_SESSION', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'HOURLY', 'CONTRACT', 'PROJECT_BASED');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "BudgetBand" AS ENUM ('UNDER_5K', 'FROM_5K_TO_10K', 'FROM_10K_TO_25K', 'FROM_25K_TO_50K', 'OVER_50K');

-- CreateEnum
CREATE TYPE "ProposerRole" AS ENUM ('TALENT', 'CUSTOMER', 'ESKISTA');

-- CreateEnum
CREATE TYPE "PriceProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('PHYSICAL_DAMAGE', 'MISSING_ACCESSORY', 'TECHNICAL_MALFUNCTION', 'DELIVERY_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentPhase" AS ENUM ('DURING_DELIVERY_PICKUP', 'DURING_RENTAL', 'DURING_RETURN');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DeliveryStage" AS ENUM ('PREPARED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "BookingAttachmentKind" AS ENUM ('REFERENCE', 'BRIEF', 'OTHER');

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'DRAFT';

-- AlterEnum
ALTER TYPE "ReviewKind" ADD VALUE 'CUSTOMER';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "projectType" "ProjectType",
ADD COLUMN     "serviceFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceFeeRateBps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Fulfilment" ADD COLUMN     "etaAt" TIMESTAMP(3),
ADD COLUMN     "stage" "DeliveryStage" NOT NULL DEFAULT 'PREPARED',
ADD COLUMN     "vehicleDescription" TEXT,
ADD COLUMN     "vehiclePlate" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "customerProfileId" UUID;

-- AlterTable
ALTER TABLE "TalentBookingDetail" ADD COLUMN     "budgetBand" "BudgetBand",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "locationNotes" TEXT,
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "venue" TEXT,
ADD COLUMN     "workMode" "WorkMode" NOT NULL DEFAULT 'ON_SITE';

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organisationName" TEXT,
    "kind" "CustomerKind" NOT NULL DEFAULT 'INDIVIDUAL',
    "contactPerson" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "additionalPhone" TEXT,
    "city" TEXT,
    "address" TEXT,
    "idDocumentKey" TEXT,
    "idDocumentName" TEXT,
    "idDocumentMimeType" TEXT,
    "idDocumentSizeBytes" INTEGER,
    "idDocumentUploadedAt" TIMESTAMP(3),
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "verifiedAt" TIMESTAMP(3),
    "verifiedByAdminId" UUID,
    "rejectionReason" TEXT,
    "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "completedBookings" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceProposal" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "proposedByRole" "ProposerRole" NOT NULL,
    "proposedById" UUID,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "message" TEXT,
    "status" "PriceProposalStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "respondedById" UUID,
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAttachment" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "kind" "BookingAttachmentKind" NOT NULL DEFAULT 'REFERENCE',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "bookingId" UUID NOT NULL,
    "reportedById" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "phase" "IncidentPhase" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentPhoto" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "fileKey" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_userId_key" ON "CustomerProfile"("userId");

-- CreateIndex
CREATE INDEX "CustomerProfile_verificationStatus_idx" ON "CustomerProfile"("verificationStatus");

-- CreateIndex
CREATE INDEX "CustomerProfile_city_idx" ON "CustomerProfile"("city");

-- CreateIndex
CREATE INDEX "PriceProposal_bookingId_status_createdAt_idx" ON "PriceProposal"("bookingId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BookingAttachment_bookingId_kind_idx" ON "BookingAttachment"("bookingId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_reference_key" ON "Incident"("reference");

-- CreateIndex
CREATE INDEX "Incident_bookingId_status_idx" ON "Incident"("bookingId", "status");

-- CreateIndex
CREATE INDEX "Incident_status_createdAt_idx" ON "Incident"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentPhoto_incidentId_sortOrder_idx" ON "IncidentPhoto"("incidentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Review_customerProfileId_isPublished_idx" ON "Review"("customerProfileId", "isPublished");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_verifiedByAdminId_fkey" FOREIGN KEY ("verifiedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceProposal" ADD CONSTRAINT "PriceProposal_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceProposal" ADD CONSTRAINT "PriceProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceProposal" ADD CONSTRAINT "PriceProposal_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAttachment" ADD CONSTRAINT "BookingAttachment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAttachment" ADD CONSTRAINT "BookingAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPhoto" ADD CONSTRAINT "IncidentPhoto_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
