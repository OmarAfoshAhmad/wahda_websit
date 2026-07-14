-- Archive latest family-level values received from transaction import files.
CREATE TABLE IF NOT EXISTS "FamilyImportArchive" (
  "family_base_card" TEXT PRIMARY KEY,
  "family_count_from_file" INTEGER NOT NULL DEFAULT 0,
  "total_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
  "used_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
  "source_row_number" INTEGER,
  "imported_by" TEXT,
  "last_imported_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_family_import_archive_last_imported_at"
ON "FamilyImportArchive" ("last_imported_at" DESC);
