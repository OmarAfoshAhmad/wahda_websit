CREATE TABLE IF NOT EXISTS "CardIssuanceRegistry" (
    "id" TEXT NOT NULL,
    "card_number" TEXT NOT NULL,
    "card_number_upper" TEXT NOT NULL,
    "canonical_card" TEXT NOT NULL,
    "beneficiary_name" TEXT,
    "birth_date" TIMESTAMP(3),
    "batch_number" TEXT,
    "city" TEXT NOT NULL,
    "source_file" TEXT,
    "source_sheet" TEXT,
    "source_row" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardIssuanceRegistry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CardIssuanceRegistry_card_number_upper_key"
ON "CardIssuanceRegistry" ("card_number_upper");

CREATE INDEX IF NOT EXISTS "CardIssuanceRegistry_canonical_card_idx"
ON "CardIssuanceRegistry" ("canonical_card");

CREATE INDEX IF NOT EXISTS "CardIssuanceRegistry_city_idx"
ON "CardIssuanceRegistry" ("city");

CREATE INDEX IF NOT EXISTS "CardIssuanceRegistry_batch_number_idx"
ON "CardIssuanceRegistry" ("batch_number");
