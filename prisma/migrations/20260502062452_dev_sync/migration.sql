-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'ADMISSIONS';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'REGISTRY';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'IT_SERVICES';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'LIBRARY';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'ASSESSMENT';
ALTER TYPE "SupportCategory" ADD VALUE IF NOT EXISTS 'COMPLIANCE';

-- DropForeignKey
ALTER TABLE "anonymous_markings" DROP CONSTRAINT "anonymous_markings_assessment_id_fkey";

-- AlterTable
ALTER TABLE "assessment_components" ADD COLUMN IF NOT EXISTS     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "charge_lines" ADD COLUMN IF NOT EXISTS     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "mark_entries" ADD COLUMN IF NOT EXISTS     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS     "deleted_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "anonymous_markings" ADD CONSTRAINT "anonymous_markings_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
