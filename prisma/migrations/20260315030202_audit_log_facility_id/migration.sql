-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "facility_id" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_facility_id_created_at_idx" ON "AuditLog"("facility_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
