import ExcelJS from "exceljs";
import JSZip from "jszip";
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
  { key: "phone", header: "رقم الهاتف", required: false, example: "0912345678" },
  { key: "dispensedAt", header: "تاريخ الصرف", required: false, example: "2026-10-14" },
] as const;

/** dispensedAt: يوم آخر صرف قبل المنظومة {y,m(0-11),d}، أو "invalid" إن تعذرت قراءته. */
export type ChronicImportRow = {
  rowNumber: number; card: string; beneficiaryName: string; drugName: string; notes: string;
  phone: string; dispensedAt: { year: number; month: number; day: number } | "invalid" | null;
};
type ColumnKey = "card" | "beneficiary" | "drug" | "dose" | "frequency" | "notes" | "phone" | "dispensedAt";

// التاريخ في Excel يأتي Date (منتصف ليل UTC لليوم المكتوب)، أو رقمًا تسلسليًا، أو نصًا مثل 14/10/2026 أو 2026-10-14.
function readDay(value: ExcelJS.CellValue): ChronicImportRow["dispensedAt"] {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return { year: value.getUTCFullYear(), month: value.getUTCMonth(), day: value.getUTCDate() };
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400000));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
  }
  const text = cellText(value).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  if (!text) return null;
  let parts = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  let year: number, month: number, day: number;
  if (parts) [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  else if ((parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text))) [day, month, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  else return "invalid";
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "invalid";
  return { year, month: month - 1, day };
}

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
  if (value.includes("هاتف") || value.includes("جوال") || value.includes("موبايل")) return "phone";
  if (value.includes("تاريخ") || value.includes("صرف")) return "dispensedAt";
  if (value.includes("بطاقه") || value.includes("تامين")) return "card";
  if (value.includes("دواء") || value.includes("الادويه") || value.includes("صنف")) return "drug";
  if (value.includes("مستفيد") || value.includes("اسم")) return "beneficiary";
  if (value.includes("جرعه") || value.includes("تركيز")) return "dose";
  if (value.includes("تكرار")) return "frequency";
  if (value.includes("ملاحظ")) return "notes";
  return null;
}

export async function parseChronicImportWorkbook(buffer: Buffer): Promise<{ rows: ChronicImportRow[] } | { error: string }> {
  let workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    // ملفات برامج .NET (OpenXML SDK) تكتب الوسوم ببادئة مثل <x:sheet>، وExcelJS لا يقرؤها.
    // نزيل البادئة ونعيد ترتيب الحزمة بالترتيب القياسي ثم نحاول مرة ثانية.
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await normalizeXlsx(buffer)) as unknown as ArrayBuffer);
    } catch {
      return { error: "تعذرت قراءة الملف. استخدم ملف Excel بصيغة xlsx" };
    }
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
    rows.push({
      rowNumber, card: card ? normalizeCardNumber(card) : "", beneficiaryName: read(columns.beneficiary), drugName, notes,
      phone: read(columns.phone),
      dispensedAt: columns.dispensedAt ? readDay(row.getCell(columns.dispensedAt).value) : null,
    });
  });
  if (rows.length === 0) return { error: "الملف لا يحتوي على صفوف بيانات" };
  if (rows.length > 20000) return { error: "الحد الأقصى 20000 صف في الملف الواحد" };
  return { rows };
}

const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

async function normalizeXlsx(buffer: Buffer) {
  const source = await JSZip.loadAsync(buffer);
  const rank = (name: string) => (name === "[Content_Types].xml" ? 0 : name.startsWith("_rels/") ? 1 : name.includes("/_rels/") ? 2 : 3);
  const names = Object.keys(source.files).filter((name) => !source.files[name].dir).sort((a, b) => rank(a) - rank(b));
  const target = new JSZip();
  for (const name of names) {
    if (!name.startsWith("xl/") || !name.endsWith(".xml")) { target.file(name, await source.files[name].async("uint8array")); continue; }
    let xml = await source.files[name].async("string");
    const prefix = new RegExp(`xmlns:(\\w+)="${SPREADSHEET_NS.replace(/[./]/g, "\\$&")}"`).exec(xml)?.[1];
    if (prefix) xml = xml.replace(new RegExp(`<(/?)${prefix}:`, "g"), "<$1").replace(`xmlns:${prefix}="`, 'xmlns="');
    target.file(name, xml);
  }
  return target.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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
    "رقم الهاتف (اختياري): هاتف الأسرة، يُحفظ لصاحب البطاقة ويُستخدم لرمز الدخول إلى البوابة.",
    "تاريخ الصرف (اختياري): آخر صرف للدواء قبل المنظومة. يُقفل الدواء حتى يمر عليه مدة صرف المزمن في سياسة الشركة، ثم يُفتح تلقائيًا. اتركه فارغًا إن لم يُصرف.",
    "الشركة تُختار في صفحة الاستيراد، ولا تُكتب في الملف.",
    "وضع الإضافة: يضيف الأدوية الجديدة ويبقي الموجودة. وضع الاستبدال: قائمة كل مستفيد في الملف تصبح مطابقة للملف تمامًا.",
    "فقط المستفيد الذي له دواء مرتبط واحد على الأقل يستحق خدمة الأدوية المزمنة.",
  ].forEach((line) => guide.addRow([line]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
