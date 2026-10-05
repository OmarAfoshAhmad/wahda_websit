import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getArabicSearchTerms } from "@/lib/search";
import { EMPLOYEE_NUMBER_SQL_PATTERN } from "@/lib/beneficiary-employee-number";

/**
 * بحث المستفيدين في بوابات الخدمات مرتبًا بالأقرب، لا أبجديًا:
 *   0) رقم البطاقة كاملًا   1) الرقم الوظيفي (بدون الأصفار البادئة: 001 = 1 = 000001)
 *   2) بطاقة تنتهي بالمدخل   3) جزء من الاسم أو البطاقة.
 * سابقًا كان البحث "يحتوي" مع ترتيب بالاسم وأول 20 نتيجة، فإدخال قصير مثل 001 يطابق مئات البطاقات
 * ويضيع المقصود. تعيد المعرّفات بالترتيب الصحيح.
 */
export async function rankBeneficiaryIds(input: {
  query: string;
  companyId: string;
  statuses?: Array<"ACTIVE" | "FINISHED" | "SUSPENDED">;
  includePhone?: boolean;
  limit?: number;
}): Promise<string[]> {
  const raw = input.query.trim();
  if (raw.length === 0) return [];
  const card = raw.replace(/[\s-]/g, "").toUpperCase();
  const employee = card.replace(/^0+(?=.)/, "");
  const nameTerms = getArabicSearchTerms(raw).map((term) => `%${term.replace(/[%_\\]/g, "\\$&")}%`);
  const cardLike = `%${card.replace(/[%_\\]/g, "\\$&")}%`;
  const statusFilter = input.statuses?.length ? Prisma.sql`AND b.status::text IN (${Prisma.join(input.statuses)})` : Prisma.empty;
  const phoneFilter = input.includePhone && /\d{3,}/.test(card) ? Prisma.sql`OR phone LIKE ${cardLike}` : Prisma.empty;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH c AS (
      SELECT b.id, b.name, COALESCE(b.phone_number, '') AS phone,
        UPPER(REPLACE(REPLACE(b.card_number, ' ', ''), '-', '')) AS card,
        regexp_replace(UPPER(REPLACE(REPLACE(b.card_number, ' ', ''), '-', '')), ${EMPLOYEE_NUMBER_SQL_PATTERN}, '') AS emp
      FROM "Beneficiary" b
      WHERE b.company_id = ${input.companyId} AND b.deleted_at IS NULL ${statusFilter}
    )
    SELECT id FROM (
      SELECT id, name,
        CASE
          WHEN card = ${card} THEN 0
          WHEN regexp_replace(emp, '^0+(?=.)', '') = ${employee} THEN 1
          WHEN card LIKE ${"%" + card.replace(/[%_\\]/g, "\\$&")} THEN 2
          ELSE 3
        END AS rank
      FROM c
      WHERE card LIKE ${cardLike} OR name ILIKE ANY (${nameTerms})
        OR regexp_replace(emp, '^0+(?=.)', '') = ${employee} ${phoneFilter}
    ) ranked
    ORDER BY rank, name
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

/** يرتب نتائج findMany حسب ترتيب المعرّفات المحسوبة. */
export function orderByIds<T extends { id: string }>(rows: T[], ids: string[]) {
  const position = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}
