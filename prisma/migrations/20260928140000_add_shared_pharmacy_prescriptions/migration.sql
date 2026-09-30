CREATE TYPE "PharmacyPrescriptionStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PharmacyPrescriptionItemStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'DISPENSED');

CREATE TABLE "PharmacyPrescription" (
  "id" TEXT NOT NULL,
  "beneficiary_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "created_by_facility_id" TEXT NOT NULL,
  "medicine_category" "MedicineCategory" NOT NULL,
  "prescription_number" INTEGER NOT NULL,
  "total_item_count" INTEGER NOT NULL,
  "status" "PharmacyPrescriptionStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "PharmacyPrescription_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PharmacyDispense" ADD COLUMN "prescription_id" TEXT;
ALTER TABLE "PharmacyDispenseItem" ADD COLUMN "prescription_id" TEXT;
ALTER TABLE "PharmacyDispenseItem" ADD COLUMN "prescription_item_id" TEXT;
ALTER TABLE "PharmacyDispenseAttachment" ADD COLUMN "prescription_id" TEXT;
ALTER TABLE "PharmacyDispenseAttachment" ALTER COLUMN "dispense_id" DROP NOT NULL;

CREATE TABLE "PharmacyPrescriptionItem" (
  "id" TEXT NOT NULL,
  "prescription_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "PharmacyPrescriptionItemStatus" NOT NULL DEFAULT 'AVAILABLE',
  "reserved_by_facility_id" TEXT,
  "reserved_at" TIMESTAMP(3),
  "reservation_expires_at" TIMESTAMP(3),
  "dispensed_by_facility_id" TEXT,
  "dispensed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PharmacyPrescriptionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PharmacyPrescription_beneficiary_id_medicine_category_prescription_number_status_key" ON "PharmacyPrescription"("beneficiary_id", "medicine_category", "prescription_number", "status");
CREATE INDEX "PharmacyPrescription_beneficiary_id_medicine_category_status_idx" ON "PharmacyPrescription"("beneficiary_id", "medicine_category", "status");
CREATE INDEX "PharmacyPrescription_company_id_created_at_idx" ON "PharmacyPrescription"("company_id", "created_at");
CREATE INDEX "PharmacyDispense_prescription_id_idx" ON "PharmacyDispense"("prescription_id");
CREATE UNIQUE INDEX "PharmacyDispenseItem_prescription_id_sequence_key" ON "PharmacyDispenseItem"("prescription_id", "sequence");
CREATE UNIQUE INDEX "PharmacyDispenseItem_prescription_item_id_key" ON "PharmacyDispenseItem"("prescription_item_id");
CREATE INDEX "PharmacyDispenseAttachment_prescription_id_idx" ON "PharmacyDispenseAttachment"("prescription_id");
CREATE UNIQUE INDEX "PharmacyPrescriptionItem_prescription_id_sequence_key" ON "PharmacyPrescriptionItem"("prescription_id", "sequence");
CREATE INDEX "PharmacyPrescriptionItem_status_reservation_expires_at_idx" ON "PharmacyPrescriptionItem"("status", "reservation_expires_at");
CREATE INDEX "PharmacyPrescriptionItem_reserved_by_facility_id_idx" ON "PharmacyPrescriptionItem"("reserved_by_facility_id");

ALTER TABLE "PharmacyPrescription" ADD CONSTRAINT "PharmacyPrescription_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyPrescription" ADD CONSTRAINT "PharmacyPrescription_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "InsuranceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyPrescription" ADD CONSTRAINT "PharmacyPrescription_created_by_facility_id_fkey" FOREIGN KEY ("created_by_facility_id") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispense" ADD CONSTRAINT "PharmacyDispense_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "PharmacyPrescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispenseItem" ADD CONSTRAINT "PharmacyDispenseItem_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "PharmacyPrescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispenseAttachment" ADD CONSTRAINT "PharmacyDispenseAttachment_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "PharmacyPrescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PharmacyPrescriptionItem" ADD CONSTRAINT "PharmacyPrescriptionItem_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "PharmacyPrescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PharmacyPrescriptionItem" ADD CONSTRAINT "PharmacyPrescriptionItem_reserved_by_facility_id_fkey" FOREIGN KEY ("reserved_by_facility_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PharmacyPrescriptionItem" ADD CONSTRAINT "PharmacyPrescriptionItem_dispensed_by_facility_id_fkey" FOREIGN KEY ("dispensed_by_facility_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PharmacyDispenseItem" ADD CONSTRAINT "PharmacyDispenseItem_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "PharmacyPrescriptionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
