"use server";

import { copyFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PharmacyAttachmentKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { calculatePharmacyDispense } from "@/lib/pharmacy/calculation";
import { getChronicDrugStatuses, getPharmacyConsumption, getPharmacyUsage, loadPharmacyPolicy } from "@/lib/pharmacy/summary";
import { ATTACHMENT_KINDS, ATTACHMENT_LABELS, storeAttachmentFile, type StoredFile } from "@/lib/pharmacy/attachments";
import {
  getNextChronicEligibleDate,
  getPolicyYearWindow,
  getTripoliDayWindow,
  isChronicDrugEligible,
  resolvePharmacyCategoryPolicy,
  type MedicineCategoryValue,
} from "@/lib/pharmacy/policy";
import { assertBeneficiaryBalanceInvariant, calculateBeneficiaryBalance, settleBeneficiaryBalance } from "@/lib/tx-balance-guard";

type PharmacySession = NonNullable<Awaited<ReturnType<typeof getSessionWithFreshPermissions>>>;
type Tx = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

function canAccessPharmacy(session: PharmacySession) {
  return hasPermission(session, "pharmacy_services") || hasPermission(session, "view_pharmacy_beneficiaries");
}

/**
 * العرض يكفيه أي من صلاحيتي الصيدلية، أما الإنشاء والرفع والحجز والصرف فتتطلب pharmacy_services.
 * وفي الحالتين يجب أن تكون الشركة ضمن نطاق الحساب.
 */
async function requirePharmacySession(companyId: string | null, mode: "read" | "write") {
  const session = await getSessionWithFreshPermissions();
  if (!session) return { error: "غير مصرح" } as const;
  const allowed = mode === "write" ? hasPermission(session, "pharmacy_services") : canAccessPharmacy(session);
  if (!allowed) return { error: "غير مصرح" } as const;
  if (companyId) {
    try {
      await assertCompanyAccessForSession(session, companyId);
    } catch {
      return { error: "لا تملك صلاحية الوصول إلى هذه الشركة" } as const;
    }
  }
  return { session } as const;
}

const MAX_PRESCRIPTION_LINE = 50;


async function findMissingAttachment(tx: Tx, prescriptionId: string) {
  const present = await tx.pharmacyDispenseAttachment.findMany({ where: { prescription_id: prescriptionId, kind: { not: null } }, select: { kind: true } });
  return ATTACHMENT_KINDS.find((kind) => !present.some((item) => item.kind === kind)) ?? null;
}

async function lockBeneficiary(tx: Tx, beneficiaryId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Beneficiary" WHERE "id" = ${beneficiaryId} FOR UPDATE`;
}

export async function searchPharmacyBeneficiaries(companyId: string, query: string) {
  const access = await requirePharmacySession(companyId, "read");
  if ("error" in access) return { error: access.error, items: [] };

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
  const access = await requirePharmacySession(companyId, "read");
  if ("error" in access) return { error: access.error };
  const { session } = access;

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
          prescription: { select: { prescription_number: true, total_item_count: true, attachments: { select: { id: true, kind: true } } } },
          attachments: { select: { id: true, kind: true } },
          items: { orderBy: { sequence: "asc" }, select: { sequence: true, price: true, drug: { select: { name: true } } } },
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
            select: { id: true, kind: true, file_name: true, mime_type: true, created_at: true },
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

  const { usage, chronicIntervalDays } = await getPharmacyUsage(beneficiary.id, companyId);
  const chronicDrugs = await getChronicDrugStatuses(beneficiary.id, chronicIntervalDays);

  return {
    usage,
    chronicIntervalDays,
    beneficiary: {
      ...beneficiary,
      birth_date: beneficiary.birth_date?.toISOString() ?? null,
      pharmacy_dispenses: beneficiary.pharmacy_dispenses.map((dispense) => ({
        ...dispense,
        gross_total: Number(dispense.gross_total),
        created_at: dispense.created_at.toISOString(),
        owned_by_current_facility: dispense.facility_id === session.id,
        // الروتيني والكيميائي يرفقان على الوصفة، والمزمن على الصرف نفسه.
        attachments: [...dispense.attachments, ...(dispense.prescription?.attachments ?? [])],
        prescription: dispense.prescription ? { prescription_number: dispense.prescription.prescription_number, total_item_count: dispense.prescription.total_item_count } : null,
        items: dispense.items.map((item) => ({ sequence: item.sequence, price: Number(item.price), drug_name: item.drug?.name ?? null })),
      })),
      chronic_drugs: chronicDrugs,
      pharmacy_prescriptions: beneficiary.pharmacy_prescriptions.map((prescription) => ({
        ...prescription,
        created_at: prescription.created_at.toISOString(),
        attachments: prescription.attachments.map((attachment) => ({
          ...attachment,
          created_at: attachment.created_at.toISOString(),
        })),
        slots: prescription.slots.map(({ dispense_item, ...slot }) => ({
          ...slot,
          reservation_expires_at: slot.reservation_expires_at?.toISOString() ?? null,
          price: dispense_item ? Number(dispense_item.price) : null,
          reserved_by_current_facility: slot.reserved_by_facility?.id === session.id,
          dispensed_by_current_facility: slot.dispensed_by_facility?.id === session.id,
        })),
      })),
    },
  };
}

/** يرفع أحد المرفقين الإلزاميين للوصفة (البطاقة التأمينية أو الوصفة)، ويستبدل المرفق السابق من نفس النوع. */
export async function uploadPharmacyPrescriptionAttachment(formData: FormData) {
  const prescriptionId = String(formData.get("prescriptionId") ?? "");
  const kind = String(formData.get("kind") ?? "") as PharmacyAttachmentKind;
  const file = formData.get("file");
  if (!prescriptionId || !(file instanceof File)) return { error: "اختر الملف" };
  if (!ATTACHMENT_KINDS.includes(kind)) return { error: "نوع المرفق غير صالح" };

  const prescription = await prisma.pharmacyPrescription.findUnique({
    where: { id: prescriptionId },
    select: { id: true, status: true, company_id: true },
  });
  if (!prescription || prescription.status !== "OPEN") return { error: "الوصفة غير متاحة لإضافة مرفق" };
  const access = await requirePharmacySession(prescription.company_id, "write");
  if ("error" in access) return { error: access.error };

  const stored = await storeAttachmentFile(file, kind);
  if ("error" in stored) return { error: stored.error };

  try {
    const replaced = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PharmacyPrescription" WHERE "id" = ${prescriptionId} FOR UPDATE`;
      const previous = await tx.pharmacyDispenseAttachment.findMany({ where: { prescription_id: prescriptionId, kind }, select: { id: true, storage_path: true } });
      await tx.pharmacyDispenseAttachment.deleteMany({ where: { id: { in: previous.map((item) => item.id) } } });
      await tx.pharmacyDispenseAttachment.create({
        data: {
          prescription_id: prescriptionId,
          kind,
          uploaded_by_id: access.session.id,
          file_name: stored.fileName,
          mime_type: stored.mime,
          file_size: stored.size,
          storage_path: stored.storagePath,
        },
      });
      return previous;
    });
    await Promise.all(replaced.map((item) => unlink(path.join(process.cwd(), item.storage_path)).catch(() => undefined)));
  } catch (error) {
    await unlink(stored.absolutePath).catch(() => undefined);
    throw error;
  }
  return { success: true };
}

