-- آخر صرف للدواء المزمن قبل المنظومة (من ملف الاستيراد)، ليُقفل الدواء حتى موعده التالي.
ALTER TABLE "BeneficiaryChronicDrug" ADD COLUMN "imported_last_dispensed_at" TIMESTAMP(3);
