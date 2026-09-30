-- Pharmacy is a first-class service while continuing to use TransactionType.MEDICINE.
CREATE TYPE "MedicineCategory" AS ENUM ('ROUTINE', 'CHRONIC', 'CHEMICAL');
CREATE TYPE "PharmacyDispenseStatus" AS ENUM ('COMPLETED', 'CANCELLED');

CREATE TABLE "PharmacyPolicyConfig" (
    "id" TEXT NOT NULL,
    "service_policy_id" TEXT NOT NULL,
    "routine_enabled" BOOLEAN NOT NULL DEFAULT true,
    "chronic_enabled" BOOLEAN NOT NULL DEFAULT true,
    "chemical_enabled" BOOLEAN NOT NULL DEFAULT false,
    "chemical_attachment_required" BOOLEAN NOT NULL DEFAULT true,
    "max_attachments" INTEGER NOT NULL DEFAULT 2,
    "sequence_pricing_rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PharmacyPolicyConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DrugCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DrugCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BeneficiaryChronicDrug" (
    "id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "drug_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BeneficiaryChronicDrug_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PharmacyDispense" (
    "id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "medicine_category" "MedicineCategory" NOT NULL,
    "item_count" INTEGER NOT NULL,
    "gross_total" DECIMAL(12,2) NOT NULL,
    "company_total" DECIMAL(12,2) NOT NULL,
    "patient_total" DECIMAL(12,2) NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "PharmacyDispenseStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    CONSTRAINT "PharmacyDispense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PharmacyDispenseItem" (
    "id" TEXT NOT NULL,
    "dispense_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "drug_id" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "coverage_percent" DECIMAL(5,2) NOT NULL,
    "company_share" DECIMAL(12,2) NOT NULL,
    "patient_share" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PharmacyDispenseItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PharmacyDispenseAttachment" (
    "id" TEXT NOT NULL,
    "dispense_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PharmacyDispenseAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PharmacyPolicyConfig_service_policy_id_key" ON "PharmacyPolicyConfig"("service_policy_id");
CREATE INDEX "PharmacyPolicyConfig_service_policy_id_idx" ON "PharmacyPolicyConfig"("service_policy_id");
CREATE UNIQUE INDEX "DrugCatalog_normalized_name_key" ON "DrugCatalog"("normalized_name");
CREATE INDEX "DrugCatalog_active_name_idx" ON "DrugCatalog"("active", "name");
CREATE UNIQUE INDEX "BeneficiaryChronicDrug_beneficiary_id_drug_id_key" ON "BeneficiaryChronicDrug"("beneficiary_id", "drug_id");
CREATE INDEX "BeneficiaryChronicDrug_beneficiary_id_active_sort_order_idx" ON "BeneficiaryChronicDrug"("beneficiary_id", "active", "sort_order");
CREATE UNIQUE INDEX "PharmacyDispense_transaction_id_key" ON "PharmacyDispense"("transaction_id");
CREATE UNIQUE INDEX "PharmacyDispense_idempotency_key_key" ON "PharmacyDispense"("idempotency_key");
CREATE INDEX "PharmacyDispense_beneficiary_id_created_at_idx" ON "PharmacyDispense"("beneficiary_id", "created_at");
CREATE INDEX "PharmacyDispense_company_id_created_at_idx" ON "PharmacyDispense"("company_id", "created_at");
CREATE INDEX "PharmacyDispense_facility_id_created_at_idx" ON "PharmacyDispense"("facility_id", "created_at");
CREATE INDEX "PharmacyDispense_status_created_at_idx" ON "PharmacyDispense"("status", "created_at");
CREATE UNIQUE INDEX "PharmacyDispenseItem_dispense_id_sequence_key" ON "PharmacyDispenseItem"("dispense_id", "sequence");
CREATE INDEX "PharmacyDispenseItem_drug_id_idx" ON "PharmacyDispenseItem"("drug_id");
CREATE INDEX "PharmacyDispenseAttachment_dispense_id_idx" ON "PharmacyDispenseAttachment"("dispense_id");

ALTER TABLE "PharmacyPolicyConfig" ADD CONSTRAINT "PharmacyPolicyConfig_service_policy_id_fkey" FOREIGN KEY ("service_policy_id") REFERENCES "ServicePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeneficiaryChronicDrug" ADD CONSTRAINT "BeneficiaryChronicDrug_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "Beneficiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeneficiaryChronicDrug" ADD CONSTRAINT "BeneficiaryChronicDrug_drug_id_fkey" FOREIGN KEY ("drug_id") REFERENCES "DrugCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispense" ADD CONSTRAINT "PharmacyDispense_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispense" ADD CONSTRAINT "PharmacyDispense_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispense" ADD CONSTRAINT "PharmacyDispense_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispense" ADD CONSTRAINT "PharmacyDispense_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispenseItem" ADD CONSTRAINT "PharmacyDispenseItem_dispense_id_fkey" FOREIGN KEY ("dispense_id") REFERENCES "PharmacyDispense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispenseItem" ADD CONSTRAINT "PharmacyDispenseItem_drug_id_fkey" FOREIGN KEY ("drug_id") REFERENCES "DrugCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispenseAttachment" ADD CONSTRAINT "PharmacyDispenseAttachment_dispense_id_fkey" FOREIGN KEY ("dispense_id") REFERENCES "PharmacyDispense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispenseAttachment" ADD CONSTRAINT "PharmacyDispenseAttachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the existing MEDICINE identity but present it as the shared pharmacy service.
INSERT INTO "ServiceType" ("id", "code", "name", "is_active", "created_at", "updated_at")
VALUES ('svc_medicine_wahda', 'MEDICINE', 'خدمات الصيدلية', true, NOW(), NOW())
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "is_active" = true, "updated_at" = NOW();

-- Every current active company appears on the pharmacy landing page.
-- Existing medicine policies are preserved; missing ones inherit the legacy company values.
INSERT INTO "ServicePolicy" (
  "id", "company_id", "service_type_id", "ceiling_amount", "coverage_percent",
  "frequency_months", "is_active", "created_at", "updated_at"
)
SELECT
  'policy_medicine_' || company."id",
  company."id",
  service_type."id",
  company."medicine_ceiling",
  company."medicine_coverage",
  12,
  true,
  NOW(),
  NOW()
FROM "InsuranceCompany" company
CROSS JOIN "ServiceType" service_type
WHERE service_type."code" = 'MEDICINE'
  AND company."deleted_at" IS NULL
  AND company."is_active" = true
ON CONFLICT ("company_id", "service_type_id") DO NOTHING;

-- Add the detailed pharmacy categories to both new and pre-existing medicine policies.
INSERT INTO "PharmacyPolicyConfig" (
  "id", "service_policy_id", "routine_enabled", "chronic_enabled", "chemical_enabled",
  "chemical_attachment_required", "max_attachments", "created_at", "updated_at"
)
SELECT
  'pharmacy_config_' || policy."id",
  policy."id",
  true,
  true,
  false,
  true,
  2,
  NOW(),
  NOW()
FROM "ServicePolicy" policy
JOIN "ServiceType" service_type ON service_type."id" = policy."service_type_id"
WHERE service_type."code" = 'MEDICINE'
ON CONFLICT ("service_policy_id") DO NOTHING;
