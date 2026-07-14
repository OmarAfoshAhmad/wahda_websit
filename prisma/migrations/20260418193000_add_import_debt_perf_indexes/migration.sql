-- Performance indexes for heavy IMPORT/debt analysis queries
CREATE INDEX IF NOT EXISTS "idx_transaction_type_cancelled_beneficiary"
ON "Transaction" ("type", "is_cancelled", "beneficiary_id");

CREATE INDEX IF NOT EXISTS "idx_transaction_active_non_cancellation_beneficiary"
ON "Transaction" ("beneficiary_id")
WHERE "is_cancelled" = false AND "type" <> 'CANCELLATION';

CREATE INDEX IF NOT EXISTS "idx_beneficiary_deleted_status_completed"
ON "Beneficiary" ("deleted_at", "status", "completed_via");
