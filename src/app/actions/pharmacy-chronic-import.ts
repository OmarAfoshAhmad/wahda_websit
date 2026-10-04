"use server";

import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { getArabicNormalization } from "@/lib/normalize";
import { buildChronicImportTemplate, normalizeDrugName, parseChronicImportWorkbook, type ChronicImportRow } from "@/lib/pharmacy/chronic-import";

export type ChronicImportMode = "ADD" | "REPLACE";
export type ChronicImportRowResult = {
  rowNumber: number;
  card: string;
  beneficiaryName: string;
  drugName: string;
  notes: string;
  status: "NEW" | "EXISTING" | "ERROR";
  message: string | null;
  warning: string | null;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function requireImportAccess(companyId: string) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !hasPermission(session, "manage_companies")) return { error: "غير مصرح: يتطلب صلاحية إدارة الشركات والسياسات" } as const;
  try {
    await assertCompanyAccessForSession(session, companyId);
  } catch {
    return { error: "لا تملك صلاحية الوصول إلى هذه الشركة" } as const;
  }
  return { session } as const;
}

export async function downloadChronicImportTemplate() {
  const session = await getSessionWithFreshPermissions();
  if (!session || !hasPermission(session, "manage_companies")) return { error: "غير مصرح" };
  return { fileName: "قالب_استيراد_الأدوية_المزمنة.xlsx", base64: (await buildChronicImportTemplate()).toString("base64") };
}

/** يفحص كل صف مقابل بيانات الشركة دون أي كتابة. يُستخدم للمعاينة وللتنفيذ معًا حتى لا تختلف النتيجة. */
async function analyzeRows(companyId: string, rows: ChronicImportRow[]) {
  const cards = [...new Set(rows.map((row) => row.card).filter(Boolean))];
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { company_id: companyId, deleted_at: null, card_number: { in: cards } },
    select: { id: true, card_number: true, name: true, chronic_drugs: { select: { active: true, drug: { select: { normalized_name: true } } } } },
  });
  const byCard = new Map(beneficiaries.map((beneficiary) => [beneficiary.card_number, beneficiary]));

  // مطابقة احتياطية بالاسم الكامل عند غياب البطاقة أو عدم وجودها؛ تُقبل فقط إن كان الاسم فريدًا في الشركة.
  const nameKey = (value: string) => getArabicNormalization(value.toUpperCase()).replace(/\s+/g, " ").trim();
  const unmatchedNames = [...new Set(rows.filter((row) => (!row.card || !byCard.has(row.card)) && row.beneficiaryName).map((row) => row.beneficiaryName.trim().replace(/\s+/g, " ")))];
  const byName = new Map<string, Array<(typeof beneficiaries)[number]>>();
  if (unmatchedNames.length > 0) {
    const candidates = await prisma.beneficiary.findMany({
      where: { company_id: companyId, deleted_at: null, OR: unmatchedNames.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
      select: { id: true, card_number: true, name: true, chronic_drugs: { select: { active: true, drug: { select: { normalized_name: true } } } } },
    });
    for (const candidate of candidates) byName.set(nameKey(candidate.name), [...(byName.get(nameKey(candidate.name)) ?? []), candidate]);
  }
  const seen = new Set<string>();

  const results: Array<ChronicImportRowResult & { beneficiaryId: string | null; normalizedDrug: string }> = rows.map((row) => {
    const normalizedDrug = normalizeDrugName(row.drugName);
    const base = { ...row, beneficiaryId: null as string | null, normalizedDrug, warning: null as string | null };
    if (!row.drugName) return { ...base, status: "ERROR" as const, message: "اسم الدواء فارغ" };
    if (row.drugName.length > 200) return { ...base, status: "ERROR" as const, message: "اسم الدواء أطول من 200 حرف" };
    let beneficiary = row.card ? byCard.get(row.card) : undefined;
    let matchedByName = false;
    if (!beneficiary && row.beneficiaryName) {
      const matches = byName.get(nameKey(row.beneficiaryName)) ?? [];
      if (matches.length > 1) return { ...base, status: "ERROR" as const, message: `البطاقة غير موجودة، والاسم مكرر لدى ${matches.length} مستفيدين` };
      beneficiary = matches[0];
      matchedByName = Boolean(beneficiary);
    }
    if (!beneficiary) return { ...base, status: "ERROR" as const, message: row.card ? "رقم البطاقة غير موجود ضمن الشركة المختارة ولم يُطابق الاسم" : "لا يوجد رقم بطاقة ولم يُطابق الاسم" };
    const key = `${beneficiary.id}:${normalizedDrug}`;
    if (seen.has(key)) return { ...base, beneficiaryId: beneficiary.id, status: "ERROR" as const, message: "صف مكرر: نفس الدواء لنفس المستفيد" };
    seen.add(key);
    const warning = matchedByName ? `طوبق بالاسم: البطاقة في المنظومة ${beneficiary.card_number}` : row.beneficiaryName && getArabicNormalization(row.beneficiaryName.toUpperCase()).replace(/\s+/g, " ") !== getArabicNormalization(beneficiary.name.toUpperCase()).replace(/\s+/g, " ")
      ? `الاسم في المنظومة: ${beneficiary.name}`
      : null;
    const existing = beneficiary.chronic_drugs.some((link) => link.active && link.drug.normalized_name === normalizedDrug);
    return { ...base, beneficiaryId: beneficiary.id, warning, status: existing ? "EXISTING" as const : "NEW" as const, message: null };
  });
  return results;
}

async function readUpload(companyId: string, fileBase64: string) {
  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length === 0) return { error: "اختر ملف Excel" } as const;
  if (buffer.length > MAX_FILE_BYTES) return { error: "حجم الملف يجب ألا يتجاوز 10 ميجابايت" } as const;
  const parsed = await parseChronicImportWorkbook(buffer);
  if ("error" in parsed) return { error: parsed.error } as const;
  return { results: await analyzeRows(companyId, parsed.rows) } as const;
}

