/**
 * دوال نقية مشتركة بين واجهة استيراد ترقيم البطاقات وبين إجراءات الخادم.
 * منفصلة هنا لتكون قابلة للاختبار ولضمان أن العميل والخادم ينظّفان البيانات بنفس الطريقة.
 */

// محارف اتجاهية وصفرية العرض يضيفها الإكسيل ولا تُرى، لكنها تُفشل كل مقارنة نصية
const INVISIBLE_CHARS = /[​-‏‪-‮⁦-⁩﻿]/g;
// التطويل والتشكيل
const TATWEEL_AND_DIACRITICS = /[ـً-ْٰ]/g;
// الأرقام العربية-الهندية والفارسية
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

const toAsciiDigit = (ch: string) => {
  const code = ch.charCodeAt(0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
  return ch;
};

/** تنظيف أي قيمة نصية قادمة من ملف إكسيل قبل تخزينها أو مقارنتها. */
export const cleanImportText = (value: unknown): string =>
  String(value ?? "")
    .replace(INVISIBLE_CHARS, "")
    .replace(TATWEEL_AND_DIACRITICS, "")
    .replace(ARABIC_INDIC_DIGITS, toAsciiDigit)
    .replace(/\s+/g, " ")
    .trim();

/** تهريب المحارف الخاصة قبل استخدام نص (مثل بادئة مُدخلة من المستخدم) داخل تعبير نمطي. */
export const escapeRegex = (value: string): string =>
  String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, m => "\\" + m);