/**
 * ينشئ وصفة روتينية أو كيميائية. الحد اليومي يُفحص ويُرقَّم داخل معاملة مع قفل المستفيد
 * حتى لا يتجاوزه طلبان متزامنان. المزمن لا يمر من هنا؛ له مسار dispenseChronicDrugs.
 */
export async function createPharmacyPrescription(input: {
  companyId: string;
  beneficiaryId: string;
  category: "ROUTINE" | "CHRONIC" | "CHEMICAL";
}) {
  const access = await requirePharmacySession(input.companyId, "write");
  if ("error" in access) return { error: access.error };
  const { session } = access;
  if (input.category === "CHRONIC") return { error: "صرف الأدوية المزمنة يتم من قائمة الأدوية المرتبطة بالمستفيد" };

  const policy = await loadPharmacyPolicy(prisma, input.companyId);
  if (!policy?.pharmacy_config) return { error: "سياسة الصيدلية غير مهيأة" };
  const resolved = resolvePharmacyCategoryPolicy(policy, policy.pharmacy_config, input.category);
  if (!resolved.enabled) return { error: "هذا النوع غير مفعل في سياسة الشركة" };
  const dailyLimit = resolved.dailyLimit ?? 2;

  const facility = await prisma.facility.findFirst({ where: { id: session.id, deleted_at: null }, select: { id: true } });
  if (!facility) return { error: "الحساب الحالي غير مرتبط بمرفق صالح" };

  return prisma.$transaction(async (tx) => {
    const beneficiary = await tx.beneficiary.findFirst({ where: { id: input.beneficiaryId, company_id: input.companyId, deleted_at: null, status: "ACTIVE" }, select: { id: true } });
    if (!beneficiary) return { error: "المستفيد غير نشط أو لا يتبع الشركة المختارة" };
    await lockBeneficiary(tx, beneficiary.id);

    const today = getTripoliDayWindow(new Date());
    const todayCount = await tx.pharmacyPrescription.count({
      where: { beneficiary_id: beneficiary.id, medicine_category: input.category, status: { not: "CANCELLED" }, created_at: { gte: today.start, lt: today.end } },
    });
    if (todayCount >= dailyLimit) return { error: `بلغ المستفيد الحد اليومي: ${dailyLimit} وصفات. يتجدد الحد عند منتصف الليل` };

    const latest = await tx.pharmacyPrescription.aggregate({ where: { beneficiary_id: beneficiary.id, medicine_category: input.category }, _max: { prescription_number: true } });
    const prescription = await tx.pharmacyPrescription.create({
      data: {
        beneficiary_id: beneficiary.id,
        company_id: input.companyId,
        created_by_facility_id: session.id,
        medicine_category: input.category,
        prescription_number: (latest._max.prescription_number ?? 0) + 1,
        // لا يُحدد عدد البنود مسبقًا: كل بند يُسجَّل عند صرفه، والحد هو أعلى رقم بند مقبول.
        total_item_count: MAX_PRESCRIPTION_LINE,
      },
      select: { id: true },
    });
    return { success: true, prescriptionId: prescription.id };
  });
}

