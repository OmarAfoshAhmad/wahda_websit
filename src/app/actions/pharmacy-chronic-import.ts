"use server";

import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { getArabicNormalization } from "@/lib/normalize";
import { buildChronicImportTemplate, normalizeDrugName, parseChronicImportWorkbook, type ChronicImportRow } from "@/lib/pharmacy/chronic-import";
import { familyCte, familyStatsCache } from "@/lib/pharmacy/families";
import { loadPharmacyPolicy } from "@/lib/pharmacy/summary";
import { getNextChronicEligibleDate, getTripoliDayWindow, tripoliMidnight } from "@/lib/pharmacy/policy";
import { normalizeLibyanMobile } from "@/lib/phone";

export type ChronicImportMode = "ADD" | "REPLACE";
export type ChronicImportRowResult = {
  rowNumber: number;
  card: string;
  beneficiaryName: string;
  drugName: string;
  notes: string;
  status: "NEW" | "EXISTING" | "DUPLICATE" | "ERROR";
  message: string | null;
  warning: string | null;
  /** الهاتف بعد التوحيد، وما سيحدث له: يُحفظ لصاحب البطاقة، أو لا تغيير، أو يُتجاهل مع السبب. */
  phone: string;
  phoneAction: "SET" | "SAME" | "SKIP" | null;
  phoneNote: string | null;
  /** يوم آخر صرف قبل المنظومة (YYYY-MM-DD) وأول يوم يُسمح فيه بالصرف بعده. */
  dispensedOn: string | null;
  nextEligibleOn: string | null;
  dispenseNote: string | null;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function requireImportAccess(companyId: string) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !hasPermission(session, "manage_pharmacy_chronic")) return { error: "غير مصرح: يتطلب صلاحية إدارة الأدوية المزمنة" } as const;
  try {
    await assertCompanyAccessForSession(session, companyId);
  } catch {
    return { error: "لا تملك صلاحية الوصول إلى هذه الشركة" } as const;
  }
  return { session } as const;
}

export async function downloadChronicImportTemplate() {
  const session = await getSessionWithFreshPermissions();
  if (!session || !hasPermission(session, "manage_pharmacy_chronic")) return { error: "غير مصرح" };
  return { fileName: "قالب_استيراد_الأدوية_المزمنة.xlsx", base64: (await buildChronicImportTemplate()).toString("base64") };
}

// مفتاح مقارنة الأسماء: توحيد الهمزات والتاء المربوطة والياء، وحذف المسافات ("عبد الله" = "عبدالله").
const nameKey = (value: string) => getArabicNormalization(value.toUpperCase()).replace(/ى/g, "ي").replace(/\s+/g, "");

// البطاقة المختصرة في الكتيبات: أرقام العائلة + رمز الصلة، مثل 24801F وهي JMR202524801F1 في المنظومة.
const SHORT_CARD = /^(\d{2,6})([A-Z]{1,2})?(\d{0,2})$/;

