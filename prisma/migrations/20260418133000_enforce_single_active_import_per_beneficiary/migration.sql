-- Ensure one active IMPORT transaction per beneficiary.
-- 1) Deduplicate existing active IMPORT rows by keeping the latest row.
WITH ranked AS (
  SELECT
    id,
    beneficiary_id,
    ROW_NUMBER() OVER (PARTITION BY beneficiary_id ORDER BY created_at DESC, id DESC) AS rn,
    COUNT(*) OVER (PARTITION BY beneficiary_id) AS cnt
  FROM "Transaction"
  WHERE type = 'IMPORT'
    AND is_cancelled = false
), to_delete AS (
  SELECT id
  FROM ranked
  WHERE cnt > 1 AND rn > 1
)
DELETE FROM "Transaction"
WHERE id IN (SELECT id FROM to_delete);

-- 2) Add a partial unique index so duplicates cannot happen again.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_import_per_beneficiary"
  ON "Transaction" ("beneficiary_id")
  WHERE type = 'IMPORT' AND is_cancelled = false;