export async function reservePharmacyPrescriptionItems(prescriptionId: string, sequences: number[]) {
  const owner = await prisma.pharmacyPrescription.findUnique({ where: { id: prescriptionId }, select: { company_id: true } });
  if (!owner) return { error: "الوصفة غير موجودة" };
  const access = await requirePharmacySession(owner.company_id, "write");
  if ("error" in access) return { error: access.error };
  const { session } = access;
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

    const missingAttachment = await findMissingAttachment(tx, prescriptionId);
    if (missingAttachment) return { error: `يجب إرفاق ${ATTACHMENT_LABELS[missingAttachment]} قبل حجز البنود أو الصرف` };

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
      // الحجز القائم لنفس المرفق لا يُمدَّد، حتى لا يحتكر مرفق البنود بتجديد الحجز بلا نهاية.
      where: { prescription_id: prescriptionId, sequence: { in: uniqueSequences }, OR: [{ status: "AVAILABLE" }, { status: "RESERVED", reservation_expires_at: { lte: now } }] },
      data: { status: "RESERVED", reserved_by_facility_id: session.id, reserved_at: now, reservation_expires_at: expiresAt },
    });
    return { success: true, expiresAt: expiresAt.toISOString() };
  });
}

class PharmacyRuleError extends Error {}

type DispenseLine = { sequence: number; price: number; drugId?: string | null; prescriptionItemId?: string | null };

/**
 * يسجل الصرف كاملاً داخل معاملة مقفلة على المستفيد: يحسب السقف (سقف الفئة ضمن السقف العام، على الإجمالي)
 * خلال السنة التأمينية، ثم يكتب الحركة والصرف والبنود ويعيد تسوية الرصيد من الدفتر.
 */
