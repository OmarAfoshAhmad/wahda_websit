-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'CANCELLATION';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "is_cancelled" BOOLEAN NOT NULL DEFAULT false;
