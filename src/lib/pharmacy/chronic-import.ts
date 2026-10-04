import ExcelJS from "exceljs";
import { getArabicNormalization, normalizeCardNumber } from "@/lib/normalize";

/**
 * بنية ملف استيراد الأدوية المزمنة: صف لكل دواء لكل مستفيد.
 * الأعمدة تُعرف من عناوين الصف الأول، فترتيبها غير مهم.
 */
export const CHRONIC_IMPORT_COLUMNS = [
  { key: "card", header: "رقم البطاقة", required: true, example: "WAAD1234" },
  { key: "beneficiary", header: "اسم المستفيد", required: false, example: "محمد علي أحمد" },
  { key: "drug", header: "اسم الدواء", required: true, example: "Metformin" },
  { key: "dose", header: "الجرعة", required: false, example: "500mg" },
  { key: "frequency", header: "التكرار", required: false, example: "1*2" },
  { key: "notes", header: "ملاحظات", required: false, example: "بعد الأكل" },
] as const;

export type ChronicImportRow = { rowNumber: number; card: string; beneficiaryName: string; drugName: string; notes: string };
type ColumnKey = "card" | "beneficiary" | "drug" | "dose" | "frequency" | "notes";

/** اسم الدواء المعتمد للمطابقة: بلا مسافات زائدة، وبأحرف صغيرة، وبهمزات موحدة. */
export function normalizeDrugName(value: string) {
  return getArabicNormalization(value.trim().replace(/\s+/g, " ").toLowerCase());
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("text" in value) return String(value.text ?? "").trim();
  }
  return String(value).trim();
}

// ترتيب الفحص مهم: "اسم الدواء" يحتوي "اسم" فيجب فحص الدواء قبل المستفيد.
function matchHeader(text: string): ColumnKey | null {
  const value = getArabicNormalization(text);
  if (value.includes("بطاقه") || value.includes("تامين")) return "card";
  if (value.includes("دواء") || value.includes("الادويه") || value.includes("صنف")) return "drug";
  if (value.includes("مستفيد") || value.includes("اسم")) return "beneficiary";
  if (value.includes("جرعه") || value.includes("تركيز")) return "dose";
  if (value.includes("تكرار")) return "frequency";
  if (value.includes("ملاحظ")) return "notes";
  return null;
}

export async function parseChronicImportWorkbook(buffer: Buffer): Promise<{ rows: ChronicImportRow[] } | { error: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { error: "تعذرت قراءة الملف. استخدم ملف Excel بصيغة xlsx" };
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { error: "الملف لا يحتوي على ورقة عمل" };

  const columns: Partial<Record<ColumnKey, number>> = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const key = matchHeader(cellText(cell.value));
    if (key && columns[key] === undefined) columns[key] = colNumber;
  });
  if (!columns.card || !columns.drug) return { error: "يجب أن يحتوي الصف الأول على عمودي \"رقم البطاقة\" و\"اسم الدواء\"" };

  const rows: ChronicImportRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const read = (column?: number) => (column ? cellText(row.getCell(column).value) : "");
    const card = read(columns.card);
    // الجرعة جزء من هوية الدواء: نفس الدواء بتركيزين (adalat 30mg و60mg) دواءان مختلفان،
    // ولكل منهما دورة صرف مستقلة.
    const baseDrug = read(columns.drug).replace(/\s+/g, " ");
    const dose = read(columns.dose).replace(/\s+/g, " ");
    const drugName = baseDrug && dose && !baseDrug.toLowerCase().includes(dose.toLowerCase()) ? `${baseDrug} ${dose}` : baseDrug;
    if (!drugName && !card) return;
        // التكرار والملاحظات تُحفظ في ملاحظات الربط لتظهر للصيدلي عند الصرف.
    const notes = [read(columns.frequency), read(columns.notes)].filter(Boolean).join(" | ");
    rows.push({ rowNumber, card: card ? normalizeCardNumber(card) : "", beneficiaryName: read(columns.beneficiary), drugName, notes });
  });
  if (rows.length === 0) return { error: "الملف لا يحتوي على صفوف بيانات" };
  if (rows.length > 20000) return { error: "الحد الأقصى 20000 صف في الملف الواحد" };
  return { rows };
}

export async function buildChronicImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("الأدوية المزمنة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  sheet.columns = CHRONIC_IMPORT_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.key === "drug" ? 32 : 24 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(Object.fromEntries(CHRONIC_IMPORT_COLUMNS.map((column) => [column.key, column.example])));
  sheet.addRow({ card: "WAAD1234", beneficiary: "محمد علي أحمد", drug: "Amlodipine", dose: "5mg", frequency: "1*1", notes: "" });

  const guide = workbook.addWorksheet("تعليمات", { views: [{ rightToLeft: true }] });
  guide.getColumn(1).width = 90;
  [
    "صف واحد لكل دواء لكل مستفيد. المستفيد الذي له 3 أدوية يأخذ 3 صفوف بنفس رقم البطاقة.",
    "الأعمدة الإلزامية: اسم الدواء، ورقم البطاقة أو اسم المستفيد. إن لم توجد البطاقة يُطابق المستفيد بالاسم الكامل إذا كان فريدًا في الشركة (مع تنبيه).",
    "الجرعة تُضاف إلى اسم الدواء (نفس الدواء بجرعتين يُعد دواءين). التكرار والملاحظات اختيارية وتظهر للصيدلي عند الصرف.",
    "اكتب اسم الدواء بنفس الصيغة دائمًا (مثل Metformin 500mg) حتى لا يُسجَّل الدواء نفسه باسمين.",
    "الشركة تُختار في صفحة الاستيراد، ولا تُكتب في الملف.",
    "وضع الإضافة: يضيف الأدوية الجديدة ويبقي الموجودة. وضع الاستبدال: قائمة كل مستفيد في الملف تصبح مطابقة للملف تمامًا.",
    "فقط المستفيد الذي له دواء مرتبط واحد على الأقل يستحق خدمة الأدوية المزمنة.",
  ].forEach((line) => guide.addRow([line]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
