-- Normalize card numbers and names before applying stricter uniqueness.
UPDATE "Beneficiary"
SET "card_number" = UPPER(BTRIM("card_number"));

UPDATE "Beneficiary"
SET "name" = REGEXP_REPLACE(BTRIM("name"), '\\s+', ' ', 'g');

-- Guard: no duplicated card numbers globally (including soft-deleted rows).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Beneficiary"
    GROUP BY UPPER(BTRIM("card_number"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce global unique card_number. Resolve duplicate card numbers (case/space-insensitive) before migrating.';
  END IF;
END
$$;

-- Guard: no duplicated active person identity for rows with known birth_date.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Beneficiary"
    WHERE "deleted_at" IS NULL
      AND "birth_date" IS NOT NULL
    GROUP BY UPPER(REGEXP_REPLACE(BTRIM("name"), '\\s+', ' ', 'g')), "birth_date"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce active person uniqueness (name + birth_date). Resolve duplicate active persons before migrating.';
  END IF;
END
$$;

DROP INDEX IF EXISTS "Beneficiary_card_number_active_key";

CREATE UNIQUE INDEX "Beneficiary_card_number_unique_key"
  ON "Beneficiary"(UPPER(BTRIM("card_number")));

CREATE UNIQUE INDEX "Beneficiary_person_active_unique_key"
  ON "Beneficiary"(UPPER(REGEXP_REPLACE(BTRIM("name"), '\\s+', ' ', 'g')), "birth_date")
  WHERE "deleted_at" IS NULL AND "birth_date" IS NOT NULL;
