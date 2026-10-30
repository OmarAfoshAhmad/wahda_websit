"use server";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { canAccessAdmin } from "@/lib/permissions";
import { isCardLikeQuery, preciseCardMatchSql } from "@/lib/beneficiary-search";
import { relationLabel } from "@/lib/beneficiary-family";
import { EMPLOYEE_NUMBER_SQL_PATTERN } from "@/lib/beneficiary-employee-number";
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

export type FamilyFilter = "all" | "no_phone" | "no_portal" | "chronic" | "recent" | "never";
const FILTERS: FamilyFilter[] = ["all", "no_phone", "no_portal", "chronic", "recent", "never"];

/** أفراد الأسرة كما يرجعهم json_agg (التاريخ نص). */
type MemberRow = { id: string; name: string; card_number: string; status: string; chronic_count: number; last_dispense_at: string | null; is_head: boolean; matched: boolean };
type HeadRow = { fam: string; head_id: string; members: number; chronic_count: number; last_dispense_at: Date | null; name: string; card_number: string; phone_number: string | null; has_password: boolean; status: string; is_head: boolean; total: number };

/** الرقم الوظيفي بلا رمز الشركة والسنة والأصفار البادئة. */
const EMP_SQL = Prisma.sql`regexp_replace(regexp_replace(UPPER(REPLACE(REPLACE(b.card_number, ' ', ''), '-', '')), ${EMPLOYEE_NUMBER_SQL_PATTERN}, ''), '^0+(?=.)', '')`;
/** تطبيع عربي: أ/إ/آ→ا، ة→ه، ى→ي، وحذف التطويل؛ نفسه في SQL وفي المدخل. */
const NAME_NORMALIZED_SQL = Prisma.sql`translate(b.name, 'أإآةىـ', 'اااهي')`;
const normalizeArabic = (value: string) => value.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ـ/g, "");

/** هل يطابق الفرد البحث: رقم بطاقة/وظيفي بدقة، أو هاتف، أو كلمات الاسم بأي ترتيب. */
function memberSearchSql(search: string): Prisma.Sql {
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
function familyCte(companyId: string, search: string) {
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

function filterSql(filter: FamilyFilter) {
  switch (filter) {
    case "no_phone": return Prisma.sql`h.phone_number IS NULL`;
    case "no_portal": return Prisma.sql`NOT h.has_password`;
    case "chronic": return Prisma.sql`h.chronic_count > 0`;
    case "recent": return Prisma.sql`h.last_dispense_at >= now() - interval '30 days'`;
    case "never": return Prisma.sql`h.last_dispense_at IS NULL`;
    default: return Prisma.sql`TRUE`;
  }
}

type FamilyStats = Record<FamilyFilter, number> & { beneficiaries: number };
const statsCache = new Map<string, { at: number; stats: FamilyStats }>();
const STATS_TTL_MS = 60_000;

/** أرقام لوحة الأسر (كلها في استعلام واحد)، محفوظة دقيقة لكل شركة وتُمسح بعد تعديل هاتف أو كلمة مرور. */
async function familyStats(companyId: string): Promise<FamilyStats> {
  const cached = statsCache.get(companyId);
  if (cached && Date.now() - cached.at < STATS_TTL_MS) return cached.stats;
  const [row] = await prisma.$queryRaw<FamilyStats[]>`
    WITH ${familyCte(companyId, "")}
    SELECT COUNT(*)::int AS "all", COALESCE(SUM(members), 0)::int AS beneficiaries,
      COUNT(*) FILTER (WHERE ${filterSql("no_phone")})::int AS no_phone,
      COUNT(*) FILTER (WHERE ${filterSql("no_portal")})::int AS no_portal,
      COUNT(*) FILTER (WHERE ${filterSql("chronic")})::int AS chronic,
      COUNT(*) FILTER (WHERE ${filterSql("recent")})::int AS recent,
      COUNT(*) FILTER (WHERE ${filterSql("never")})::int AS never
    FROM h
  `;
  statsCache.set(companyId, { at: Date.now(), stats: row });
  return row;
}

/**
 * مستفيدو الشركة مجمّعين بالأسرة (صاحب البطاقة وأفراده) لتحمّل عشرات الآلاف:
 * البحث والفلترة والترقيم في قاعدة البيانات، 50 أسرة في الصفحة، وأفراد أسر الصفحة فقط.
 * البحث يطابق أي فرد فتظهر أسرته كلها ويُعلَّم المطابق.
 */
export async function listPharmacyFamilies(companyId: string, input: { query?: string; filter?: FamilyFilter; page?: number }) {
  const access = await requireStaff(companyId, "read");
  if ("error" in access) return { error: access.error, families: [], total: 0, pageSize: PAGE_SIZE, stats: null };
  const search = (input.query ?? "").trim().slice(0, 80);
  const filter = FILTERS.includes(input.filter as FamilyFilter) ? (input.filter as FamilyFilter) : "all";
  const offset = (Math.max(1, Math.floor(input.page ?? 1)) - 1) * PAGE_SIZE;

  // استعلام واحد: صفحة الأسر ثم أفراد أسر الصفحة فقط من نفس الجدول المؤقت m.
  const [heads, stats] = await Promise.all([
    prisma.$queryRaw<Array<HeadRow & { members_json: MemberRow[] }>>`
      WITH ${familyCte(companyId, search)},
      pg AS (
        SELECT h.*, COUNT(*) OVER()::int AS total FROM h
        WHERE h.matched AND ${filterSql(filter)}
        ORDER BY h.head_matched DESC, h.card_number ASC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      )
      SELECT pg.*, (
        SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'card_number', m.card_number, 'status', m.status,
          'chronic_count', m.chronic_count, 'last_dispense_at', m.last_dispense_at, 'is_head', m.is_head, 'matched', m.matched)
          ORDER BY (m.id = pg.head_id) DESC, m.card_number)
        FROM m WHERE m.fam = pg.fam
      ) AS members_json
      FROM pg ORDER BY pg.head_matched DESC, pg.card_number ASC
    `,
    familyStats(companyId),
  ]);

  return {
    families: heads.map((head) => ({
      key: head.fam,
      headId: head.head_id,
      name: head.name,
      cardNumber: head.card_number,
      hasHeadCard: head.is_head,
      phone: head.phone_number,
      hasPassword: head.has_password,
      status: head.status,
      chronicCount: head.chronic_count,
      lastDispenseAt: head.last_dispense_at?.toISOString() ?? null,
      members: (head.members_json ?? []).map((member) => ({
        id: member.id,
        name: member.name,
        cardNumber: member.card_number,
        relation: relationLabel(member.card_number, member.id === head.head_id && head.is_head),
        status: member.status,
        chronicCount: member.chronic_count,
        lastDispenseAt: member.last_dispense_at ? new Date(member.last_dispense_at).toISOString() : null,
        matched: Boolean(search) && member.matched,
      })),
    })),
    total: heads[0]?.total ?? 0,
    pageSize: PAGE_SIZE,
    stats,
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
  statsCache.delete(target.company_id);
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
  statsCache.delete(target.company_id);
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
