-- DropIndex
DROP INDEX "Beneficiary_card_number_key";

-- CreateIndex: partial unique — card_number فريد فقط بين السجلات غير المحذوفة
-- هذا يسمح بإعادة استخدام نفس رقم البطاقة بعد الحذف الناعم
CREATE UNIQUE INDEX "Beneficiary_card_number_active_key"
  ON "Beneficiary"(card_number)
  WHERE deleted_at IS NULL;
