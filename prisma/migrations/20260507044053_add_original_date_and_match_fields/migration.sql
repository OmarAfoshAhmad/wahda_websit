-- DropIndex
DROP INDEX "AuditLog_action_created_at_idx";

-- DropIndex
DROP INDEX "beneficiary_card_number_trgm_idx";

-- DropIndex
DROP INDEX "beneficiary_name_trgm_idx";

-- AlterTable
ALTER TABLE "CardNumberingArchive" ADD COLUMN     "match_percentage" DOUBLE PRECISION,
ADD COLUMN     "mismatch_reasons" TEXT,
ADD COLUMN     "original_city" TEXT,
ADD COLUMN     "original_date" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_action_created_at_idx" ON "AuditLog"("action", "created_at");

-- CreateIndex
CREATE INDEX "Beneficiary_name_idx" ON "Beneficiary"("name");

-- CreateIndex
CREATE INDEX "idx_facility_is_manager_fixed" ON "Facility"("is_manager");

-- CreateIndex
CREATE INDEX "Transaction_beneficiary_id_is_cancelled_type_idx" ON "Transaction"("beneficiary_id", "is_cancelled", "type");
