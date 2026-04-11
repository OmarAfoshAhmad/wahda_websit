-- Add missing removed_beneficiaries counter to RestoreJob
-- Safe for repeated deployments.
ALTER TABLE "RestoreJob"
  ADD COLUMN IF NOT EXISTS "removed_beneficiaries" INTEGER NOT NULL DEFAULT 0;
