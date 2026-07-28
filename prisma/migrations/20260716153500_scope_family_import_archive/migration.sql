-- The production snapshot has no FamilyImportArchive rows. Keep a defensive
-- guard so deployment fails rather than guessing company ownership if that
-- changes before this migration reaches another environment.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "FamilyImportArchive" LIMIT 1) THEN
    RAISE EXCEPTION 'FamilyImportArchive is not empty; run the company ownership audit before migrating';
  END IF;
END $$;

ALTER TABLE "FamilyImportArchive"
  DROP CONSTRAINT "FamilyImportArchive_pkey",
  ADD COLUMN id TEXT NOT NULL,
  ADD COLUMN company_id TEXT NOT NULL,
  ADD CONSTRAINT "FamilyImportArchive_pkey" PRIMARY KEY (id),
  ADD CONSTRAINT "FamilyImportArchive_company_id_fkey"
    FOREIGN KEY (company_id) REFERENCES "InsuranceCompany"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FamilyImportArchive_company_id_family_base_card_key"
  ON "FamilyImportArchive"(company_id, family_base_card);

CREATE INDEX "FamilyImportArchive_family_base_card_idx"
  ON "FamilyImportArchive"(family_base_card);
