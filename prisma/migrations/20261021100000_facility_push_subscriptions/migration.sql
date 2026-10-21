-- اشتراكات إشعارات الويب لأجهزة الصيدلية
CREATE TABLE "FacilityPushSubscription" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FacilityPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FacilityPushSubscription_endpoint_key" ON "FacilityPushSubscription"("endpoint");
CREATE INDEX "FacilityPushSubscription_facility_id_idx" ON "FacilityPushSubscription"("facility_id");
ALTER TABLE "FacilityPushSubscription" ADD CONSTRAINT "FacilityPushSubscription_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
