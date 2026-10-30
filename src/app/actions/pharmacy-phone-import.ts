"use server";

import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { normalizeLibyanMobile } from "@/lib/phone";
import { familyCte, familyStatsCache, requirePharmacyStaff } from "@/lib/pharmacy/families";

const MAX_ROWS = 30_000;
const SHOWN_ROWS = 300;

export type PhoneImportStatus = "update" | "same" | "invalid_phone" | "not_found" | "phone_taken" | "duplicate_phone" | "conflict";
type PlannedRow = { row: number; card: string; phone: string; status: PhoneImportStatus; holderId?: string; holderCard?: string; holderName?: string; before?: string | null; note?: string };

/**
 * استيراد هواتف أصحاب البطاقات من Excel بعمودين: «رقم البطاقة» و«الهاتف» (نفس ملف التصدير).
 * بطاقة أي فرد تُطبَّق على صاحب البطاقة في أسرته، لأن الهاتف هاتف الأسرة (وجهة رمز التحقق).
 * apply=false معاينة فقط؛ apply=true يعيد التحقق من الملف نفسه ثم يحدّث صفوف «تحديث» وحدها.
 */
export async function importFamilyPhones(companyId: string, fileBase64: string, apply: boolean) {
  const access = await requirePharmacyStaff(companyId, apply ? "write" : "read");
  if ("error" in access) return { error: access.error };

  let parsed: Array<{ row: number; card: string; phone: string }>;
  try {
    parsed = await readSheet(Buffer.from(fileBase64, "base64"));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "تعذر قراءة الملف" };
  }
  if (parsed.length === 0) return { error: "لا توجد صفوف فيها رقم بطاقة وهاتف" };
  if (parsed.length > MAX_ROWS) return { error: `الملف أكبر من الحد (${MAX_ROWS.toLocaleString("en")} صف)` };

  // صاحب البطاقة لكل بطاقة في الملف، باستعلام واحد.
  const cards = [...new Set(parsed.map((item) => item.card))];
  const holders = await prisma.$queryRaw<Array<{ card: string; holder_id: string; holder_card: string; holder_name: string; holder_phone: string | null }>>`
    WITH ${familyCte(companyId, "")}
    SELECT UPPER(REPLACE(REPLACE(m.card_number, ' ', ''), '-', '')) AS card, h.head_id AS holder_id, h.card_number AS holder_card, h.name AS holder_name, h.phone_number AS holder_phone
    FROM m JOIN h ON h.fam = m.fam
    WHERE UPPER(REPLACE(REPLACE(m.card_number, ' ', ''), '-', '')) = ANY(${cards})
  `;
  const holderOf = new Map(holders.map((item) => [item.card, item]));

  const phones = [...new Set(parsed.map((item) => normalizeLibyanMobile(item.phone)).filter((value): value is string => Boolean(value)))];
  const owners = phones.length === 0 ? [] : await prisma.beneficiary.findMany({ where: { phone_number: { in: phones }, deleted_at: null }, select: { id: true, phone_number: true, card_number: true } });
  const ownerOf = new Map(owners.map((owner) => [owner.phone_number!, owner]));

  // تعارضات داخل الملف: نفس الهاتف لأسرتين، أو نفس الأسرة بهاتفين مختلفين.
  const holdersByPhone = new Map<string, Set<string>>();
  const phonesByHolder = new Map<string, Set<string>>();
  for (const item of parsed) {
    const phone = normalizeLibyanMobile(item.phone);
    const holder = holderOf.get(item.card);
    if (!phone || !holder) continue;
    (holdersByPhone.get(phone) ?? holdersByPhone.set(phone, new Set()).get(phone)!).add(holder.holder_id);
    (phonesByHolder.get(holder.holder_id) ?? phonesByHolder.set(holder.holder_id, new Set()).get(holder.holder_id)!).add(phone);
  }

  const seen = new Set<string>();
  const planned: PlannedRow[] = parsed.map((item) => {
    const holder = holderOf.get(item.card);
    if (!holder) return { ...item, status: "not_found" };
    const base = { ...item, holderId: holder.holder_id, holderCard: holder.holder_card, holderName: holder.holder_name, before: holder.holder_phone };
    const phone = normalizeLibyanMobile(item.phone);
    if (!phone) return { ...base, status: "invalid_phone" };
    if ((phonesByHolder.get(holder.holder_id)?.size ?? 0) > 1) return { ...base, phone, status: "conflict", note: "الأسرة نفسها بأكثر من هاتف في الملف" };
    if ((holdersByPhone.get(phone)?.size ?? 0) > 1) return { ...base, phone, status: "duplicate_phone", note: "الهاتف مكرر لأكثر من أسرة في الملف" };
    const owner = ownerOf.get(phone);
    if (owner && owner.id !== holder.holder_id) return { ...base, phone, status: "phone_taken", note: `مسجل للبطاقة ${owner.card_number}` };
    if (holder.holder_phone === phone || seen.has(holder.holder_id)) return { ...base, phone, status: "same" };
    seen.add(holder.holder_id);
    return { ...base, phone, status: "update" };
  });

  const counts = planned.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {} as Partial<Record<PhoneImportStatus, number>>);
  const updates = planned.filter((item) => item.status === "update");

  if (apply && updates.length > 0) {
    const CHUNK = 500;
    for (let start = 0; start < updates.length; start += CHUNK) {
      const chunk = updates.slice(start, start + CHUNK);
      await prisma.$transaction(chunk.map((item) => prisma.beneficiary.update({ where: { id: item.holderId! }, data: { phone_number: item.phone, failed_attempts: 0, locked_until: null } })));
    }
    await prisma.auditLog.create({
      data: {
        facility_id: access.session.id,
        user: access.session.username,
        action: "BENEFICIARY_PHONE_IMPORT",
        metadata: { company_id: companyId, updated: updates.length, changes: updates.map((item) => ({ card: item.holderCard, before: item.before ?? null, after: item.phone })) },
      },
    });
    familyStatsCache.delete(companyId);
  }

  // للعرض: المشاكل أولًا ثم التحديثات؛ صفوف «بدون تغيير» لا تُعرض.
  const order: PhoneImportStatus[] = ["conflict", "duplicate_phone", "phone_taken", "invalid_phone", "not_found", "update"];
  const shown = planned.filter((item) => item.status !== "same").sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.row - b.row).slice(0, SHOWN_ROWS);
  return { success: true, applied: apply ? updates.length : 0, total: planned.length, counts, rows: shown.map(({ holderId: _holderId, ...item }) => item) };
}

