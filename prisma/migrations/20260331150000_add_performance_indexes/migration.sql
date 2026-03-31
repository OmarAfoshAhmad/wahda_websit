-- CreateIndex
CREATE INDEX IF NOT EXISTS "Beneficiary_status_idx" ON "Beneficiary"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Beneficiary_completed_via_idx" ON "Beneficiary"("completed_via");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_user_idx" ON "AuditLog"("user");
