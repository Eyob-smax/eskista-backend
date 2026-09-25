-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "TalentDayType" AS ENUM ('FULL_DAY', 'HALF_DAY', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "CvTemplate" AS ENUM ('CLASSIC', 'MINIMAL', 'SIDEBAR');

-- CreateEnum
CREATE TYPE "ReviewCheckState" AS ENUM ('NOT_STARTED', 'QUEUED', 'IN_PROGRESS', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN', 'HIRED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AgreementType" ADD VALUE 'TALENT_SERVICE';

-- AlterEnum
ALTER TYPE "SupplierDocumentType" ADD VALUE 'PASSPORT';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "autoHireFirstAccept" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentBookingId" UUID,
ADD COLUMN     "selectionDeadlineAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PortfolioItem" ADD COLUMN     "endDate" DATE,
ADD COLUMN     "role" TEXT,
ADD COLUMN     "startDate" DATE,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "TalentProfile" ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "cvTemplate" "CvTemplate" NOT NULL DEFAULT 'CLASSIC',
ADD COLUMN     "dayType" "TalentDayType",
ADD COLUMN     "identityCheck" "ReviewCheckState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "portfolioCheck" "ReviewCheckState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "profileViewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "referenceCheck" "ReviewCheckState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "skills" TEXT[],
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "specializations" TEXT[],
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "workingDays" "Weekday"[];

-- CreateTable
CREATE TABLE "TalentExperience" (
    "id" UUID NOT NULL,
    "talentProfileId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TalentExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentEducation" (
    "id" UUID NOT NULL,
    "talentProfileId" UUID NOT NULL,
    "institution" TEXT NOT NULL,
    "fieldOfStudy" TEXT,
    "qualification" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TalentEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentReference" (
    "id" UUID NOT NULL,
    "talentProfileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "relationship" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TalentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentInvitation" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "talentProfileId" UUID NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "hiredBookingId" UUID,

    CONSTRAINT "TalentInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TalentExperience_talentProfileId_sortOrder_idx" ON "TalentExperience"("talentProfileId", "sortOrder");

-- CreateIndex
CREATE INDEX "TalentEducation_talentProfileId_sortOrder_idx" ON "TalentEducation"("talentProfileId", "sortOrder");

-- CreateIndex
CREATE INDEX "TalentReference_talentProfileId_idx" ON "TalentReference"("talentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentInvitation_hiredBookingId_key" ON "TalentInvitation"("hiredBookingId");

-- CreateIndex
CREATE INDEX "TalentInvitation_talentProfileId_status_idx" ON "TalentInvitation"("talentProfileId", "status");

-- CreateIndex
CREATE INDEX "TalentInvitation_status_expiresAt_idx" ON "TalentInvitation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TalentInvitation_bookingId_talentProfileId_key" ON "TalentInvitation"("bookingId", "talentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "TalentProfile_slug_key" ON "TalentProfile"("slug");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_parentBookingId_fkey" FOREIGN KEY ("parentBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentExperience" ADD CONSTRAINT "TalentExperience_talentProfileId_fkey" FOREIGN KEY ("talentProfileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEducation" ADD CONSTRAINT "TalentEducation_talentProfileId_fkey" FOREIGN KEY ("talentProfileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentReference" ADD CONSTRAINT "TalentReference_talentProfileId_fkey" FOREIGN KEY ("talentProfileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentInvitation" ADD CONSTRAINT "TalentInvitation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentInvitation" ADD CONSTRAINT "TalentInvitation_hiredBookingId_fkey" FOREIGN KEY ("hiredBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentInvitation" ADD CONSTRAINT "TalentInvitation_talentProfileId_fkey" FOREIGN KEY ("talentProfileId") REFERENCES "TalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

