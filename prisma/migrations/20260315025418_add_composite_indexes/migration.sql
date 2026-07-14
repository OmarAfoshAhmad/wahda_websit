-- CreateIndex
CREATE INDEX "Transaction_facility_id_created_at_idx" ON "Transaction"("facility_id", "created_at");

-- CreateIndex
CREATE INDEX "Transaction_created_at_idx" ON "Transaction"("created_at");
