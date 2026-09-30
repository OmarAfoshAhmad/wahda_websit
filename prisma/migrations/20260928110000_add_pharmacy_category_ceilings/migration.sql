ALTER TABLE "PharmacyPolicyConfig"
  ADD COLUMN "routine_ceiling" DECIMAL(12,2),
  ADD COLUMN "chronic_ceiling" DECIMAL(12,2),
  ADD COLUMN "chemical_ceiling" DECIMAL(12,2);

-- Preserve the former policy behavior as the starting value. Administrators can
-- then assign a different finite/open ceiling to each medicine category.
UPDATE "PharmacyPolicyConfig" config
SET "routine_ceiling" = policy."ceiling_amount",
    "chronic_ceiling" = policy."ceiling_amount",
    "chemical_ceiling" = policy."ceiling_amount"
FROM "ServicePolicy" policy
WHERE policy."id" = config."service_policy_id";