/** يفحص كل صف مقابل بيانات الشركة دون أي كتابة. يُستخدم للمعاينة وللتنفيذ معًا حتى لا تختلف النتيجة. */
async function analyzeRows(companyId: string, rows: ChronicImportRow[]) {
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { company_id: companyId, deleted_at: null },
    select: { id: true, card_number: true, name: true, chronic_drugs: { select: { active: true, drug: { select: { normalized_name: true } } } } },
  });
  type Candidate = (typeof beneficiaries)[number];
  const byCard = new Map(beneficiaries.map((beneficiary) => [beneficiary.card_number, beneficiary]));
  const byName = new Map<string, Candidate[]>();
  for (const beneficiary of beneficiaries) {
    const key = nameKey(beneficiary.name);
    byName.set(key, [...(byName.get(key) ?? []), beneficiary]);
  }

  const matchShortCard = (card: string, pool: Candidate[]) => {
    const parts = SHORT_CARD.exec(card);
    if (!parts) return [];
    const [, digits, relation = "", index = ""] = parts;
    const suffix = new RegExp(`${digits}${relation}${index || "\\d*"}$`);
    return pool.filter((candidate) => suffix.test(candidate.card_number));
  };

  const resolve = (row: ChronicImportRow): { beneficiary?: Candidate; via?: string; error?: string } => {
    const exact = row.card ? byCard.get(row.card) : undefined;
    if (exact) return { beneficiary: exact };
    const named = row.beneficiaryName ? byName.get(nameKey(row.beneficiaryName)) ?? [] : [];
    if (named.length === 1) return { beneficiary: named[0], via: "الاسم" };
    if (named.length > 1) {
      const narrowed = row.card ? matchShortCard(row.card, named) : [];
      if (narrowed.length === 1) return { beneficiary: narrowed[0], via: "الاسم ورقم البطاقة" };
      return { error: `الاسم مكرر لدى ${named.length} مستفيدين ولم يحسمه رقم البطاقة` };
    }
    const byShort = row.card ? matchShortCard(row.card, beneficiaries) : [];
    if (byShort.length === 1) return { beneficiary: byShort[0], via: "رقم البطاقة المختصر" };
    if (byShort.length > 1) return { error: `رقم البطاقة المختصر يطابق ${byShort.length} بطاقات ولم يطابق الاسم` };
    return { error: row.card ? "رقم البطاقة غير موجود ضمن الشركة ولم يُطابق الاسم" : "لا يوجد رقم بطاقة ولم يُطابق الاسم" };
  };

  const policy = await loadPharmacyPolicy(prisma, companyId);
  const intervalDays = policy?.pharmacy_config?.chronic_interval_days ?? 28;
  const today = getTripoliDayWindow(new Date()).start;
  const dayText = (date: Date) => new Date(date.getTime() + 2 * 3600_000).toISOString().slice(0, 10);

  const seen = new Set<string>();
  const results: Array<ChronicImportRowResult & { beneficiaryId: string | null; normalizedDrug: string; dispensedDate: Date | null }> = rows.map((row) => {
    const normalizedDrug = normalizeDrugName(row.drugName);
    // تاريخ الصرف: يقفل الدواء حتى (التاريخ + مدة الصرف في سياسة الشركة).
    let dispensedDate: Date | null = null;
    let dispenseNote: string | null = null;
    if (row.dispensedAt === "invalid") dispenseNote = "تاريخ الصرف غير مفهوم، يُتجاهل";
    else if (row.dispensedAt) {
      const { year, month, day } = row.dispensedAt;
      const date = tripoliMidnight(year, month, day);
      // تاريخ مستقبلي يصبح ماضيًا بتبديل اليوم والشهر = كُتب شهر/يوم بالخطأ (10/12 تعني 12 أكتوبر).
      const swapped = day <= 12 ? tripoliMidnight(year, day - 1, month + 1) : null;
      if (date <= today) dispensedDate = date;
      else if (swapped && swapped <= today) {
        dispensedDate = swapped;
        dispenseNote = `التاريخ كان في المستقبل فاعتُبر مقلوبًا بين اليوم والشهر: ${dayText(swapped).split("-").reverse().join("/")}`;
      } else dispenseNote = "تاريخ الصرف في المستقبل، يُتجاهل";
    }
    const next = dispensedDate ? getNextChronicEligibleDate(dispensedDate, intervalDays) : null;
    const base = {
      ...row, beneficiaryId: null as string | null, normalizedDrug, warning: null as string | null,
      phone: row.phone, phoneAction: null as ChronicImportRowResult["phoneAction"], phoneNote: null as string | null,
      dispensedDate, dispensedOn: dispensedDate ? dayText(dispensedDate) : null, nextEligibleOn: next ? dayText(next) : null, dispenseNote,
    };
    if (!row.drugName) return { ...base, status: "ERROR" as const, message: "اسم الدواء فارغ" };
    // رقم فقط في عمود الدواء يعني غالبًا أن الملف ملخص (مثل عمود "عدد الأدوية") وليس قائمة أدوية.
    if (/^[\d\s.,٠-٩]+$/.test(row.drugName)) return { ...base, status: "ERROR" as const, message: "اسم الدواء رقم فقط؛ تأكد أن العمود يحتوي أسماء الأدوية وليس عددها" };
    if (row.drugName.length > 200) return { ...base, status: "ERROR" as const, message: "اسم الدواء أطول من 200 حرف" };
    const { beneficiary, via, error } = resolve(row);
    if (!beneficiary) return { ...base, status: "ERROR" as const, message: error ?? "تعذرت المطابقة" };
    const key = `${beneficiary.id}:${normalizedDrug}`;
    if (seen.has(key)) return { ...base, beneficiaryId: beneficiary.id, status: "DUPLICATE" as const, message: null, warning: "مكرر في الملف: نفس الدواء لنفس المستفيد، يُتجاهل" };
    seen.add(key);
    const warning = via
      ? `طوبق عبر ${via}: ${beneficiary.name} (${beneficiary.card_number})`
      : row.beneficiaryName && nameKey(row.beneficiaryName) !== nameKey(beneficiary.name) ? `الاسم في المنظومة: ${beneficiary.name}` : null;
    const existing = beneficiary.chronic_drugs.some((link) => link.active && link.drug.normalized_name === normalizedDrug);
    return { ...base, beneficiaryId: beneficiary.id, warning, status: existing ? "EXISTING" as const : "NEW" as const, message: null };
  });
  await planPhones(companyId, results);
  return { results, intervalDays };
}

