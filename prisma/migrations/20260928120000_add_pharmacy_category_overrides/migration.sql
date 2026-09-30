ALTER TABLE "PharmacyPolicyConfig"
  ADD COLUMN "routine_coverage_percent" DECIMAL(5,2),
  ADD COLUMN "routine_frequency_months" INTEGER,
  ADD COLUMN "chronic_coverage_percent" DECIMAL(5,2),
  ADD COLUMN "chronic_frequency_months" INTEGER,
  ADD COLUMN "chemical_coverage_percent" DECIMAL(5,2),
  ADD COLUMN "chemical_frequency_months" INTEGER;

-- NULL deliberately means: inherit coverage/frequency from ServicePolicy.
ALTER TABLE "PharmacyPolicyConfig"
  ADD CONSTRAINT "PharmacyPolicyConfig_routine_coverage_check" CHECK ("routine_coverage_percent" IS NULL OR ("routine_coverage_percent" >= 0 AND "routine_coverage_percent" <= 100)),
  ADD CONSTRAINT "PharmacyPolicyConfig_chronic_coverage_check" CHECK ("chronic_coverage_percent" IS NULL OR ("chronic_coverage_percent" >= 0 AND "chronic_coverage_percent" <= 100)),
  ADD CONSTRAINT "PharmacyPolicyConfig_chemical_coverage_check" CHECK ("chemical_coverage_percent" IS NULL OR ("chemical_coverage_percent" >= 0 AND "chemical_coverage_percent" <= 100)),
  ADD CONSTRAINT "PharmacyPolicyConfig_routine_frequency_check" CHECK ("routine_frequency_months" IS NULL OR "routine_frequency_months" BETWEEN 1 AND 12),
  ADD CONSTRAINT "PharmacyPolicyConfig_chronic_frequency_check" CHECK ("chronic_frequency_months" IS NULL OR "chronic_frequency_months" BETWEEN 1 AND 12),
  ADD CONSTRAINT "PharmacyPolicyConfig_chemical_frequency_check" CHECK ("chemical_frequency_months" IS NULL OR "chemical_frequency_months" BETWEEN 1 AND 12);
