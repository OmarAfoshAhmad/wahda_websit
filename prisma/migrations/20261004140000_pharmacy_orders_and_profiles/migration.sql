-- CreateEnum
CREATE TYPE "PharmacyFulfillment" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "PharmacyOrderStatus" AS ENUM ('PENDING', 'AVAILABLE', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PharmacyChatSender" AS ENUM ('BENEFICIARY', 'FACILITY');

-- CreateTable
CREATE TABLE "PharmacyProfile" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "accepts_orders" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "opens_at" TEXT,
    "closes_at" TEXT,
    "delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
    "delivery_base_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "delivery_per_km" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "delivery_max_km" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyOrder" (
    "id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "medicine_category" "MedicineCategory" NOT NULL,
    "fulfillment" "PharmacyFulfillment" NOT NULL,
    "status" "PharmacyOrderStatus" NOT NULL DEFAULT 'PENDING',
    "delivery_fee" DECIMAL(10,2),
    "delivery_distance_km" DOUBLE PRECISION,
    "delivery_latitude" DOUBLE PRECISION,
    "delivery_longitude" DOUBLE PRECISION,
    "delivery_address" TEXT,
    "chronic_drug_ids" JSONB,
    "note" TEXT,
    "prescription_id" TEXT,
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyOrderMessage" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "sender" "PharmacyChatSender" NOT NULL,
    "body" TEXT,
    "attachment_kind" "PharmacyAttachmentKind",
    "file_name" TEXT,
    "mime_type" TEXT,
    "storage_path" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacyOrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyProfile_facility_id_key" ON "PharmacyProfile"("facility_id");

-- CreateIndex
CREATE INDEX "PharmacyProfile_accepts_orders_idx" ON "PharmacyProfile"("accepts_orders");

-- CreateIndex
CREATE INDEX "PharmacyOrder_beneficiary_id_created_at_idx" ON "PharmacyOrder"("beneficiary_id", "created_at");

-- CreateIndex
CREATE INDEX "PharmacyOrder_facility_id_status_created_at_idx" ON "PharmacyOrder"("facility_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "PharmacyOrderMessage_order_id_created_at_idx" ON "PharmacyOrderMessage"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "PharmacyProfile" ADD CONSTRAINT "PharmacyProfile_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyOrder" ADD CONSTRAINT "PharmacyOrder_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyOrder" ADD CONSTRAINT "PharmacyOrder_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyOrderMessage" ADD CONSTRAINT "PharmacyOrderMessage_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "PharmacyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- اسم الفهرس في الترحيل 20261004100000 تجاوز 63 حرفًا فقصّه PostgreSQL؛ نعيده إلى الاسم الذي يتوقعه Prisma.
ALTER INDEX "PharmacyPrescription_beneficiary_id_medicine_category_prescript" RENAME TO "PharmacyPrescription_beneficiary_id_medicine_category_presc_key";