/** توحيد الاسم العربي لأغراض المطابقة فقط (لا يُخزَّن الناتج). */
export const normalizeArabicName = (value: unknown): string =>
  cleanImportText(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");

/** يحدد صف رؤوس جدول الترقيم عند وجود عنوان أو صفوف تمهيدية قبله. */
export const findCardNumberingHeaderRowIndex = (rows: unknown[][]): number =>
  rows.findIndex((row) => {
    const cells = row.map((value) => cleanImportText(value).toLowerCase());
    const hasEmployeeNumber = cells.some((cell) =>
      cell.includes("وظيف") ||
      cell === "رقم الموظف" ||
      cell === "employee number" ||
      cell === "empno"
    );
    const hasName = cells.some((cell) =>
      cell === "الاسم" ||
      cell === "الأسم" ||
      cell === "الإسم" ||
      cell.includes("اسم الموظف") ||
      cell === "name"
    );
    return hasEmployeeNumber && hasName;
  });

/**
 * خريطة صلة القرابة: تغطي "ال" التعريف والهمزات والتاء المربوطة والإنجليزية،
 * وتُرجع مصطلحاً موحّداً تعرفه خريطة الرموز في الخادم.
 */
export const REL_TERM_MAP: Record<string, string> = {
  "زوجة": "زوجة", "زوجه": "زوجة", "الزوجة": "زوجة", "الزوجه": "زوجة", "حرم": "زوجة", "حرمه": "زوجة", "زوجته": "زوجة",
  "زوج": "زوج", "الزوج": "زوج",
  "ابن": "ابن", "الابن": "ابن", "إبن": "ابن", "الإبن": "ابن", "أبن": "ابن", "الأبن": "ابن", "ولد": "ابن", "الولد": "ابن", "نجل": "ابن", "النجل": "ابن",
  "ابنة": "ابنة", "الابنة": "ابنة", "إبنة": "ابنة", "الإبنة": "ابنة", "أبنة": "ابنة", "الأبنة": "ابنة", "ابنته": "ابنة",
  "بنت": "ابنة", "البنت": "ابنة", "بنته": "ابنة", "كريمة": "ابنة", "الكريمة": "ابنة", "كريمته": "ابنة",
  "ابنه": "ابنة", "الابنه": "ابنة", "إبنه": "ابنة", "الإبنه": "ابنة", "أبنه": "ابنة", "الأبنه": "ابنة", "ابه": "ابنة",
  "ام": "ام", "أم": "ام", "الام": "ام", "الأم": "ام", "والدة": "ام", "والده": "ام", "الوالدة": "ام", "الوالده": "ام", "والدته": "ام", "امه": "ام", "أمه": "ام",
  "اب": "اب", "أب": "اب", "الاب": "اب", "الأب": "اب", "والد": "اب", "الوالد": "اب", "والدي": "اب", "ابيه": "اب", "أبيه": "اب",
  "موظف": "موظف", "موظفة": "موظف", "موظفه": "موظف", "الموظف": "موظف", "الموظفة": "موظف", "الموظفه": "موظف",
  "رب الأسرة": "موظف", "رب الاسرة": "موظف", "رب الاسره": "موظف", "رب العائلة": "موظف", "رب العائله": "موظف",
  "صاحب البطاقة": "موظف", "صاحب البطاقه": "موظف", "رئيسي": "موظف", "الرئيسي": "موظف",
  "عضو": "موظف", "عضو جمارك": "موظف", "عضو الجمارك": "موظف",
  "employee": "موظف", "main": "موظف", "wife": "زوجة", "husband": "زوج",
  "son": "ابن", "daughter": "ابنة", "mother": "ام", "father": "اب",
};

/** يُرجع المصطلح الموحّد لصلة القرابة، أو "" إن لم تُعرف القيمة. */
export const lookupRelTerm = (value: unknown): string => {
  const t = cleanImportText(String(value ?? "").replace(/[()[\]]/g, " "));
  return REL_TERM_MAP[t] || REL_TERM_MAP[t.toLowerCase()] || "";
};

/** تحليل نص تاريخ إلى (سنة/شهر/يوم) بصيغة سنة-شهر-يوم أو يوم-شهر-سنة. */
export const parseDateParts = (value: string | undefined | null): { y: number; m: number; d: number } | null => {
  const parts = cleanImportText(value).split(/[-\/.]/).map(p => p.trim()).filter(Boolean);
  if (parts.length !== 3 || parts.some(p => !/^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  if (parts[0].length === 4) return { y: a, m: b, d: c };
  if (parts[2].length === 4) return { y: c, m: b, d: a };
  return null;
};

/** أقصى سنة ميلاد مقبولة — يمنع تسرّب سنوات مستقبلية من الملفات. */
export const maxBirthYear = () => new Date().getFullYear();

/**
 * تحويل قيمة خلية إلى تاريخ YYYY-MM-DD مع الاحتفاظ بالنص كما ورد بالملف.
 * يميّز ثلاث حالات: تاريخ حقيقي، تسلسل إكسيل، و«سنة ميلاد فقط» (1900..السنة الحالية)
 * التي كانت تُفسَّر خطأً كتسلسل إكسيل فتنتج تواريخ في 1905.
 */
export const parseCellDate = (raw: unknown): { bDate: string; originalDate: string } => {
  if (raw instanceof Date) {
    const v = `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
    return { bDate: v, originalDate: v };
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // سنة ميلاد مكتوبة كرقم مجرّد وليست تسلسل تاريخ
    if (Number.isInteger(raw) && raw >= 1900 && raw <= maxBirthYear()) {
      return { bDate: `${raw}-01-01`, originalDate: String(raw) };
    }
    if (raw < 1000 || raw > 80000) return { bDate: "", originalDate: "" };
    const date = new Date(Math.round((raw - 25569) * 86400 * 1000));
    const v = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return { bDate: v, originalDate: v };
  }

  // إزالة المحارف غير المرئية أولاً، ثم كل ما ليس رقماً أو فاصل تاريخ
  const strDate = cleanImportText(raw).replace(/[^\d\/\-.]/g, "").trim();

  // سنة فقط كنص
  if (/^\d{4}$/.test(strDate)) {
    const y = Number(strDate);
    if (y >= 1900 && y <= maxBirthYear()) return { bDate: `${y}-01-01`, originalDate: strDate };
  }

  const parts = parseDateParts(strDate);
  if (parts) {
    return {
      bDate: `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`,
      originalDate: strDate,
    };
  }

  return { bDate: strDate, originalDate: strDate };
};