/**
 * الهاتف هاتف الأسرة: يُحفظ لصاحب البطاقة (مثل استيراد الهواتف). يُتجاهل إن كان غير صحيح،
 * أو للأسرة نفسها أكثر من هاتف في الملف، أو الهاتف لأسرة أخرى (في الملف أو في المنظومة).
 */
async function planPhones(companyId: string, results: Array<ChronicImportRowResult & { beneficiaryId: string | null }>) {
  const withPhone = results.filter((row) => row.phone && row.beneficiaryId && row.status !== "ERROR");
  if (withPhone.length === 0) return;
  const ids = [...new Set(withPhone.map((row) => row.beneficiaryId!))];
  const holders = await prisma.$queryRaw<Array<{ id: string; holder_id: string; holder_card: string; holder_phone: string | null }>>`
    WITH ${familyCte(companyId, "")}
    SELECT m.id, h.head_id AS holder_id, h.card_number AS holder_card, h.phone_number AS holder_phone
    FROM m JOIN h ON h.fam = m.fam WHERE m.id = ANY(${ids})
  `;
  const holderOf = new Map(holders.map((item) => [item.id, item]));
  const phonesByHolder = new Map<string, Set<string>>();
  const holdersByPhone = new Map<string, Set<string>>();
  for (const row of withPhone) {
    const phone = normalizeLibyanMobile(row.phone);
    const holder = holderOf.get(row.beneficiaryId!);
    if (!phone || !holder) continue;
    (phonesByHolder.get(holder.holder_id) ?? phonesByHolder.set(holder.holder_id, new Set()).get(holder.holder_id)!).add(phone);
    (holdersByPhone.get(phone) ?? holdersByPhone.set(phone, new Set()).get(phone)!).add(holder.holder_id);
  }
  const owners = await prisma.beneficiary.findMany({ where: { phone_number: { in: [...holdersByPhone.keys()] }, deleted_at: null }, select: { id: true, phone_number: true, card_number: true } });
  const ownerOf = new Map(owners.map((owner) => [owner.phone_number!, owner]));
  for (const row of withPhone) {
    const holder = holderOf.get(row.beneficiaryId!);
    const phone = normalizeLibyanMobile(row.phone);
    const skip = (note: string) => { row.phoneAction = "SKIP"; row.phoneNote = note; };
    if (!holder) skip("لم يُعرف صاحب البطاقة");
    else if (!phone) skip("هاتف غير صحيح");
    else if ((phonesByHolder.get(holder.holder_id)?.size ?? 0) > 1) skip("للأسرة أكثر من هاتف في الملف");
    else if ((holdersByPhone.get(phone)?.size ?? 0) > 1) skip("الهاتف نفسه لأكثر من أسرة في الملف");
    else if (ownerOf.get(phone) && ownerOf.get(phone)!.id !== holder.holder_id) skip(`مسجل للبطاقة ${ownerOf.get(phone)!.card_number}`);
    else {
      row.phone = phone;
      row.phoneAction = holder.holder_phone === phone ? "SAME" : "SET";
      row.phoneNote = holder.holder_phone === phone ? null : `يُحفظ لصاحب البطاقة ${holder.holder_card}${holder.holder_phone ? ` بدل ${holder.holder_phone}` : ""}`;
    }
  }
}

