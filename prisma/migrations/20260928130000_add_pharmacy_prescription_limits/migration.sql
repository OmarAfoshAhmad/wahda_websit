ALTER TABLE "PharmacyPolicyConfig"
  ADD COLUMN "default_prescription_limit" INTEGER,
  ADD COLUMN "routine_prescription_limit" INTEGER,
  ADD COLUMN "chronic_prescription_limit" INTEGER,
  ADD COLUMN "chemical_prescription_limit" INTEGER;

-- NULL means unlimited for the default, and inherit-default for category overrides.
ALTER TABLE "PharmacyPolicyConfig"
  ADD CONSTRAINT "PharmacyPolicyConfig_default_prescription_limit_check" CHECK ("default_prescription_limit" IS NULL OR "default_prescription_limit" > 0),
  ADD CONSTRAINT "PharmacyPolicyConfig_routine_prescription_limit_check" CHECK ("routine_prescription_limit" IS NULL OR "routine_prescription_limit" > 0),
  ADD CONSTRAINT "PharmacyPolicyConfig_chronic_prescription_limit_check" CHECK ("chronic_prescription_limit" IS NULL OR "chronic_prescription_limit" > 0),
  ADD CONSTRAINT "PharmacyPolicyConfig_chemical_prescription_limit_check" CHECK ("chemical_prescription_limit" IS NULL OR "chemical_prescription_limit" > 0);
