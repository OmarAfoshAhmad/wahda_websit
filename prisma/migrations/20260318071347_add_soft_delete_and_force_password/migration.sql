-- AlterTable
ALTER TABLE "Beneficiary" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Beneficiary_deleted_at_idx" ON "Beneficiary"("deleted_at");

-- CreateIndex
CREATE INDEX "Facility_deleted_at_idx" ON "Facility"("deleted_at");