async function readSheet(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- أنواع exceljs لا تقبل Buffer الحديث
  await workbook.xlsx.load(buffer as any);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("الملف لا يحتوي ورقة عمل");
  let cardCol = 0;
  let phoneCol = 0;
  ws.getRow(1).eachCell((cell, col) => {
    const label = String(cell.value ?? "").trim();
    if (!cardCol && label.includes("بطاق")) cardCol = col;
    else if (!phoneCol && (label.includes("هاتف") || label.includes("جوال") || label.includes("موبايل"))) phoneCol = col;
  });
  if (!cardCol || !phoneCol) throw new Error("لم أجد عمودي «رقم البطاقة» و«الهاتف» في الصف الأول");
  const text = (value: ExcelJS.CellValue) => {
    if (value && typeof value === "object" && "text" in value) return String(value.text);
    if (value && typeof value === "object" && "result" in value) return String(value.result ?? "");
    return String(value ?? "");
  };
  const rows: Array<{ row: number; card: string; phone: string }> = [];
  ws.eachRow((row, number) => {
    if (number === 1) return;
    const card = text(row.getCell(cardCol).value).replace(/[\s-]/g, "").toUpperCase();
    // هاتف محفوظ كرقم يفقد الصفر الأول (912345678) — normalizeLibyanMobile يقبله.
    const phone = text(row.getCell(phoneCol).value).trim();
    if (card && phone) rows.push({ row: number, card, phone });
  });
  return rows;
}
