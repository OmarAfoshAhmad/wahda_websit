ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'EQUESTRIAN';

INSERT INTO "ServiceType" ("id", "code", "name", "is_active", "created_at", "updated_at")
VALUES ('service_equestrian', 'EQUESTRIAN', 'الفروسية', true, NOW(), NOW())
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "is_active" = true,
    "updated_at" = NOW();

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
