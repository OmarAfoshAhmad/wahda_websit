import prisma from "@/lib/prisma";
import { EMPLOYEE_NUMBER_SQL_PATTERN, employeeNumberOf, normalizeEmployeeNumber, resolveCardByEmployeeNumber } from "@/lib/beneficiary-employee-number";

/**
 * حساب الأسرة في بوابة المستفيد: الأسرة = بطاقة الموظف وبطاقات أفراد أسرته في نفس الشركة
 * (الرقم الوظيفي نفسه مع لاحقة العائلة: 32762 و32762S و32762W1 و32762D).
 * صاحب الحساب هو بطاقة الموظف الأساسية: عليها الهاتف (لرمز التحقق) وكلمة المرور المشتركة للأسرة.
 */

/** الرقم الوظيفي الأساسي بلا لاحقة العائلة وبلا أصفار بادئة: 10540W1 → 10540. */
export function baseEmployeeNumber(employeeNumber: string) {
  const normalized = normalizeEmployeeNumber(employeeNumber).replace(/^0+(?=.)/, "");
  const base = normalized.replace(/[A-Z][0-9]*$/, "");
  return base.length > 0 ? base : normalized;
}

/**
 * صاحب حساب الأسرة لرقم وظيفي مُدخل (من الموظف أو أي فرد من أسرته):
 * بطاقة الرقم الأساسي إن وُجدت، وإلا البطاقة المطابقة للمُدخل نفسه (أسرة بلا بطاقة أساسية مسجلة).
 */
export async function resolveFamilyAccountCard(companyId: string, employeeNumber: string, phone: string) {
  const base = baseEmployeeNumber(employeeNumber);
  const head = await resolveCardByEmployeeNumber(companyId, base, phone);
  if (!("error" in head)) return head;
  if (base === normalizeEmployeeNumber(employeeNumber).replace(/^0+(?=.)/, "")) return head;
  return resolveCardByEmployeeNumber(companyId, employeeNumber, phone);
}

/** أفراد أسرة صاحب الحساب (هو أولًا)، غير المحذوفين وغير الموقوفين. */
export async function listFamilyMembers(accountId: string) {
  const account = await prisma.beneficiary.findUnique({ where: { id: accountId }, select: { id: true, card_number: true, company_id: true } });
  if (!account?.company_id) return [];
  const base = baseEmployeeNumber(employeeNumberOf(account.card_number));
  const pattern = `^${base.replace(/[^A-Z0-9]/g, "")}([A-Z][0-9]*)?$`;
  const members = await prisma.$queryRaw<Array<{ id: string; name: string; card_number: string }>>`
    SELECT id, name, card_number FROM "Beneficiary"
    WHERE company_id = ${account.company_id}
      AND deleted_at IS NULL
      AND status <> 'SUSPENDED'
      AND regexp_replace(regexp_replace(UPPER(REPLACE(REPLACE(card_number, ' ', ''), '-', '')), ${EMPLOYEE_NUMBER_SQL_PATTERN}, ''), '^0+(?=.)', '') ~ ${pattern}
    ORDER BY (id = ${account.id}) DESC, card_number ASC
  `;
  // صاحب الحساب نفسه دائمًا ضمن الأسرة حتى لو لم يطابق النمط (بطاقة غير قياسية).
  if (!members.some((member) => member.id === account.id)) {
    const self = await prisma.beneficiary.findUnique({ where: { id: account.id }, select: { id: true, name: true, card_number: true } });
    if (self) members.unshift(self);
  }
  return members;
}

/** نوع القرابة من لاحقة البطاقة، للعرض فقط. */
export function relationLabel(cardNumber: string, isAccount: boolean) {
  if (isAccount) return "صاحب البطاقة";
  const suffix = employeeNumberOf(cardNumber).match(/([A-Z])[0-9]*$/)?.[1] ?? "";
  return RELATION_LABELS[suffix] ?? "فرد من الأسرة";
}

const RELATION_LABELS: Record<string, string> = { W: "الزوجة", H: "الزوج", S: "ابن", D: "ابنة", M: "الأم", F: "الأب" };

/** هل أنشأت الأسرة كلمة مرورها؟ البوابة لا تُفتح قبل ذلك. */
export async function familyHasPassword(accountId: string) {
  const account = await prisma.beneficiary.findUnique({ where: { id: accountId }, select: { pin_hash: true } });
  return Boolean(account?.pin_hash);
}

/** حساب الأسرة (بطاقة صاحب البطاقة) لأي فرد منها؛ إن لم توجد بطاقة أساسية فالفرد نفسه. */
export async function familyAccountIdOf(beneficiaryId: string) {
  const member = await prisma.beneficiary.findUnique({ where: { id: beneficiaryId }, select: { id: true, card_number: true, company_id: true } });
  if (!member?.company_id) return beneficiaryId;
  const base = baseEmployeeNumber(employeeNumberOf(member.card_number));
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Beneficiary"
    WHERE company_id = ${member.company_id} AND deleted_at IS NULL
      AND regexp_replace(regexp_replace(UPPER(REPLACE(REPLACE(card_number, ' ', ''), '-', '')), ${EMPLOYEE_NUMBER_SQL_PATTERN}, ''), '^0+(?=.)', '') = ${base}
    LIMIT 1
  `;
  return rows[0]?.id ?? member.id;
}