async function recordPharmacyDispense(tx: Tx, input: {
  session: PharmacySession;
  companyId: string;
  beneficiaryId: string;
  category: MedicineCategoryValue;
  lines: DispenseLine[];
  prescriptionId: string | null;
  idempotencyKey: string;
}) {
  const policy = await loadPharmacyPolicy(tx, input.companyId);
  if (!policy?.pharmacy_config) throw new PharmacyRuleError("سياسة الصيدلية غير مهيأة");
  const resolved = resolvePharmacyCategoryPolicy(policy, policy.pharmacy_config, input.category);
  if (!resolved.enabled) throw new PharmacyRuleError("هذا النوع غير مفعل في سياسة الشركة");
  if (input.lines.length === 0) throw new PharmacyRuleError("أدخل بندًا واحدًا على الأقل");
  if (input.lines.some((line) => !Number.isFinite(line.price) || line.price <= 0)) throw new PharmacyRuleError("أدخل سعرًا صحيحًا أكبر من صفر لكل بند");

  const window = getPolicyYearWindow(new Date(), resolved.policyYearStartMonth);
  const consumption = await getPharmacyConsumption(tx, input.beneficiaryId, input.category, window);
  const calculation = calculatePharmacyDispense({
    items: input.lines.map((line) => ({ sequence: line.sequence, price: line.price, drugId: line.drugId ?? null })),
    defaultCoveragePercent: resolved.coveragePercent,
    ceilingBasis: "GROSS",
    ceilingAmount: resolved.categoryCeiling,
    consumedBefore: consumption.category,
    additionalCeilings: [{ ceilingAmount: resolved.overallCeiling, consumedBefore: consumption.overall }],
  });
  if (calculation.remainingBefore !== null && calculation.remainingBefore.lte(0)) {
    throw new PharmacyRuleError("استنفد المستفيد السقف المتاح لهذه الفئة أو للأدوية خلال السنة التأمينية");
  }
  // لا يُسمح بتجاوز السقف المخصص لأي نوع (روتيني، مزمن، كيميائي)، ولا ينتقل الفرق إلى المستفيد.
  if (calculation.remainingBefore !== null && calculation.grossTotal.gt(calculation.remainingBefore)) {
    throw new PharmacyRuleError(`إجمالي الصرف (${calculation.grossTotal.toFixed(2)}) يتجاوز المتبقي من السقف المخصص (${calculation.remainingBefore.toFixed(2)} د.ل)`);
  }

  const ledger = await calculateBeneficiaryBalance(tx, input.beneficiaryId);
  if (calculation.companyTotal.toNumber() > ledger.remaining_balance) {
    throw new PharmacyRuleError(`حصة الشركة (${calculation.companyTotal.toFixed(2)}) أكبر من الرصيد المتاح للمستفيد (${ledger.remaining_balance.toFixed(2)} د.ل)`);
  }

  const facility = await tx.facility.findUnique({ where: { id: input.session.id }, select: { name: true } });
  const transaction = await tx.transaction.create({
    data: {
      beneficiary_id: input.beneficiaryId,
      facility_id: input.session.id,
      company_id: input.companyId,
      service_type_id: policy.service_type_id,
      type: "MEDICINE",
      amount: calculation.grossTotal,
      idempotency_key: `pharmacy:${input.idempotencyKey}`,
      service_category: input.category,
      original_company_share: calculation.companyTotal,
      original_patient_share: calculation.patientTotal,
      actual_company_share: calculation.companyTotal,
      actual_patient_share: calculation.patientTotal,
      ceiling_consumed: calculation.ceilingConsumption,
      consumed_before: calculation.consumedBefore,
      consumed_after: calculation.consumedAfter,
      remaining_ceiling_before: calculation.remainingBefore,
      remaining_ceiling_after: calculation.remainingAfter,
      policy_snapshot: JSON.parse(JSON.stringify({ policy, resolved })),
      calc_metadata: { ceilingBasis: "GROSS", policyYearStart: window.start.toISOString(), overallConsumedBefore: consumption.overall.toFixed(2) },
    },
  });

  const lineBySequence = new Map(input.lines.map((line) => [line.sequence, line]));
  const dispense = await tx.pharmacyDispense.create({
    data: {
      beneficiary_id: input.beneficiaryId,
      company_id: input.companyId,
      facility_id: input.session.id,
      medicine_category: input.category,
      prescription_id: input.prescriptionId,
      item_count: calculation.itemCount,
      gross_total: calculation.grossTotal,
      company_total: calculation.companyTotal,
      patient_total: calculation.patientTotal,
      transaction_id: transaction.id,
      idempotency_key: input.idempotencyKey,
      items: {
        create: calculation.items.map((item) => ({
          sequence: item.sequence,
          drug_id: item.drugId,
          prescription_id: input.prescriptionId,
          prescription_item_id: lineBySequence.get(item.sequence)?.prescriptionItemId ?? null,
          price: item.price,
          coverage_percent: item.coveragePercent,
          company_share: item.companyShare,
          patient_share: item.patientShare,
        })),
      },
    },
    select: { id: true },
  });

  const settled = await settleBeneficiaryBalance(tx, input.beneficiaryId, { completedVia: "MANUAL" });
  await tx.auditLog.create({
    data: {
      facility_id: input.session.id,
      user: input.session.username,
      action: "PHARMACY_DISPENSE",
      metadata: {
        dispense_id: dispense.id,
        transaction_id: transaction.id,
        beneficiary_id: input.beneficiaryId,
        category: input.category,
        facility_name: facility?.name ?? null,
        gross_total: calculation.grossTotal.toFixed(2),
        company_total: calculation.companyTotal.toFixed(2),
        patient_total: calculation.patientTotal.toFixed(2),
        balance_before: settled.balanceBefore,
        balance_after: settled.balanceAfter,
      },
    },
  });
  await assertBeneficiaryBalanceInvariant(tx, input.beneficiaryId, "pharmacyDispense");

  return {
    dispenseId: dispense.id,
    grossTotal: Number(calculation.grossTotal),
    companyTotal: Number(calculation.companyTotal),
    patientTotal: Number(calculation.patientTotal),
    remainingAfter: calculation.remainingAfter === null ? null : Number(calculation.remainingAfter),
  };
}

