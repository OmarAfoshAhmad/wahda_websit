-- Add ip_address column to AuditLog for security tracking
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "ip_address" TEXT;
