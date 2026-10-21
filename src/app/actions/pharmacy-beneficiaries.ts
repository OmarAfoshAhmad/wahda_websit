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
