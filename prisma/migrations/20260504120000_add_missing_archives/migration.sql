-- CreateEnum if not exists
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CardNumberingStatus') THEN
        CREATE TYPE "CardNumberingStatus" AS ENUM ('READY', 'MIGRATED', 'DUPLICATE', 'DUPLICATE_FILE', 'DUPLICATE_SYSTEM', 'ERROR');
    END IF;
END $$;

-- CreateTable
CREATE TABLE "CardNumberingArchive" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employee_number" TEXT NOT NULL,
    "relationship" TEXT,
    "birth_date" TIMESTAMP(3),
    "card_number" TEXT NOT NULL,
    "status" "CardNumberingStatus" NOT NULL DEFAULT 'READY',
    "error_message" TEXT,
    "field3" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "migrated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "source_file" TEXT,

    CONSTRAINT "CardNumberingArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardIssuanceRegistryAll" (
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

    CONSTRAINT "CardIssuanceRegistryAll_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardNumberingArchive_card_number_key" ON "CardNumberingArchive"("card_number");

-- CreateIndex
CREATE INDEX "CardNumberingArchive_card_number_idx" ON "CardNumberingArchive"("card_number");

-- CreateIndex
CREATE INDEX "CardNumberingArchive_employee_number_idx" ON "CardNumberingArchive"("employee_number");

-- CreateIndex
CREATE INDEX "CardNumberingArchive_created_at_idx" ON "CardNumberingArchive"("created_at");

-- CreateIndex
CREATE INDEX "CardNumberingArchive_deleted_at_idx" ON "CardNumberingArchive"("deleted_at");

-- CreateIndex
CREATE INDEX "CardIssuanceRegistryAll_batch_number_idx" ON "CardIssuanceRegistryAll"("batch_number");

-- CreateIndex
CREATE INDEX "CardIssuanceRegistryAll_canonical_card_idx" ON "CardIssuanceRegistryAll"("canonical_card");

-- CreateIndex
CREATE INDEX "CardIssuanceRegistryAll_card_number_upper_idx" ON "CardIssuanceRegistryAll"("card_number_upper");

-- CreateIndex
CREATE INDEX "CardIssuanceRegistryAll_city_idx" ON "CardIssuanceRegistryAll"("city");
