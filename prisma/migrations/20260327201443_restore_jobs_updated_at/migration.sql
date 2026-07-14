-- AlterTable (safe for non-empty tables)
ALTER TABLE "RestoreJob" ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "RestoreJob"
SET "updated_at" = COALESCE("completed_at", "started_at", "created_at", NOW())
WHERE "updated_at" IS NULL;

ALTER TABLE "RestoreJob" ALTER COLUMN "updated_at" SET NOT NULL;
