-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('APPROVED', 'PARTIAL', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'DENTAL';
ALTER TYPE "TransactionType" ADD VALUE 'OPTICS';
ALTER TYPE "TransactionType" ADD VALUE 'GENERAL';

-- DropIndex
DROP INDEX "Beneficiary_completed_via_idx";

-- DropIndex
DROP INDEX "Beneficiary_is_legacy_card_idx";

-- DropIndex
DROP INDEX "idx_beneficiary_deleted_status_completed";

-- DropIndex
DROP INDEX "idx_family_import_archive_last_imported_at";

-- DropIndex
DROP INDEX "Transaction_facility_id_created_at_idx";

-- DropIndex
DROP INDEX "Transaction_original_transaction_id_idx";

-- DropIndex
DROP INDEX "idx_transaction_type_cancelled_beneficiary";

-- AlterTable
ALTER TABLE "Beneficiary" ADD COLUMN     "birth_date_synced_from_truth" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "company_id" TEXT,
ADD COLUMN     "custom_ceilings" JSONB,
ADD COLUMN     "phone_number" TEXT;

-- AlterTable
ALTER TABLE "CardIssuanceRegistry" ADD COLUMN     "phone_number" TEXT;

-- AlterTable
ALTER TABLE "CardIssuanceRegistryAll" ADD COLUMN     "phone_number" TEXT,
ALTER COLUMN "batch_number" SET NOT NULL;

-- AlterTable
ALTER TABLE "CardNumberingArchive" ADD COLUMN     "phone_number" TEXT;

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "facility_type" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'FACILITY';

-- AlterTable
ALTER TABLE "FamilyImportArchive" ALTER COLUMN "family_count_from_file" DROP NOT NULL,
ALTER COLUMN "family_count_from_file" DROP DEFAULT,
ALTER COLUMN "total_balance_from_file" DROP NOT NULL,
ALTER COLUMN "total_balance_from_file" DROP DEFAULT,
ALTER COLUMN "used_balance_from_file" DROP NOT NULL,
ALTER COLUMN "used_balance_from_file" DROP DEFAULT,
ALTER COLUMN "imported_by" SET NOT NULL,
ALTER COLUMN "last_imported_at" DROP DEFAULT,
ALTER COLUMN "last_imported_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "actual_company_share" DECIMAL(12,2),
ADD COLUMN     "actual_patient_share" DECIMAL(12,2),
ADD COLUMN     "calc_metadata" JSONB,
ADD COLUMN     "ceiling_consumed" DECIMAL(12,2),
ADD COLUMN     "company_id" TEXT,
ADD COLUMN     "consumed_after" DECIMAL(12,2),
ADD COLUMN     "consumed_before" DECIMAL(12,2),
ADD COLUMN     "original_company_share" DECIMAL(12,2),
ADD COLUMN     "original_patient_share" DECIMAL(12,2),
ADD COLUMN     "policy_snapshot" JSONB,
ADD COLUMN     "remaining_ceiling_after" DECIMAL(12,2),
ADD COLUMN     "remaining_ceiling_before" DECIMAL(12,2),
ADD COLUMN     "service_category" TEXT,
ADD COLUMN     "service_type_id" TEXT;

-- CreateTable
CREATE TABLE "InsuranceCompany" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "logo" TEXT,
    "card_pattern" TEXT,
    "service_type_mappings" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "service_aliases" JSONB,
    "dental_ceiling" DECIMAL(12,2),
    "dental_coverage" DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    "general_ceiling" DECIMAL(12,2),
    "general_coverage" DECIMAL(5,2) NOT NULL DEFAULT 80.00,
    "medicine_ceiling" DECIMAL(12,2),
    "medicine_coverage" DECIMAL(5,2) NOT NULL DEFAULT 80.00,
    "dental_settings" JSONB,

    CONSTRAINT "InsuranceCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePolicy" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "service_type_id" TEXT NOT NULL,
    "ceiling_amount" DECIMAL(12,2),
    "coverage_percent" DECIMAL(5,2) NOT NULL,
    "frequency_months" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletConsumption" (
    "id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "wallet_type" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "consumed_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTypeMapping" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "mapped_to" TEXT NOT NULL,

    CONSTRAINT "ServiceTypeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "company_id" TEXT,
    "service_type" TEXT NOT NULL,
    "wallet_type" TEXT NOT NULL,
    "requested_amount" DECIMAL(12,2) NOT NULL,
    "approved_amount" DECIMAL(12,2) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'APPROVED',
    "transaction_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimAuditLog" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "wallet_type" TEXT,
    "limit_annual" DECIMAL(12,2),
    "consumed_before" DECIMAL(12,2),
    "consumed_after" DECIMAL(12,2),
    "requested" DECIMAL(12,2),
    "approved" DECIMAL(12,2),
    "remaining" DECIMAL(12,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceCompany_code_key" ON "InsuranceCompany"("code");

-- CreateIndex
CREATE INDEX "InsuranceCompany_code_idx" ON "InsuranceCompany"("code");

-- CreateIndex
CREATE INDEX "OtpCode_phone_number_code_idx" ON "OtpCode"("phone_number", "code");

-- CreateIndex
CREATE INDEX "OtpCode_expires_at_idx" ON "OtpCode"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_code_key" ON "ServiceType"("code");

-- CreateIndex
CREATE INDEX "ServiceType_code_idx" ON "ServiceType"("code");

-- CreateIndex
CREATE INDEX "ServicePolicy_company_id_idx" ON "ServicePolicy"("company_id");

-- CreateIndex
CREATE INDEX "ServicePolicy_service_type_id_idx" ON "ServicePolicy"("service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePolicy_company_id_service_type_id_key" ON "ServicePolicy"("company_id", "service_type_id");

-- CreateIndex
CREATE INDEX "WalletConsumption_beneficiary_id_company_id_idx" ON "WalletConsumption"("beneficiary_id", "company_id");

-- CreateIndex
CREATE INDEX "WalletConsumption_company_id_wallet_type_idx" ON "WalletConsumption"("company_id", "wallet_type");

-- CreateIndex
CREATE UNIQUE INDEX "WalletConsumption_beneficiary_id_company_id_wallet_type_fis_key" ON "WalletConsumption"("beneficiary_id", "company_id", "wallet_type", "fiscal_year");

-- CreateIndex
CREATE INDEX "ServiceTypeMapping_company_id_idx" ON "ServiceTypeMapping"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTypeMapping_company_id_service_type_key" ON "ServiceTypeMapping"("company_id", "service_type");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_transaction_id_key" ON "Claim"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_idempotency_key_key" ON "Claim"("idempotency_key");

-- CreateIndex
CREATE INDEX "Claim_beneficiary_id_idx" ON "Claim"("beneficiary_id");

-- CreateIndex
CREATE INDEX "Claim_company_id_idx" ON "Claim"("company_id");

-- CreateIndex
CREATE INDEX "Claim_created_at_idx" ON "Claim"("created_at");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "ClaimAuditLog_claim_id_idx" ON "ClaimAuditLog"("claim_id");

-- CreateIndex
CREATE INDEX "ClaimAuditLog_created_at_idx" ON "ClaimAuditLog"("created_at");

-- CreateIndex
CREATE INDEX "Beneficiary_company_id_idx" ON "Beneficiary"("company_id");

-- CreateIndex
CREATE INDEX "Facility_role_idx" ON "Facility"("role");

-- CreateIndex
CREATE INDEX "Transaction_company_id_idx" ON "Transaction"("company_id");

-- CreateIndex
CREATE INDEX "Transaction_is_cancelled_type_idx" ON "Transaction"("is_cancelled", "type");

-- CreateIndex
CREATE INDEX "Transaction_service_category_created_at_idx" ON "Transaction"("service_category", "created_at");

-- CreateIndex
CREATE INDEX "Transaction_service_type_id_idx" ON "Transaction"("service_type_id");

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePolicy" ADD CONSTRAINT "ServicePolicy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePolicy" ADD CONSTRAINT "ServicePolicy_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConsumption" ADD CONSTRAINT "WalletConsumption_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConsumption" ADD CONSTRAINT "WalletConsumption_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTypeMapping" ADD CONSTRAINT "ServiceTypeMapping_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

