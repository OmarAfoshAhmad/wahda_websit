-- Add missing admin counters for RestoreJob to match schema.prisma
-- Safe for repeated deployments.
ALTER TABLE "RestoreJob"
  ADD COLUMN IF NOT EXISTS "added_admins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "updated_admins" INTEGER NOT NULL DEFAULT 0;
