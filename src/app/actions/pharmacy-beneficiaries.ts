"use server";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { canAccessAdmin } from "@/lib/permissions";
import { beneficiaryListSearchSql } from "@/lib/beneficiary-search";
import { baseEmployeeNumber } from "@/lib/beneficiary-family";
import { employeeNumberOf } from "@/lib/beneficiary-employee-number";
import { normalizeLibyanMobile } from "@/lib/phone";

const PAGE_SIZE = 50;

/** قائمة المستفيدين لموظفي الإدارة فقط؛ تعديل الهاتف وكلمة المرور يتطلب صلاحية تعديل المستفيدين. */
async function requireStaff(companyId: string, mode: "read" | "write") {
  const session = await getSessionWithFreshPermissions();
  if (!session || !canAccessAdmin(session)) return { error: "غير مصرح" } as const;
  const allowed = mode === "write"
    ? hasPermission(session, "edit_beneficiary")
    : hasPermission(session, "pharmacy_services") || hasPermission(session, "view_pharmacy_beneficiaries");
  if (!allowed) return { error: "غير مصرح" } as const;
  try {
    await assertCompanyAccessForSession(session, companyId);
  } catch {
    return { error: "لا تملك صلاحية الوصول إلى هذه الشركة" } as const;
  }
  return { session } as const;
}

export async function listPharmacyBeneficiaries(companyId: string, query: string, page: number) {
  const access = await requireStaff(companyId, "read");
  if ("error" in access) return { error: access.error, items: [], total: 0, pageSize: PAGE_SIZE };
  const search = query.trim();
  const conditions: Prisma.Sql[] = [Prisma.sql`b.company_id = ${companyId}`, Prisma.sql`b.deleted_at IS NULL`];
  if (search) conditions.push(...beneficiaryListSearchSql("b", search));
  const where = Prisma.join(conditions, " AND ");
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;

  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; card_number: string; phone_number: string | null; status: string; has_password: boolean; chronic_count: number }>>`
      SELECT b.id, b.name, b.card_number, b.phone_number, b.status::text AS status, (b.pin_hash IS NOT NULL) AS has_password,
        (SELECT COUNT(*)::int FROM "BeneficiaryChronicDrug" c WHERE c.beneficiary_id = b.id AND c.active) AS chronic_count
      FROM "Beneficiary" b
      WHERE ${where}
      ORDER BY b.card_number ASC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "Beneficiary" b WHERE ${where}`,
  ]);

  return {
    items: rows.map((row) => {
      const employee = employeeNumberOf(row.card_number).replace(/^0+(?=.)/, "");
      // صاحب البطاقة الأساسية هو من يصله رمز التحقق وعليه كلمة مرور الأسرة.
      return { ...row, is_account_holder: employee === baseEmployeeNumber(employee) };
    }),
    total: totals[0]?.count ?? 0,
    pageSize: PAGE_SIZE,
  };
}

/** يضيف أو يغيّر هاتف صاحب البطاقة (وجهة رمز التحقق). لا يُسمح بنفس الرقم لبطاقتين. */
export async function setBeneficiaryPhone(beneficiaryId: string, phone: string) {
  const target = await prisma.beneficiary.findFirst({ where: { id: beneficiaryId, deleted_at: null }, select: { id: true, company_id: true, phone_number: true, card_number: true } });
  if (!target?.company_id) return { error: "المستفيد غير موجود" };
  const access = await requireStaff(target.company_id, "write");
  if ("error" in access) return { error: access.error };

  const normalized = phone.trim() === "" ? null : normalizeLibyanMobile(phone);
  if (phone.trim() !== "" && !normalized) return { error: "رقم الهاتف غير صحيح. اكتبه هكذا: 0912345678" };
  if (normalized) {
    const used = await prisma.beneficiary.findFirst({ where: { phone_number: normalized, id: { not: target.id }, deleted_at: null }, select: { card_number: true, name: true } });
    if (used) return { error: `الرقم مسجل لبطاقة أخرى: ${used.name} (${used.card_number})` };
  }

  await prisma.$transaction([
    prisma.beneficiary.update({ where: { id: target.id }, data: { phone_number: normalized, failed_attempts: 0, locked_until: null } }),
    prisma.auditLog.create({
      data: {
        facility_id: access.session.id,
        user: access.session.username,
        action: "BENEFICIARY_PHONE_CHANGE",
        metadata: { beneficiary_id: target.id, card_number: target.card_number, before: target.phone_number, after: normalized },
      },
    }),
  ]);
  return { success: true, phone: normalized };
}

