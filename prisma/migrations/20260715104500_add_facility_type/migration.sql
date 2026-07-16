ALTER TABLE "Facility" ADD COLUMN IF NOT EXISTS "facility_type" TEXT;

UPDATE "Facility" f
SET "facility_type" = latest.facility_type_override
FROM (
  SELECT DISTINCT ON (metadata->>'facility_id')
    metadata->>'facility_id' AS facility_id,
    NULLIF(metadata->>'facility_type_override', '') AS facility_type_override
  FROM "AuditLog"
  WHERE action IN ('CREATE_FACILITY', 'UPDATE_FACILITY')
    AND metadata ? 'facility_id'
    AND metadata ? 'facility_type_override'
  ORDER BY metadata->>'facility_id', created_at DESC
) latest
WHERE f.id = latest.facility_id
  AND latest.facility_type_override IN ('HOSPITAL', 'PHARMACY');

CREATE INDEX IF NOT EXISTS "Facility_facility_type_idx" ON "Facility"("facility_type");
