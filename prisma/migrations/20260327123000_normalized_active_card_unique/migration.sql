-- Replace old partial unique index with normalized partial unique index.
DROP INDEX IF EXISTS "Beneficiary_card_number_active_key";

-- Normalize existing values once at source-of-truth level.
UPDATE "Beneficiary"
SET "card_number" = UPPER(BTRIM("card_number"));

-- Guard: fail migration if normalized duplicates exist among active beneficiaries.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Beneficiary"
    WHERE "deleted_at" IS NULL
    GROUP BY UPPER(BTRIM("card_number"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce normalized unique card_number. Resolve duplicate active card numbers (case/space-insensitive) before migrating.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "Beneficiary_card_number_active_key"
  ON "Beneficiary"(UPPER(BTRIM("card_number")))
  WHERE "deleted_at" IS NULL;
