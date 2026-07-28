-- Phase 1: additive multi-company account scope only.
-- No backfill, destructive alteration, or NOT NULL enforcement is performed here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountRole') THEN
    CREATE TYPE "AccountRole" AS ENUM (
      'SUPER_ADMIN',
      'COMPANY_ADMIN',
      'MANAGER',
      'EMPLOYEE',
      'FACILITY'
    );
  END IF;
END $$;

ALTER TABLE "Facility"
  ADD COLUMN IF NOT EXISTS "role_v2" "AccountRole",
  ADD COLUMN IF NOT EXISTS "parent_manager_id" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "company_id" TEXT;

ALTER TABLE "ImportJob"
  ADD COLUMN IF NOT EXISTS "company_id" TEXT;

ALTER TABLE "RestoreJob"
  ADD COLUMN IF NOT EXISTS "company_id" TEXT;

CREATE TABLE IF NOT EXISTS "AccountCompanyAccess" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "created_by_id" TEXT,
  "permissions" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountCompanyAccess_pkey" PRIMARY KEY ("id")
);

-- Service scope is independent from company scope. Effective access is their intersection.
CREATE TABLE IF NOT EXISTS "AccountServiceAccess" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "service_type_id" TEXT NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountServiceAccess_pkey" PRIMARY KEY ("id")
);

-- A facility can provide multiple services (for example a hospital with dental and optics).
CREATE TABLE IF NOT EXISTS "FacilityServiceCapability" (
  "id" TEXT NOT NULL,
  "facility_id" TEXT NOT NULL,
  "service_type_id" TEXT NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacilityServiceCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountCompanyAccess_account_id_company_id_key"
  ON "AccountCompanyAccess"("account_id", "company_id");
CREATE INDEX IF NOT EXISTS "AccountCompanyAccess_company_id_account_id_idx"
  ON "AccountCompanyAccess"("company_id", "account_id");
CREATE INDEX IF NOT EXISTS "AccountCompanyAccess_created_by_id_idx"
  ON "AccountCompanyAccess"("created_by_id");
CREATE UNIQUE INDEX IF NOT EXISTS "AccountServiceAccess_account_id_service_type_id_key"
  ON "AccountServiceAccess"("account_id", "service_type_id");
CREATE INDEX IF NOT EXISTS "AccountServiceAccess_service_type_id_account_id_idx"
  ON "AccountServiceAccess"("service_type_id", "account_id");
CREATE INDEX IF NOT EXISTS "AccountServiceAccess_created_by_id_idx"
  ON "AccountServiceAccess"("created_by_id");
CREATE UNIQUE INDEX IF NOT EXISTS "FacilityServiceCapability_facility_id_service_type_id_key"
  ON "FacilityServiceCapability"("facility_id", "service_type_id");
CREATE INDEX IF NOT EXISTS "FacilityServiceCapability_service_type_id_facility_id_idx"
  ON "FacilityServiceCapability"("service_type_id", "facility_id");
CREATE INDEX IF NOT EXISTS "FacilityServiceCapability_created_by_id_idx"
  ON "FacilityServiceCapability"("created_by_id");
CREATE INDEX IF NOT EXISTS "Facility_role_v2_idx" ON "Facility"("role_v2");
CREATE INDEX IF NOT EXISTS "Facility_parent_manager_id_deleted_at_idx" ON "Facility"("parent_manager_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "Facility_created_by_id_idx" ON "Facility"("created_by_id");
CREATE INDEX IF NOT EXISTS "AuditLog_company_id_created_at_idx" ON "AuditLog"("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "ImportJob_company_id_created_at_idx" ON "ImportJob"("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "RestoreJob_company_id_created_at_idx" ON "RestoreJob"("company_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Facility_parent_manager_id_fkey') THEN
    ALTER TABLE "Facility" ADD CONSTRAINT "Facility_parent_manager_id_fkey"
      FOREIGN KEY ("parent_manager_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Facility_created_by_id_fkey') THEN
    ALTER TABLE "Facility" ADD CONSTRAINT "Facility_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountCompanyAccess_account_id_fkey') THEN
    ALTER TABLE "AccountCompanyAccess" ADD CONSTRAINT "AccountCompanyAccess_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountCompanyAccess_company_id_fkey') THEN
    ALTER TABLE "AccountCompanyAccess" ADD CONSTRAINT "AccountCompanyAccess_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountCompanyAccess_created_by_id_fkey') THEN
    ALTER TABLE "AccountCompanyAccess" ADD CONSTRAINT "AccountCompanyAccess_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountServiceAccess_account_id_fkey') THEN
    ALTER TABLE "AccountServiceAccess" ADD CONSTRAINT "AccountServiceAccess_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountServiceAccess_service_type_id_fkey') THEN
    ALTER TABLE "AccountServiceAccess" ADD CONSTRAINT "AccountServiceAccess_service_type_id_fkey"
      FOREIGN KEY ("service_type_id") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountServiceAccess_created_by_id_fkey') THEN
    ALTER TABLE "AccountServiceAccess" ADD CONSTRAINT "AccountServiceAccess_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FacilityServiceCapability_facility_id_fkey') THEN
    ALTER TABLE "FacilityServiceCapability" ADD CONSTRAINT "FacilityServiceCapability_facility_id_fkey"
      FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FacilityServiceCapability_service_type_id_fkey') THEN
    ALTER TABLE "FacilityServiceCapability" ADD CONSTRAINT "FacilityServiceCapability_service_type_id_fkey"
      FOREIGN KEY ("service_type_id") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FacilityServiceCapability_created_by_id_fkey') THEN
    ALTER TABLE "FacilityServiceCapability" ADD CONSTRAINT "FacilityServiceCapability_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_company_id_fkey') THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImportJob_company_id_fkey') THEN
    ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RestoreJob_company_id_fkey') THEN
    ALTER TABLE "RestoreJob" ADD CONSTRAINT "RestoreJob_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