async function readUpload(companyId: string, fileBase64: string) {
  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length === 0) return { error: "اختر ملف Excel" } as const;
  if (buffer.length > MAX_FILE_BYTES) return { error: "حجم الملف يجب ألا يتجاوز 10 ميجابايت" } as const;
  const parsed = await parseChronicImportWorkbook(buffer);
  if ("error" in parsed) return { error: parsed.error } as const;
  return await analyzeRows(companyId, parsed.rows);
}

function summarize(results: ChronicImportRowResult[], intervalDays: number) {
  const valid = results.filter((row) => row.status === "NEW" || row.status === "EXISTING");
  const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
  return {
    intervalDays,
    dispenseDated: valid.filter((row) => row.dispensedOn).length,
    lockedNow: valid.filter((row) => row.nextEligibleOn && row.nextEligibleOn > today).length,
    dispenseIgnored: valid.filter((row) => row.dispenseNote).length, // تُعرض ضمن «تنبيهات»: متجاهَل أو مصحَّح
    phoneSet: new Set(results.filter((row) => row.phoneAction === "SET").map((row) => row.phone)).size,
    phoneSkipped: results.filter((row) => row.phoneAction === "SKIP").length,
    total: results.length,
    newCount: results.filter((row) => row.status === "NEW").length,
    existingCount: results.filter((row) => row.status === "EXISTING").length,
    errorCount: results.filter((row) => row.status === "ERROR").length,
    duplicateCount: results.filter((row) => row.status === "DUPLICATE").length,
    warningCount: results.filter((row) => row.warning).length,
    beneficiaryCount: new Set(results.filter((row) => row.status === "NEW" || row.status === "EXISTING").map((row) => (row as { beneficiaryId?: string | null }).beneficiaryId ?? row.card)).size,
  };
}

const publicRow = ({ rowNumber, card, beneficiaryName, drugName, notes, status, message, warning, phone, phoneAction, phoneNote, dispensedOn, nextEligibleOn, dispenseNote }: ChronicImportRowResult): ChronicImportRowResult =>
  ({ rowNumber, card, beneficiaryName, drugName, notes, status, message, warning, phone, phoneAction, phoneNote, dispensedOn, nextEligibleOn, dispenseNote });

