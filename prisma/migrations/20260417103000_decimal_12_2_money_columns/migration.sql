-- Normalize money columns to 2 decimal places and constrain type.
-- This removes noisy numeric(65,30) representations in DB tools.

ALTER TABLE "Beneficiary"
  ALTER COLUMN "total_balance" TYPE NUMERIC(12,2)
  USING ROUND("total_balance"::numeric, 2),
  ALTER COLUMN "remaining_balance" TYPE NUMERIC(12,2)
  USING ROUND("remaining_balance"::numeric, 2);

ALTER TABLE "Transaction"
  ALTER COLUMN "amount" TYPE NUMERIC(12,2)
  USING ROUND("amount"::numeric, 2);

ALTER TABLE "Notification"
  ALTER COLUMN "amount" TYPE NUMERIC(12,2)
  USING CASE
    WHEN "amount" IS NULL THEN NULL
    ELSE ROUND("amount"::numeric, 2)
  END;