/** يمسح كلمة مرور الأسرة: في الدخول التالي يسجل صاحب البطاقة برمز التحقق ثم ينشئ كلمة جديدة. */
export async function resetFamilyPassword(beneficiaryId: string) {
  const target = await prisma.beneficiary.findFirst({ where: { id: beneficiaryId, deleted_at: null }, select: { id: true, company_id: true, card_number: true } });
  if (!target?.company_id) return { error: "المستفيد غير موجود" };
  const access = await requireStaff(target.company_id, "write");
  if ("error" in access) return { error: access.error };
  await prisma.$transaction([
    prisma.beneficiary.update({ where: { id: target.id }, data: { pin_hash: null, failed_attempts: 0, locked_until: null } }),
    prisma.auditLog.create({ data: { facility_id: access.session.id, user: access.session.username, action: "BENEFICIARY_PASSWORD_RESET", metadata: { beneficiary_id: target.id, card_number: target.card_number } } }),
  ]);
  return { success: true };
}

/** تفاصيل مستفيد للإدارة: الهاتف، أدويته المزمنة (الفعالة والموقوفة) ومواعيدها، وآخر ما صُرف له. */
export async function getPharmacyBeneficiaryDetails(beneficiaryId: string) {
  const target = await prisma.beneficiary.findFirst({
    where: { id: beneficiaryId, deleted_at: null },
    select: { id: true, name: true, card_number: true, phone_number: true, status: true, company_id: true, company: { select: { name: true } } },
  });
  if (!target?.company_id) return { error: "المستفيد غير موجود" };
  const access = await requireStaff(target.company_id, "read");
  if ("error" in access) return { error: access.error };

  const [{ getPharmacyUsage, getChronicDrugStatuses }, { familyAccountIdOf }] = await Promise.all([import("@/lib/pharmacy/summary"), import("@/lib/beneficiary-family")]);
  const accountId = await familyAccountIdOf(target.id);
  const [account, summary, inactive, dispenses] = await Promise.all([
    prisma.beneficiary.findUnique({ where: { id: accountId }, select: { id: true, name: true, phone_number: true, pin_hash: true } }),
    getPharmacyUsage(target.id, target.company_id),
    prisma.beneficiaryChronicDrug.findMany({ where: { beneficiary_id: target.id, active: false }, orderBy: { updated_at: "desc" }, select: { id: true, notes: true, updated_at: true, drug: { select: { name: true } } } }),
    prisma.pharmacyDispense.findMany({
      where: { beneficiary_id: target.id },
      orderBy: { created_at: "desc" },
      take: 15,
      select: { id: true, medicine_category: true, created_at: true, gross_total: true, company_total: true, patient_total: true, item_count: true, status: true, transaction: { select: { is_cancelled: true } }, facility: { select: { name: true } } },
    }),
  ]);
  const chronic = await getChronicDrugStatuses(target.id, summary.chronicIntervalDays);

  return {
    beneficiary: { id: target.id, name: target.name, card_number: target.card_number, status: target.status, company: target.company?.name ?? "" },
    account: account ? { id: account.id, name: account.name, phone: account.phone_number, hasPassword: Boolean(account.pin_hash), isSelf: account.id === target.id } : null,
    canEdit: hasPermission(access.session, "edit_beneficiary"),
    chronicIntervalDays: summary.chronicIntervalDays,
    chronic: chronic.map((drug) => ({ id: drug.id, name: drug.drug_name, notes: drug.notes, lastAt: drug.last_dispensed_at, lastFacility: drug.last_facility_name, eligible: drug.eligible, nextAt: drug.next_eligible_at })),
    inactive: inactive.map((link) => ({ id: link.id, name: link.drug.name, notes: link.notes, stoppedAt: link.updated_at.toISOString() })),
    dispenses: dispenses.map((dispense) => ({
      id: dispense.id,
      category: dispense.medicine_category,
      createdAt: dispense.created_at.toISOString(),
      facility: dispense.facility.name,
      items: dispense.item_count,
      gross: Number(dispense.gross_total),
      company: Number(dispense.company_total),
      patient: Number(dispense.patient_total),
      cancelled: dispense.status === "CANCELLED" || dispense.transaction.is_cancelled,
    })),
  };
}

