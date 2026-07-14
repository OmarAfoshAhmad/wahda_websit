-- Add idempotency support for transaction writes
ALTER TABLE "Transaction"
ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_idempotency_key_key"
ON "Transaction"("idempotency_key");

-- Ensure there is only one active cancellation row per original transaction
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tx_active_cancellation_per_original"
ON "Transaction"("original_transaction_id")
WHERE "type" = 'CANCELLATION'
  AND "is_cancelled" = false
  AND "original_transaction_id" IS NOT NULL;

-- Enforce beneficiary balance bounds at DB level.
-- Use NOT VALID to avoid blocking migration on historical bad rows;
-- new/updated rows are still validated immediately.
DO $$
BEGIN
  ALTER TABLE "Beneficiary"
  ADD CONSTRAINT "ck_beneficiary_remaining_non_negative"
  CHECK ("remaining_balance" >= 0)
  NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Beneficiary"
  ADD CONSTRAINT "ck_beneficiary_remaining_le_total"
  CHECK ("remaining_balance" <= "total_balance")
  NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