function summarize(results: ChronicImportRowResult[]) {
  return {
    total: results.length,
    newCount: results.filter((row) => row.status === "NEW").length,
    existingCount: results.filter((row) => row.status === "EXISTING").length,
    errorCount: results.filter((row) => row.status === "ERROR").length,
    warningCount: results.filter((row) => row.warning).length,
    beneficiaryCount: new Set(results.filter((row) => row.status !== "ERROR").map((row) => row.card)).size,
  };
}

const publicRow = ({ rowNumber, card, beneficiaryName, drugName, notes, status, message, warning }: ChronicImportRowResult): ChronicImportRowResult =>
  ({ rowNumber, card, beneficiaryName, drugName, notes, status, message, warning });

export async function previewChronicDrugImport(companyId: string, fileBase64: string) {
  const access = await requireImportAccess(companyId);
  if ("error" in access) return { error: access.error };
  const upload = await readUpload(companyId, fileBase64);
  if ("error" in upload) return { error: upload.error };
  return { summary: summarize(upload.results), rows: upload.results.map(publicRow) };
}

/**
 * ينفذ الاستيراد للصفوف السليمة فقط (الصفوف الخاطئة تُتجاهل وتظهر في التقرير).
 * ADD: يضيف ويعيد تفعيل ويحدث الملاحظات. REPLACE: إضافة إلى ذلك يوقف كل دواء مرتبط بمستفيد ورد في الملف ولم يرد معه.
 */
export async function applyChronicDrugImport(companyId: string, fileBase64: string, mode: ChronicImportMode) {
  const access = await requireImportAccess(companyId);
  if ("error" in access) return { error: access.error };
  if (mode !== "ADD" && mode !== "REPLACE") return { error: "وضع الاستيراد غير صالح" };
  const upload = await readUpload(companyId, fileBase64);
  if ("error" in upload) return { error: upload.error };
  const valid = upload.results.filter((row) => row.status !== "ERROR" && row.beneficiaryId);
  if (valid.length === 0) return { error: "لا توجد صفوف سليمة للاستيراد" };

  const outcome = await prisma.$transaction(async (tx) => {
    const drugNames = new Map<string, string>();
    for (const row of valid) if (!drugNames.has(row.normalizedDrug)) drugNames.set(row.normalizedDrug, row.drugName);
    await tx.drugCatalog.createMany({ data: [...drugNames].map(([normalized_name, name]) => ({ normalized_name, name })), skipDuplicates: true });
    const drugs = await tx.drugCatalog.findMany({ where: { normalized_name: { in: [...drugNames.keys()] } }, select: { id: true, normalized_name: true } });
    const drugIdByName = new Map(drugs.map((drug) => [drug.normalized_name, drug.id]));

    const beneficiaryIds = [...new Set(valid.map((row) => row.beneficiaryId!))];
    const existingLinks = await tx.beneficiaryChronicDrug.findMany({
      where: { beneficiary_id: { in: beneficiaryIds } },
      select: { id: true, beneficiary_id: true, drug_id: true, active: true, notes: true },
    });
    const linkByKey = new Map(existingLinks.map((link) => [`${link.beneficiary_id}:${link.drug_id}`, link]));

    let created = 0;
    let reactivated = 0;
    let updatedNotes = 0;
    const keptKeys = new Set<string>();
    const toCreate: Array<{ beneficiary_id: string; drug_id: string; notes: string | null; sort_order: number }> = [];
    const orderByBeneficiary = new Map<string, number>();
    for (const row of valid) {
      const drugId = drugIdByName.get(row.normalizedDrug)!;
      const key = `${row.beneficiaryId}:${drugId}`;
      keptKeys.add(key);
      const order = (orderByBeneficiary.get(row.beneficiaryId!) ?? 0) + 1;
      orderByBeneficiary.set(row.beneficiaryId!, order);
      const notes = row.notes || null;
      const link = linkByKey.get(key);
      if (!link) {
        toCreate.push({ beneficiary_id: row.beneficiaryId!, drug_id: drugId, notes, sort_order: order });
        created += 1;
      } else if (!link.active || (notes !== null && notes !== link.notes)) {
        await tx.beneficiaryChronicDrug.update({ where: { id: link.id }, data: { active: true, ...(notes !== null ? { notes } : {}), sort_order: order } });
        if (!link.active) reactivated += 1;
        else updatedNotes += 1;
      }
    }
    if (toCreate.length > 0) await tx.beneficiaryChronicDrug.createMany({ data: toCreate, skipDuplicates: true });

    let deactivated = 0;
    if (mode === "REPLACE") {
      const stale = existingLinks.filter((link) => link.active && !keptKeys.has(`${link.beneficiary_id}:${link.drug_id}`)).map((link) => link.id);
      if (stale.length > 0) deactivated = (await tx.beneficiaryChronicDrug.updateMany({ where: { id: { in: stale } }, data: { active: false } })).count;
    }

    await tx.auditLog.create({
      data: {
        facility_id: access.session.id,
        user: access.session.username,
        action: "IMPORT_CHRONIC_DRUGS",
        metadata: { company_id: companyId, mode, rows: upload.results.length, valid: valid.length, created, reactivated, updatedNotes, deactivated, beneficiaries: beneficiaryIds.length },
      },
    });
    return { created, reactivated, updatedNotes, deactivated, beneficiaries: beneficiaryIds.length };
  }, { timeout: 120_000 });

  return { success: true, ...outcome, summary: summarize(upload.results), errorRows: upload.results.filter((row) => row.status === "ERROR").map(publicRow) };
}