/** يقترح أدوية من الكتالوج أثناء الكتابة. */
export async function searchDrugCatalog(companyId: string, query: string) {
  const access = await requireStaff(companyId, "read");
  if ("error" in access) return [];
  const text = query.trim();
  if (text.length < 2) return [];
  return prisma.drugCatalog.findMany({ where: { active: true, name: { contains: text, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 10, select: { id: true, name: true } });
}

/** يربط دواءً مزمنًا بالمستفيد (من الكتالوج أو اسم جديد)، أو يعيد تفعيل دواء موقوف. */
export async function addChronicDrug(beneficiaryId: string, drugName: string, notes: string) {
  const target = await prisma.beneficiary.findFirst({ where: { id: beneficiaryId, deleted_at: null }, select: { id: true, company_id: true, card_number: true } });
  if (!target?.company_id) return { error: "المستفيد غير موجود" };
  const access = await requireStaff(target.company_id, "write");
  if ("error" in access) return { error: access.error };
  const name = drugName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 200) return { error: "اكتب اسم الدواء والجرعة (مثال: Concor 5mg)" };
  if (/^[\d\s.,]+$/.test(name)) return { error: "اسم الدواء لا يكون أرقامًا فقط" };
  const { normalizeDrugName } = await import("@/lib/pharmacy/chronic-import");
  const normalized = normalizeDrugName(name);

  await prisma.$transaction(async (tx) => {
    const drug = await tx.drugCatalog.upsert({ where: { normalized_name: normalized }, create: { name, normalized_name: normalized }, update: { active: true }, select: { id: true } });
    await tx.beneficiaryChronicDrug.upsert({
      where: { beneficiary_id_drug_id: { beneficiary_id: target.id, drug_id: drug.id } },
      create: { beneficiary_id: target.id, drug_id: drug.id, notes: notes.trim() || null },
      update: { active: true, notes: notes.trim() || undefined },
    });
    await tx.auditLog.create({ data: { facility_id: access.session.id, user: access.session.username, action: "CHRONIC_DRUG_ADD", metadata: { beneficiary_id: target.id, card_number: target.card_number, drug: name } } });
  });
  return { success: true };
}

/** يعدّل ملاحظات دواء مزمن أو يوقفه/يعيده. الإيقاف لا يحذف سجل صرفه. */
export async function updateChronicDrug(linkId: string, change: { notes?: string; active?: boolean }) {
  const link = await prisma.beneficiaryChronicDrug.findUnique({ where: { id: linkId }, select: { id: true, notes: true, active: true, drug: { select: { name: true } }, beneficiary: { select: { id: true, company_id: true, card_number: true } } } });
  if (!link?.beneficiary.company_id) return { error: "الدواء غير موجود" };
  const access = await requireStaff(link.beneficiary.company_id, "write");
  if ("error" in access) return { error: access.error };
  const notes = change.notes === undefined ? undefined : change.notes.trim().slice(0, 300) || null;
  await prisma.$transaction([
    prisma.beneficiaryChronicDrug.update({ where: { id: link.id }, data: { notes, active: change.active } }),
    prisma.auditLog.create({
      data: {
        facility_id: access.session.id,
        user: access.session.username,
        action: change.active === false ? "CHRONIC_DRUG_STOP" : change.active === true ? "CHRONIC_DRUG_RESUME" : "CHRONIC_DRUG_EDIT",
        metadata: { beneficiary_id: link.beneficiary.id, card_number: link.beneficiary.card_number, drug: link.drug.name, before: { notes: link.notes, active: link.active }, after: { notes, active: change.active } },
      },
    }),
  ]);
  return { success: true };
}
