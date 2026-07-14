-- AlterTable: إضافة حقل completed_via لمعرفة مصدر الاكتمال (يدوي أو استيراد)
ALTER TABLE "Beneficiary" ADD COLUMN "completed_via" TEXT;
