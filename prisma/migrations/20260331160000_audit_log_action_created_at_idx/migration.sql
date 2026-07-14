-- Replace single-column action index with a composite (action, created_at) index
-- This improves AuditLog.count and AuditLog.findMany when filtering by action + date range

DROP INDEX IF EXISTS "AuditLog_action_idx";
CREATE INDEX "AuditLog_action_created_at_idx" ON "AuditLog"("action", "created_at" DESC);
