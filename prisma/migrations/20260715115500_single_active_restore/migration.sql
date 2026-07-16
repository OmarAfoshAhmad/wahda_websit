CREATE UNIQUE INDEX IF NOT EXISTS "RestoreJob_single_active_restore_idx"
ON "RestoreJob" ((1)) WHERE status IN ('PENDING', 'PROCESSING');
