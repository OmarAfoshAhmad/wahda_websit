ALTER TABLE "Beneficiary"
  ADD COLUMN "is_legacy_card" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Beneficiary_is_legacy_card_idx"
  ON "Beneficiary"("is_legacy_card");
