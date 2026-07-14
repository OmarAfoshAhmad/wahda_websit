-- Add manager role to Facility
-- is_manager: identifies manager accounts (distinct from is_admin = super admin)
-- manager_permissions: JSON object controlling which actions the manager can perform

ALTER TABLE "Facility" ADD COLUMN "is_manager" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Facility" ADD COLUMN "manager_permissions" JSONB;

CREATE INDEX "Facility_is_manager_idx" ON "Facility"("is_manager") WHERE "is_manager" = true;
