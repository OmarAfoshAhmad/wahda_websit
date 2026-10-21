-- اشتراكات إشعارات الويب لأجهزة المستفيدين (مرتبطة بحساب الأسرة)
CREATE TABLE "BeneficiaryPushSubscription" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BeneficiaryPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BeneficiaryPushSubscription_endpoint_key" ON "BeneficiaryPushSubscription"("endpoint");
CREATE INDEX "BeneficiaryPushSubscription_account_id_idx" ON "BeneficiaryPushSubscription"("account_id");