export async function previewChronicDrugImport(companyId: string, fileBase64: string) {
  const access = await requireImportAccess(companyId);
  if ("error" in access) return { error: access.error };
  const upload = await readUpload(companyId, fileBase64);
  if ("error" in upload) return { error: upload.error };
  return { summary: summarize(upload.results, upload.intervalDays), rows: upload.results.map(publicRow) };
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
  const valid = upload.results.filter((row) => (row.status === "NEW" || row.status === "EXISTING") && row.beneficiaryId);
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
      select: { id: true, beneficiary_id: true, drug_id: true, active: true, notes: true, imported_last_dispensed_at: true },
    });
    const linkByKey = new Map(existingLinks.map((link) => [`${link.beneficiary_id}:${link.drug_id}`, link]));

    let created = 0;
    let reactivated = 0;
    let updatedNotes = 0;
    let datedDispenses = 0;
    const keptKeys = new Set<string>();
    const toCreate: Array<{ beneficiary_id: string; drug_id: string; notes: string | null; sort_order: number; imported_last_dispensed_at: Date | null }> = [];
    const orderByBeneficiary = new Map<string, number>();
    for (const row of valid) {
      const drugId = drugIdByName.get(row.normalizedDrug)!;
      const key = `${row.beneficiaryId}:${drugId}`;
      keptKeys.add(key);
      const order = (orderByBeneficiary.get(row.beneficiaryId!) ?? 0) + 1;
      orderByBeneficiary.set(row.beneficiaryId!, order);
      const notes = row.notes || null;
      const link = linkByKey.get(key);
      // تاريخ الصرف في الملف يحل محل المستورد سابقًا؛ الفارغ يبقي القديم.
      const dated = row.dispensedDate;
      if (dated) datedDispenses += 1;
      if (!link) {
        toCreate.push({ beneficiary_id: row.beneficiaryId!, drug_id: drugId, notes, sort_order: order, imported_last_dispensed_at: dated });
        created += 1;
      } else if (!link.active || (notes !== null && notes !== link.notes) || (dated && dated.getTime() !== link.imported_last_dispensed_at?.getTime())) {
        await tx.beneficiaryChronicDrug.update({ where: { id: link.id }, data: { active: true, ...(notes !== null ? { notes } : {}), ...(dated ? { imported_last_dispensed_at: dated } : {}), sort_order: order } });
        if (!link.active) reactivated += 1;
        else if (notes !== null && notes !== link.notes) updatedNotes += 1;
      }
    }
    if (toCreate.length > 0) await tx.beneficiaryChronicDrug.createMany({ data: toCreate, skipDuplicates: true });

    let deactivated = 0;
    if (mode === "REPLACE") {
      const stale = existingLinks.filter((link) => link.active && !keptKeys.has(`${link.beneficiary_id}:${link.drug_id}`)).map((link) => link.id);
      if (stale.length > 0) deactivated = (await tx.beneficiaryChronicDrug.updateMany({ where: { id: { in: stale } }, data: { active: false } })).count;
    }

    // الهواتف: سطر واحد لكل صاحب بطاقة (planPhones ضمن أن للأسرة هاتفًا واحدًا في الملف).
    const phoneChanges = new Map<string, { phone: string; holderId: string }>();
    const holderRows = await tx.$queryRaw<Array<{ id: string; holder_id: string; holder_card: string; holder_phone: string | null }>>`
      WITH ${familyCte(companyId, "")}
      SELECT m.id, h.head_id AS holder_id, h.card_number AS holder_card, h.phone_number AS holder_phone FROM m JOIN h ON h.fam = m.fam
      WHERE m.id = ANY(${[...new Set(upload.results.filter((row) => row.phoneAction === "SET").map((row) => row.beneficiaryId!))]})
    `;
    const holderOf = new Map(holderRows.map((item) => [item.id, item]));
    for (const row of upload.results) {
      const holder = row.phoneAction === "SET" ? holderOf.get(row.beneficiaryId!) : undefined;
      if (holder) phoneChanges.set(holder.holder_card, { phone: row.phone, holderId: holder.holder_id });
    }
    const phoneAudit = holderRows.length === 0 ? [] : [...phoneChanges].map(([card, change]) => ({ card, before: holderRows.find((item) => item.holder_id === change.holderId)?.holder_phone ?? null, after: change.phone }));
    for (const change of phoneChanges.values()) {
      await tx.beneficiary.update({ where: { id: change.holderId }, data: { phone_number: change.phone, failed_attempts: 0, locked_until: null } });
    }

    await tx.auditLog.create({
      data: {
        facility_id: access.session.id,
        user: access.session.username,
        action: "IMPORT_CHRONIC_DRUGS",
        metadata: { company_id: companyId, mode, rows: upload.results.length, valid: valid.length, created, reactivated, updatedNotes, deactivated, datedDispenses, beneficiaries: beneficiaryIds.length, phones: phoneAudit },
      },
    });
    return { created, reactivated, updatedNotes, deactivated, datedDispenses, phonesUpdated: phoneChanges.size, beneficiaries: beneficiaryIds.length };
  }, { timeout: 120_000 });
  familyStatsCache.delete(companyId);

  return { success: true, ...outcome, summary: summarize(upload.results, upload.intervalDays), errorRows: upload.results.filter((row) => row.status === "ERROR").map(publicRow) };
}
