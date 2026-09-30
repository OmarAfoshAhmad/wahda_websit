"use server";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { getPharmacyPolicyWindow } from "@/lib/pharmacy/calculation";

function canAccessPharmacy(session: NonNullable<Awaited<ReturnType<typeof getSessionWithFreshPermissions>>>) {
  return hasPermission(session, "pharmacy_services") || hasPermission(session, "view_pharmacy_beneficiaries");
}

export async function searchPharmacyBeneficiaries(companyId: string, query: string) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !canAccessPharmacy(session)) return { error: "غير مصرح", items: [] };

  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return { error: "أدخل حرفين على الأقل للبحث", items: [] };

  const beneficiaries = await prisma.beneficiary.findMany({
    where: {
      company_id: companyId,
      deleted_at: null,
      OR: [
        { card_number: { contains: normalizedQuery, mode: "insensitive" } },
        { name: { contains: normalizedQuery, mode: "insensitive" } },
        { phone_number: { contains: normalizedQuery, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 10,
    select: {
      id: true,
      card_number: true,
      name: true,
      phone_number: true,
      status: true,
      company: { select: { id: true, name: true, code: true, logo: true } },
    },
  });

  return { items: beneficiaries };
}

export async function getPharmacyBeneficiaryWorkspace(companyId: string, beneficiaryId: string) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !canAccessPharmacy(session)) return { error: "غير مصرح" };

  const beneficiary = await prisma.beneficiary.findFirst({
    where: { id: beneficiaryId, company_id: companyId, deleted_at: null },
    select: {
      id: true,
      card_number: true,
      name: true,
      phone_number: true,
      birth_date: true,
      status: true,
      company: { select: { id: true, name: true, code: true, logo: true } },
      pharmacy_dispenses: {
        orderBy: { created_at: "desc" },
        take: 8,
        select: {
          id: true,
          medicine_category: true,
          gross_total: true,
          status: true,
          created_at: true,
          facility_id: true,
          facility: { select: { name: true } },
          items: { orderBy: { sequence: "asc" }, select: { sequence: true, price: true } },
        },
      },
      pharmacy_prescriptions: {
        where: { status: "OPEN" },
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          prescription_number: true,
          medicine_category: true,
          total_item_count: true,
          created_at: true,
          created_by_facility: { select: { id: true, name: true } },
          attachments: {
            orderBy: { created_at: "asc" },
            select: { id: true, file_name: true, mime_type: true, created_at: true },
          },
          slots: {
            orderBy: { sequence: "asc" },
            select: {
              id: true,
              sequence: true,
              status: true,
              reservation_expires_at: true,
              reserved_by_facility: { select: { id: true, name: true } },
              dispensed_by_facility: { select: { id: true, name: true } },
              dispense_item: { select: { price: true } },
            },
          },
        },
      },
    },
  });
  if (!beneficiary) return { error: "المستفيد غير موجود ضمن الشركة المختارة" };

  return {
    beneficiary: {
      ...beneficiary,
      birth_date: beneficiary.birth_date?.toISOString() ?? null,
      pharmacy_dispenses: beneficiary.pharmacy_dispenses.map((dispense) => ({
        ...dispense,
        gross_total: Number(dispense.gross_total),
        created_at: dispense.created_at.toISOString(),
        owned_by_current_facility: dispense.facility_id === session.id,
        items: dispense.items.map((item) => ({ ...item, price: Number(item.price) })),
      })),
      pharmacy_prescriptions: beneficiary.pharmacy_prescriptions.map((prescription) => ({
        ...prescription,
        created_at: prescription.created_at.toISOString(),
        attachments: prescription.attachments.map((attachment) => ({
          ...attachment,
          created_at: attachment.created_at.toISOString(),
        })),
        slots: prescription.slots.map((slot) => ({
          ...slot,
          reservation_expires_at: slot.reservation_expires_at?.toISOString() ?? null,
          price: slot.dispense_item ? Number(slot.dispense_item.price) : null,
          reserved_by_current_facility: slot.reserved_by_facility?.id === session.id,
          dispensed_by_current_facility: slot.dispensed_by_facility?.id === session.id,
        })),
      })),
    },
  };
}

