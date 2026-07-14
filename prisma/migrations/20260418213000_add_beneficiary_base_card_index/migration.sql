-- Speeds debt tab family-card matching by indexing normalized base card.
CREATE INDEX IF NOT EXISTS "idx_beneficiary_base_card_active"
ON "Beneficiary" ((regexp_replace(card_number, '([WSDMFHV][0-9]*)$', '')))
WHERE deleted_at IS NULL;
