CREATE INDEX IF NOT EXISTS "idx_tx_equestrian_balance_history"
ON "Transaction"("company_id", "beneficiary_id", "type", "is_cancelled", "service_category", "created_at");
