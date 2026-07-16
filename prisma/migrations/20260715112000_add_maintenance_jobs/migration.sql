CREATE TABLE IF NOT EXISTS "MaintenanceJob" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "task" JSONB NOT NULL,
  "created_by" TEXT NOT NULL,
  "actor_facility_id" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'queued',
  "progress" JSONB,
  "summary" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "MaintenanceJob_created_by_created_at_idx" ON "MaintenanceJob"("created_by", "created_at");
CREATE INDEX IF NOT EXISTS "MaintenanceJob_state_updated_at_idx" ON "MaintenanceJob"("state", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceJob_one_active_kind_idx"
  ON "MaintenanceJob"("kind") WHERE "state" IN ('queued', 'running');
