import { Prisma } from "@prisma/client";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { canAccessAdmin } from "@/lib/permissions";
import { isCardLikeQuery, preciseCardMatchSql } from "@/lib/beneficiary-search";
import { EMPLOYEE_NUMBER_SQL_PATTERN } from "@/lib/beneficiary-employee-number";

/**
 * أسر مستفيدي الصيدلية في SQL: مفتاح الأسرة من الرقم الوظيفي بلا لاحقة القرابة، والبحث والفلاتر،
 * مشتركة بين قائمة الإدارة وتصدير Excel واستيراد الهواتف.
 */

/** قائمة المستفيدين لموظفي الإدارة فقط؛ تعديل الهاتف وكلمة المرور يتطلب صلاحية تعديل المستفيدين. */
export async function requirePharmacyStaff(companyId: string, mode: "read" | "write") {
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

export type FamilyFilter = "all" | "no_phone" | "no_portal" | "chronic" | "recent" | "never";
export const FAMILY_FILTERS: FamilyFilter[] = ["all", "no_phone", "no_portal", "chronic", "recent", "never"];

/** أفراد الأسرة كما يرجعهم json_agg (التاريخ نص). */
export type MemberRow = { id: string; name: string; card_number: string; status: string; chronic_count: number; last_dispense_at: string | null; is_head: boolean; matched: boolean };
export type HeadRow = { fam: string; head_id: string; members: number; chronic_count: number; last_dispense_at: Date | null; name: string; card_number: string; phone_number: string | null; has_password: boolean; status: string; is_head: boolean; total: number };

/** الرقم الوظيفي بلا رمز الشركة والسنة والأصفار البادئة. */
export const EMP_SQL = Prisma.sql`regexp_replace(regexp_replace(UPPER(REPLACE(REPLACE(b.card_number, ' ', ''), '-', '')), ${EMPLOYEE_NUMBER_SQL_PATTERN}, ''), '^0+(?=.)', '')`;
/** تطبيع عربي: أ/إ/آ→ا، ة→ه، ى→ي، وحذف التطويل؛ نفسه في SQL وفي المدخل. */
export const NAME_NORMALIZED_SQL = Prisma.sql`translate(b.name, 'أإآةىـ', 'اااهي')`;
export const normalizeArabic = (value: string) => value.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ـ/g, "");

/** هل يطابق الفرد البحث: رقم بطاقة/وظيفي بدقة، أو هاتف، أو كلمات الاسم بأي ترتيب. */
export function memberSearchSql(search: string): Prisma.Sql {
  const compact = search.replace(/[\s-]/g, "");
  if (/^(\+?218|0)?9\d{4,}$/.test(compact)) {
    const tail = compact.replace(/^(\+?218|0)/, "");
    return Prisma.sql`(COALESCE(b.phone_number, '') LIKE ${"%" + tail + "%"} OR ${preciseCardMatchSql(Prisma.sql`b.card_number`, search)})`;
  }
  if (isCardLikeQuery(search)) return preciseCardMatchSql(Prisma.sql`b.card_number`, search);
  const terms = normalizeArabic(search).split(/\s+/).filter(Boolean).map((term) => "%" + term.replace(/[%_\\]/g, "\\$&") + "%");
  if (terms.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`(${Prisma.join(terms.map((term) => Prisma.sql`${NAME_NORMALIZED_SQL} ILIKE ${term}`), " AND ")})`;
}

/** أفراد الشركة مع مفتاح الأسرة وعدد المزمن وآخر صرف، ثم الأسر (f) وصاحب كل أسرة (h). */
export function familyCte(companyId: string, search: string) {
  const famExpr = Prisma.sql`COALESCE(NULLIF(regexp_replace(e.emp, '[A-Z][0-9]*$', ''), ''), e.emp)`;
  return Prisma.sql`
    m AS (
      SELECT b.id, b.name, b.card_number, b.phone_number, b.status::text AS status, (b.pin_hash IS NOT NULL) AS has_password,
        ${famExpr} AS fam, (e.emp = ${famExpr}) AS is_head,
        COALESCE(cc.n, 0)::int AS chronic_count, ld.last_at AS last_dispense_at,
        ${search ? memberSearchSql(search) : Prisma.sql`TRUE`} AS matched
      FROM "Beneficiary" b
      CROSS JOIN LATERAL (SELECT ${EMP_SQL} AS emp) e
      LEFT JOIN (SELECT beneficiary_id, COUNT(*) AS n FROM "BeneficiaryChronicDrug" WHERE active GROUP BY beneficiary_id) cc ON cc.beneficiary_id = b.id
      LEFT JOIN (SELECT beneficiary_id, MAX(created_at) AS last_at FROM "PharmacyDispense" WHERE company_id = ${companyId} AND status = 'COMPLETED' GROUP BY beneficiary_id) ld ON ld.beneficiary_id = b.id
      WHERE b.company_id = ${companyId} AND b.deleted_at IS NULL
    ),
    f AS (
      SELECT fam,
        (array_agg(id ORDER BY is_head DESC, card_number))[1] AS head_id,
        COUNT(*)::int AS members, SUM(chronic_count)::int AS chronic_count, MAX(last_dispense_at) AS last_dispense_at,
        bool_or(matched) AS matched, bool_or(matched AND is_head) AS head_matched
      FROM m GROUP BY fam
    ),
    h AS (
      SELECT f.fam, f.head_id, f.members, f.chronic_count, f.last_dispense_at, f.matched, f.head_matched,
        m.name, m.card_number, m.phone_number, m.has_password, m.status, m.is_head
      FROM f JOIN m ON m.id = f.head_id
    )`;
}

export function filterSql(filter: FamilyFilter) {
  switch (filter) {
    case "no_phone": return Prisma.sql`h.phone_number IS NULL`;
    case "no_portal": return Prisma.sql`NOT h.has_password`;
    case "chronic": return Prisma.sql`h.chronic_count > 0`;
    case "recent": return Prisma.sql`h.last_dispense_at >= now() - interval '30 days'`;
    case "never": return Prisma.sql`h.last_dispense_at IS NULL`;
    default: return Prisma.sql`TRUE`;
  }
}


export type FamilyStats = Record<FamilyFilter, number> & { beneficiaries: number };
/** أرقام لوحة الأسر محفوظة دقيقة لكل شركة؛ تُمسح بعد أي تعديل هاتف أو كلمة مرور. */
export const familyStatsCache = new Map<string, { at: number; stats: FamilyStats }>();
