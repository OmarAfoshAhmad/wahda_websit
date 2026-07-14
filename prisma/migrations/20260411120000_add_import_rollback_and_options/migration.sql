-- AlterEnum: add ROLLED_BACK to ImportJobStatus
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'ROLLED_BACK';

-- Add options column to ImportJob (stores import preferences like updateBalance, reactivate)
ALTER TABLE "ImportJob" ADD COLUMN IF NOT EXISTS "options" JSONB;

-- Add rollback_data column to ImportJob (stores createdIds + beforeSnapshots for undo)
ALTER TABLE "ImportJob" ADD COLUMN IF NOT EXISTS "rollback_data" JSONB;