function toErrorResult(error: unknown) {
  if (error instanceof PharmacyRuleError) return { error: error.message };
  throw error;
}

/**
 * صرف بنود وصفة روتينية أو كيميائية: يدخل المرفق رقم البند كما في الوصفة وسعره.
 * البند يجب ألا يكون مصروفًا أو محجوزًا لمرفق آخر، والمرفقان الإلزاميان يجب أن يكونا موجودين.
 */
export async function dispensePharmacyPrescriptionItems(input: {
  prescriptionId: string;
  items: Array<{ sequence: number; price: number }>;
  idempotencyKey: string;
}) {
  const owner = await prisma.pharmacyPrescription.findUnique({ where: { id: input.prescriptionId }, select: { company_id: true, beneficiary_id: true } });
  if (!owner) return { error: "الوصفة غير موجودة" };
  const access = await requirePharmacySession(owner.company_id, "write");
  if ("error" in access) return { error: access.error };
  const { session } = access;
  if (!input.idempotencyKey) return { error: "طلب غير صالح" };
  const sequences = input.items.map((item) => item.sequence);
  if (sequences.some((sequence) => !Number.isInteger(sequence) || sequence < 1)) return { error: "رقم بند غير صالح" };
  if (new Set(sequences).size !== sequences.length) return { error: "رقم البند مكرر" };

  const existing = await prisma.pharmacyDispense.findUnique({ where: { idempotency_key: input.idempotencyKey }, select: { id: true } });
  if (existing) return { success: true, duplicated: true, dispenseId: existing.id };

  try {
    return await prisma.$transaction(async (tx) => {
      await lockBeneficiary(tx, owner.beneficiary_id);
      await tx.$queryRaw`SELECT "id" FROM "PharmacyPrescription" WHERE "id" = ${input.prescriptionId} FOR UPDATE`;
      const prescription = await tx.pharmacyPrescription.findUnique({
        where: { id: input.prescriptionId },
        select: { id: true, status: true, total_item_count: true, medicine_category: true, beneficiary: { select: { status: true, deleted_at: true } } },
      });
      if (!prescription || prescription.status !== "OPEN") throw new PharmacyRuleError("الوصفة غير متاحة للصرف");
      if (prescription.beneficiary.deleted_at || prescription.beneficiary.status !== "ACTIVE") throw new PharmacyRuleError("المستفيد غير نشط");
      if (prescription.medicine_category === "CHRONIC") throw new PharmacyRuleError("صرف الأدوية المزمنة يتم من قائمة الأدوية المرتبطة بالمستفيد");
      if (sequences.some((sequence) => sequence > prescription.total_item_count)) throw new PharmacyRuleError(`رقم البند يجب أن يكون بين 1 و${prescription.total_item_count}`);

      const missingAttachment = await findMissingAttachment(tx, prescription.id);
      if (missingAttachment) throw new PharmacyRuleError(`يجب إرفاق ${ATTACHMENT_LABELS[missingAttachment]} قبل الصرف`);

      const now = new Date();
      // البنود تُنشأ عند أول صرف لها؛ القيد الفريد (prescription_id, sequence) يمنع التكرار.
      await tx.pharmacyPrescriptionItem.createMany({ data: sequences.map((sequence) => ({ prescription_id: prescription.id, sequence })), skipDuplicates: true });
      const slots = await tx.pharmacyPrescriptionItem.findMany({
        where: { prescription_id: prescription.id, sequence: { in: sequences } },
        include: { reserved_by_facility: { select: { name: true } }, dispensed_by_facility: { select: { name: true } } },
      });
      for (const slot of slots) {
        if (slot.status === "DISPENSED") throw new PharmacyRuleError(`البند ${slot.sequence} مصروف مسبقًا لدى ${slot.dispensed_by_facility?.name ?? "مرفق آخر"}`);
        const heldByOther = slot.status === "RESERVED" && slot.reserved_by_facility_id !== session.id && slot.reservation_expires_at && slot.reservation_expires_at > now;
        if (heldByOther) throw new PharmacyRuleError(`البند ${slot.sequence} محجوز لدى ${slot.reserved_by_facility?.name ?? "مرفق آخر"}`);
      }
      const slotBySequence = new Map(slots.map((slot) => [slot.sequence, slot]));

      const result = await recordPharmacyDispense(tx, {
        session,
        companyId: owner.company_id,
        beneficiaryId: owner.beneficiary_id,
        category: prescription.medicine_category,
        prescriptionId: prescription.id,
        idempotencyKey: input.idempotencyKey,
        lines: input.items.map((item) => ({ sequence: item.sequence, price: Number(item.price), prescriptionItemId: slotBySequence.get(item.sequence)?.id ?? null })),
      });

      await tx.pharmacyPrescriptionItem.updateMany({
        where: { prescription_id: prescription.id, sequence: { in: sequences } },
        data: { status: "DISPENSED", dispensed_by_facility_id: session.id, dispensed_at: now, reserved_by_facility_id: null, reserved_at: null, reservation_expires_at: null },
      });

      return { success: true, duplicated: false, ...result };
    });
  } catch (error) {
    return toErrorResult(error);
  }
}

