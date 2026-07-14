const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => {
    const idxArabicIndic = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (idxArabicIndic >= 0) return String(idxArabicIndic);

    const idxEasternArabic = EASTERN_ARABIC_DIGITS.indexOf(ch);
    if (idxEasternArabic >= 0) return String(idxEasternArabic);

    return ch;
  });
}

export function normalizeCardInput(value: string): string {
  // نحذف المحارف الخفية الشائعة من النسخ (RTL/LTR marks)
  const withoutDirectionMarks = value.replace(/[\u200E\u200F\u202A-\u202E]/g, "");
  return toAsciiDigits(withoutDirectionMarks).trim().toUpperCase();
}
