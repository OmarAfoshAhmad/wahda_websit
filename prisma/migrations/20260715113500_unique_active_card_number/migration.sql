-- يمنع إنشاء بطاقتين نشطتين بنفس الرقم مع تجاهل الفراغات وحالة الأحرف.
-- يسمح ببقاء النسخ المحذوفة ناعمًا لأغراض التدقيق والاسترجاع.
CREATE UNIQUE INDEX IF NOT EXISTS "Beneficiary_active_card_number_unique"
ON "Beneficiary" (UPPER(BTRIM("card_number")))
WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "Facility_active_role_type_idx"
ON "Facility" ("facility_type", "is_admin", "is_manager", "is_employee")
WHERE "deleted_at" IS NULL;
