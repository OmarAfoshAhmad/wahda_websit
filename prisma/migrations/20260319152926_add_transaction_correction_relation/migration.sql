-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "original_transaction_id" TEXT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_original_transaction_id_fkey" FOREIGN KEY ("original_transaction_id") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
