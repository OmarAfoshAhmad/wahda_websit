-- AlterTable: add city and batch_number to Beneficiary
ALTER TABLE "Beneficiary" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Beneficiary" ADD COLUMN IF NOT EXISTS "batch_number" TEXT;

-- AlterTable: add city and batch_number to CardNumberingArchive
ALTER TABLE "CardNumberingArchive" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "CardNumberingArchive" ADD COLUMN IF NOT EXISTS "batch_number" TEXT;