/**
 * صرف الأدوية المزمنة: لا وصفات، بل الأدوية المرتبطة بالمستفيد فقط. كل دواء يُصرف مرة كل
 * chronic_interval_days يومًا (من أي مرفق). يُرفق مع الطلب صورة البطاقة التأمينية فقط؛ لا وصفة لأن الأدوية مرتبطة بالمستفيد.
 * FormData: companyId, beneficiaryId, idempotencyKey, items (JSON: [{ chronicDrugId, price }]), insuranceCard أو orderId (لاستخدام بطاقة الطلب).
 */
export async function dispenseChronicDrugs(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "");
  const beneficiaryId = String(formData.get("beneficiaryId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const access = await requirePharmacySession(companyId, "write");
  if ("error" in access) return { error: access.error };
  const { session } = access;
  if (!beneficiaryId || !idempotencyKey) return { error: "طلب غير صالح" };

  let items: Array<{ chronicDrugId: string; price: number }>;
  try {
    const parsed = JSON.parse(String(formData.get("items") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("items");
    items = parsed.map((item) => ({ chronicDrugId: String(item.chronicDrugId), price: Number(item.price) }));
  } catch {
    return { error: "بيانات الأدوية غير صالحة" };
  }
  if (items.length === 0) return { error: "اختر دواءً واحدًا على الأقل" };
  if (new Set(items.map((item) => item.chronicDrugId)).size !== items.length) return { error: "الدواء مكرر في الطلب" };

  const existing = await prisma.pharmacyDispense.findUnique({ where: { idempotency_key: idempotencyKey }, select: { id: true } });
  if (existing) return { success: true, duplicated: true, dispenseId: existing.id };

  const files: Array<[PharmacyAttachmentKind, FormDataEntryValue | null]> = [["INSURANCE_CARD", formData.get("insuranceCard")]];
  const stored: StoredFile[] = [];
  const cleanup = () => Promise.all(stored.map((file) => unlink(file.absolutePath).catch(() => undefined)));
  // عند الصرف من طلب المستفيد تُستخدم البطاقة التي أرسلها في المحادثة (نسخة مستقلة) بدل إعادة رفعها.
  const orderId = String(formData.get("orderId") ?? "");
  if (orderId && !(files[0][1] instanceof File)) {
    const card = await prisma.pharmacyOrderMessage.findFirst({
      where: { order: { id: orderId, facility_id: session.id, beneficiary_id: beneficiaryId }, sender: "BENEFICIARY", attachment_kind: "INSURANCE_CARD" },
      orderBy: { created_at: "desc" },
      select: { file_name: true, mime_type: true, storage_path: true },
    });
    if (!card?.storage_path) return { error: "لم يُرسل المستفيد صورة البطاقة في الطلب" };
    const storagePath = path.join("storage", "pharmacy-prescriptions", `${randomUUID()}${path.extname(card.storage_path)}`);
    const absolutePath = path.join(process.cwd(), storagePath);
    await copyFile(path.join(process.cwd(), card.storage_path), absolutePath);
    stored.push({ kind: "INSURANCE_CARD", fileName: card.file_name ?? "card", mime: card.mime_type ?? "image/webp", size: 0, storagePath, absolutePath });
    files.length = 0;
  }
  for (const [kind, file] of files) {
    if (!(file instanceof File)) {
      await cleanup();
      return { error: `يجب إرفاق ${ATTACHMENT_LABELS[kind]}` };
    }
    const result = await storeAttachmentFile(file, kind);
    if ("error" in result) {
      await cleanup();
      return { error: result.error };
    }
    stored.push(result);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const beneficiary = await tx.beneficiary.findFirst({ where: { id: beneficiaryId, company_id: companyId, deleted_at: null, status: "ACTIVE" }, select: { id: true } });
      if (!beneficiary) throw new PharmacyRuleError("المستفيد غير نشط أو لا يتبع الشركة المختارة");
      await lockBeneficiary(tx, beneficiary.id);

      const links = await tx.beneficiaryChronicDrug.findMany({
        where: { beneficiary_id: beneficiary.id, active: true },
        select: { id: true, drug_id: true, drug: { select: { name: true } } },
      });
      if (links.length === 0) throw new PharmacyRuleError("المستفيد غير مشمول بخدمة الأدوية المزمنة: لا توجد أدوية مرتبطة به");
      const linkById = new Map(links.map((link) => [link.id, link]));
      if (items.some((item) => !linkById.has(item.chronicDrugId))) throw new PharmacyRuleError("أحد الأدوية المختارة غير مرتبط بالمستفيد");

      const policy = await loadPharmacyPolicy(tx, companyId);
      const intervalDays = policy?.pharmacy_config?.chronic_interval_days ?? 28;
      const now = new Date();
      const drugIds = items.map((item) => linkById.get(item.chronicDrugId)!.drug_id);
      const lastItems = await tx.pharmacyDispenseItem.findMany({
        where: { drug_id: { in: drugIds }, dispense: { beneficiary_id: beneficiary.id, medicine_category: "CHRONIC", status: "COMPLETED" } },
        orderBy: { dispense: { created_at: "desc" } },
        distinct: ["drug_id"],
        select: { drug_id: true, dispense: { select: { created_at: true, facility: { select: { name: true } } } } },
      });
      for (const last of lastItems) {
        if (!isChronicDrugEligible(last.dispense.created_at, intervalDays, now)) {
          const name = links.find((link) => link.drug_id === last.drug_id)?.drug.name ?? "الدواء";
          const next = getNextChronicEligibleDate(last.dispense.created_at, intervalDays).toLocaleDateString("ar-LY", { timeZone: "Africa/Tripoli" });
          throw new PharmacyRuleError(`${name} صُرف لدى ${last.dispense.facility.name}، ويُسمح بصرفه مجددًا من ${next}`);
        }
      }

      const result = await recordPharmacyDispense(tx, {
        session,
        companyId,
        beneficiaryId: beneficiary.id,
        category: "CHRONIC",
        prescriptionId: null,
        idempotencyKey,
        lines: items.map((item, index) => ({ sequence: index + 1, price: item.price, drugId: linkById.get(item.chronicDrugId)!.drug_id })),
      });
      await tx.pharmacyDispenseAttachment.createMany({
        data: stored.map((file) => ({
          dispense_id: result.dispenseId,
          kind: file.kind,
          uploaded_by_id: session.id,
          file_name: file.fileName,
          mime_type: file.mime,
          file_size: file.size,
          storage_path: file.storagePath,
        })),
      });
      return { success: true, duplicated: false, ...result };
    });
  } catch (error) {
    await cleanup();
    return toErrorResult(error);
  }
}
