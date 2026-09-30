CREATE TABLE "EquestrianPolicyConfig" (
    "id" TEXT NOT NULL,
    "service_policy_id" TEXT NOT NULL,
    "emergency_ceiling" DECIMAL(12,2) NOT NULL DEFAULT 3000,
    "inpatient_surgery_ceiling" DECIMAL(12,2) NOT NULL DEFAULT 7000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EquestrianPolicyConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquestrianPolicyConfig_service_policy_id_key" ON "EquestrianPolicyConfig"("service_policy_id");
CREATE INDEX "EquestrianPolicyConfig_service_policy_id_idx" ON "EquestrianPolicyConfig"("service_policy_id");

ALTER TABLE "EquestrianPolicyConfig"
ADD CONSTRAINT "EquestrianPolicyConfig_service_policy_id_fkey"
FOREIGN KEY ("service_policy_id") REFERENCES "ServicePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EquestrianPolicyConfig" (
  "id", "service_policy_id", "emergency_ceiling", "inpatient_surgery_ceiling", "updated_at"
)
SELECT
  'eqcfg_' || policy."id", policy."id", 3000, 7000, CURRENT_TIMESTAMP
FROM "ServicePolicy" policy
JOIN "ServiceType" service ON service."id" = policy."service_type_id"
WHERE service."code" = 'EQUESTRIAN'
ON CONFLICT ("service_policy_id") DO NOTHING;

UPDATE "ServicePolicy" policy
SET "ceiling_amount" = 10000
FROM "ServiceType" service
WHERE service."id" = policy."service_type_id" AND service."code" = 'EQUESTRIAN';
