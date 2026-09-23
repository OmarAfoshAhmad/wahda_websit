DELETE FROM "ServicePolicy" sp
USING "ServiceType" st, "InsuranceCompany" c
WHERE sp."service_type_id" = st."id"
  AND sp."company_id" = c."id"
  AND st."code" = 'EQUESTRIAN'
  AND NOT (c."name" ILIKE '%الفروسية%' OR c."code" = 'REG');

INSERT INTO "ServicePolicy" (
  "id",
  "company_id",
  "service_type_id",
  "ceiling_amount",
  "coverage_percent",
  "frequency_months",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  'policy_equestrian_' || c."id",
  c."id",
  st."id",
  10000.00,
  100.00,
  12,
  true,
  NOW(),
  NOW()
FROM "InsuranceCompany" c
CROSS JOIN "ServiceType" st
WHERE st."code" = 'EQUESTRIAN'
  AND c."deleted_at" IS NULL
  AND (c."name" ILIKE '%الفروسية%' OR c."code" = 'REG')
ON CONFLICT ("company_id", "service_type_id") DO UPDATE
SET "ceiling_amount" = EXCLUDED."ceiling_amount",
    "coverage_percent" = EXCLUDED."coverage_percent",
    "frequency_months" = EXCLUDED."frequency_months",
    "is_active" = true,
    "updated_at" = NOW();
