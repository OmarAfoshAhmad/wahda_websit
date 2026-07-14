-- CreateEnum
CREATE TYPE "RestoreJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "RestoreJob" (
    "id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "status" "RestoreJobStatus" NOT NULL DEFAULT 'PENDING',
    "encrypted_payload" BYTEA NOT NULL,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "completed_steps" INTEGER NOT NULL DEFAULT 0,
    "current_phase" TEXT,
    "added_facilities" INTEGER NOT NULL DEFAULT 0,
    "updated_facilities" INTEGER NOT NULL DEFAULT 0,
    "added_beneficiaries" INTEGER NOT NULL DEFAULT 0,
    "updated_beneficiaries" INTEGER NOT NULL DEFAULT 0,
    "added_transactions" INTEGER NOT NULL DEFAULT 0,
    "skipped_transactions" INTEGER NOT NULL DEFAULT 0,
    "added_audit_logs" INTEGER NOT NULL DEFAULT 0,
    "added_notifications" INTEGER NOT NULL DEFAULT 0,
    "skipped_notifications" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestoreJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestoreJob_created_by_created_at_idx" ON "RestoreJob"("created_by", "created_at");

-- CreateIndex
CREATE INDEX "RestoreJob_status_idx" ON "RestoreJob"("status");