export async function uploadPharmacyPrescriptionAttachment(formData: FormData) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !canAccessPharmacy(session)) return { error: "غير مصرح" };

  const prescriptionId = String(formData.get("prescriptionId") ?? "");
  const file = formData.get("file");
  if (!prescriptionId || !(file instanceof File) || file.size === 0) return { error: "اختر ملف الوصفة" };
  if (file.size > 8 * 1024 * 1024) return { error: "حجم ملف الوصفة يجب ألا يتجاوز 8 ميجابايت" };

  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  const extension = extensions[file.type];
  if (!extension) return { error: "يسمح فقط بملفات PDF أو صور JPG وPNG وWEBP" };

  const prescription = await prisma.pharmacyPrescription.findUnique({
    where: { id: prescriptionId },
    select: {
      id: true,
      status: true,
      company_id: true,
      medicine_category: true,
      company: {
        select: {
          service_policies: {
            where: { service_type: { code: "MEDICINE" }, is_active: true },
            take: 1,
            select: { pharmacy_config: { select: { max_attachments: true } } },
          },
        },
      },
    },
  });
  if (!prescription || prescription.status !== "OPEN") return { error: "الوصفة غير متاحة لإضافة مرفق" };

  const maxAttachments = prescription.company.service_policies[0]?.pharmacy_config?.max_attachments ?? 1;
  const currentCount = await prisma.pharmacyDispenseAttachment.count({ where: { prescription_id: prescriptionId } });
  if (currentCount >= maxAttachments) return { error: `الحد الأقصى لمرفقات الوصفة هو ${maxAttachments}` };

  const directory = path.join(process.cwd(), "storage", "pharmacy-prescriptions");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}${extension}`;
  const absolutePath = path.join(directory, storedName);
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  try {
    await prisma.pharmacyDispenseAttachment.create({
      data: {
        prescription_id: prescriptionId,
        uploaded_by_id: session.id,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        storage_path: path.join("storage", "pharmacy-prescriptions", storedName),
      },
    });
  } catch (error) {
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  }
  return { success: true };
}

export async function createPharmacyPrescription(input: {
  companyId: string;
  beneficiaryId: string;
  category: "ROUTINE" | "CHRONIC" | "CHEMICAL";
  totalItemCount: number;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !canAccessPharmacy(session)) return { error: "غير مصرح" };
  if (!Number.isInteger(input.totalItemCount) || input.totalItemCount < 1 || input.totalItemCount > 50) return { error: "عدد البنود يجب أن يكون بين 1 و50" };

  const policy = await prisma.servicePolicy.findFirst({
    where: { company_id: input.companyId, service_type: { code: "MEDICINE" }, is_active: true },
    include: { pharmacy_config: true },
  });
  if (!policy?.pharmacy_config) return { error: "سياسة الصيدلية غير مهيأة" };
  const config = policy.pharmacy_config;
  const enabled = input.category === "ROUTINE" ? config.routine_enabled : input.category === "CHRONIC" ? config.chronic_enabled : config.chemical_enabled;
  if (!enabled) return { error: "هذا النوع غير مفعل في سياسة الشركة" };
  const frequency = input.category === "ROUTINE" ? config.routine_frequency_months : input.category === "CHRONIC" ? config.chronic_frequency_months : config.chemical_frequency_months;
  const limit = input.category === "ROUTINE" ? config.routine_prescription_limit : input.category === "CHRONIC" ? config.chronic_prescription_limit : config.chemical_prescription_limit;
  const effectiveFrequency = frequency ?? policy.frequency_months ?? 12;
  const effectiveLimit = Math.min(4, limit ?? config.default_prescription_limit ?? 4);
  const window = getPharmacyPolicyWindow(new Date(), effectiveFrequency);

  const beneficiary = await prisma.beneficiary.findFirst({ where: { id: input.beneficiaryId, company_id: input.companyId, deleted_at: null, status: "ACTIVE" }, select: { id: true } });
  if (!beneficiary) return { error: "المستفيد غير نشط أو لا يتبع الشركة المختارة" };
  const currentCount = await prisma.pharmacyPrescription.count({ where: { beneficiary_id: input.beneficiaryId, medicine_category: input.category, status: { not: "CANCELLED" }, created_at: { gte: window.start, lt: window.end } } });
  if (currentCount >= effectiveLimit) return { error: `بلغ المستفيد الحد المسموح: ${effectiveLimit} وصفات` };

  const facility = await prisma.facility.findFirst({ where: { id: session.id, deleted_at: null }, select: { id: true } });
  if (!facility) return { error: "الحساب الحالي غير مرتبط بمرفق صالح" };
  const latest = await prisma.pharmacyPrescription.aggregate({ where: { beneficiary_id: input.beneficiaryId, medicine_category: input.category }, _max: { prescription_number: true } });
  const prescription = await prisma.pharmacyPrescription.create({
    data: {
      beneficiary_id: input.beneficiaryId,
      company_id: input.companyId,
      created_by_facility_id: session.id,
      medicine_category: input.category,
      prescription_number: (latest._max.prescription_number ?? 0) + 1,
      total_item_count: input.totalItemCount,
      slots: { create: Array.from({ length: input.totalItemCount }, (_, index) => ({ sequence: index + 1 })) },
    },
    select: { id: true },
  });
  return { success: true, prescriptionId: prescription.id };
}

export async function reservePharmacyPrescriptionItems(prescriptionId: string, sequences: number[]) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !canAccessPharmacy(session)) return { error: "غير مصرح" };
  const uniqueSequences = [...new Set(sequences)].filter((sequence) => Number.isInteger(sequence) && sequence > 0);
  if (uniqueSequences.length === 0) return { error: "اختر بندًا واحدًا على الأقل" };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PharmacyPrescription" WHERE "id" = ${prescriptionId} FOR UPDATE`;
    const prescription = await tx.pharmacyPrescription.findUnique({
      where: { id: prescriptionId },
      select: {
        id: true,
        status: true,
        total_item_count: true,
        beneficiary_id: true,
        medicine_category: true,
      },
    });
    if (!prescription || prescription.status !== "OPEN") return { error: "الوصفة غير متاحة للحجز" };
    if (uniqueSequences.some((sequence) => sequence > prescription.total_item_count)) return { error: "رقم بند غير صالح" };

    const attachmentCount = await tx.pharmacyDispenseAttachment.count({ where: { prescription_id: prescriptionId } });
    if (attachmentCount === 0) return { error: "يجب إرفاق ملف الوصفة قبل حجز البنود أو الخصم" };

    // Every prescription for the same beneficiary/category shares one item-number space.
    // Locking the beneficiary serializes reservations made concurrently from different
    // prescriptions or facilities, so the same sequence cannot be won twice.
    await tx.$queryRaw`SELECT "id" FROM "Beneficiary" WHERE "id" = ${prescription.beneficiary_id} FOR UPDATE`;
    const now = new Date();
    const occupiedInAnotherPrescription = await tx.pharmacyPrescriptionItem.findFirst({
      where: {
        prescription_id: { not: prescriptionId },
        sequence: { in: uniqueSequences },
        prescription: {
          beneficiary_id: prescription.beneficiary_id,
          medicine_category: prescription.medicine_category,
          status: "OPEN",
        },
        OR: [
          { status: "DISPENSED" },
          { status: "RESERVED", reservation_expires_at: { gt: now } },
        ],
      },
      include: {
        prescription: { select: { prescription_number: true } },
        reserved_by_facility: { select: { name: true } },
        dispensed_by_facility: { select: { name: true } },
      },
    });
    if (occupiedInAnotherPrescription) {
      const facilityName = occupiedInAnotherPrescription.status === "DISPENSED"
        ? occupiedInAnotherPrescription.dispensed_by_facility?.name
        : occupiedInAnotherPrescription.reserved_by_facility?.name;
      return {
        error: `البند ${occupiedInAnotherPrescription.sequence} مستخدم في الوصفة ${occupiedInAnotherPrescription.prescription.prescription_number}${facilityName ? ` لدى ${facilityName}` : ""}`,
      };
    }

    const slots = await tx.pharmacyPrescriptionItem.findMany({ where: { prescription_id: prescriptionId, sequence: { in: uniqueSequences } }, include: { reserved_by_facility: { select: { name: true } }, dispensed_by_facility: { select: { name: true } } } });
    const blocked = slots.find((slot) => slot.status === "DISPENSED" || (slot.status === "RESERVED" && slot.reserved_by_facility_id !== session.id && slot.reservation_expires_at && slot.reservation_expires_at > now));
    if (blocked) return { error: blocked.status === "DISPENSED" ? `البند ${blocked.sequence} مصروف بواسطة ${blocked.dispensed_by_facility?.name ?? "مرفق آخر"}` : `البند ${blocked.sequence} محجوز بواسطة ${blocked.reserved_by_facility?.name ?? "مرفق آخر"}` };

    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    await tx.pharmacyPrescriptionItem.updateMany({
      where: { prescription_id: prescriptionId, sequence: { in: uniqueSequences }, OR: [{ status: "AVAILABLE" }, { status: "RESERVED", reservation_expires_at: { lte: now } }, { status: "RESERVED", reserved_by_facility_id: session.id }] },
      data: { status: "RESERVED", reserved_by_facility_id: session.id, reserved_at: now, reservation_expires_at: expiresAt },
    });
    return { success: true, expiresAt: expiresAt.toISOString() };
  });
}
