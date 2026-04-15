-- Add employee role flag to Facility accounts
ALTER TABLE "Facility"
ADD COLUMN IF NOT EXISTS "is_employee" BOOLEAN NOT NULL DEFAULT false;
