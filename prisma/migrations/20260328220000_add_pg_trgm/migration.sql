-- Create extension if missing
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index for text search on name
CREATE INDEX IF NOT EXISTS beneficiary_name_trgm_idx ON "Beneficiary" USING gin (name gin_trgm_ops);

-- Create GIN index for text search on card_number
CREATE INDEX IF NOT EXISTS beneficiary_card_number_trgm_idx ON "Beneficiary" USING gin (card_number gin_trgm_ops);
