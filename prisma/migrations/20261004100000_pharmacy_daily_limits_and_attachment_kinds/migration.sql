ALTER TABLE "PharmacyPolicyConfig" ADD COLUMN "routine_daily_limit" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "PharmacyPolicyConfig" ADD COLUMN "chemical_daily_limit" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "PharmacyPolicyConfig" ADD COLUMN "chronic_interval_days" INTEGER NOT NULL DEFAULT 28;
ALTER TABLE "PharmacyPolicyConfig" ADD COLUMN "policy_year_start_month" INTEGER NOT NULL DEFAULT 1;

CREATE TYPE "PharmacyAttachmentKind" AS ENUM ('INSURANCE_CARD', 'PRESCRIPTION');
ALTER TABLE "PharmacyDispenseAttachment" ADD COLUMN "kind" "PharmacyAttachmentKind";

DROP INDEX "PharmacyPrescription_beneficiary_id_medicine_category_prescription_number_status_key";
CREATE UNIQUE INDEX "PharmacyPrescription_beneficiary_id_medicine_category_prescription_number_key" ON "PharmacyPrescription"("beneficiary_id", "medicine_category", "prescription_number");
