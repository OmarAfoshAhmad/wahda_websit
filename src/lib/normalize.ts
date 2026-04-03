/**
 * normalize.ts — دوال التطبيع المشتركة عبر كل المنظومة.
 *
 * القاعدة الذهبية: أي كود يلمس اسماً أو رقم بطاقة يجب أن يستورد من هنا فقط.
 */

/**
 * تطبيع اسم الشخص: حذف المسافات الزائدة + تحويل لأحرف كبيرة.
 * ضروري: يجب أن تكون كل الأسماء في قاعدة البيانات على هذا الشكل.
 */
export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * تطبيع رقم البطاقة: حذف الفراغات + تحويل لأحرف كبيرة.
 */
export function normalizeCardNumber(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * توحيد رقم البطاقة: إزالة الأصفار غير الضرورية بعد WAB2025.
 * مثال: WAB202500123 → WAB2025123
 */
export function canonicalizeCardNumber(value: string): string {
  const c = normalizeCardNumber(value);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;
  const normalizedDigits = m[1].replace(/^0+/, "") || "0";
  const suffix = m[2] ?? "";
  return `WAB2025${normalizedDigits}${suffix}`;
}

/**
 * عدد الأصفار بعد WAB2025 (يُستخدم في اختيار البطاقة المفضلة للدمج).
 */
export function leadingZeroScoreAfterPrefix(value: string): number {
  const c = normalizeCardNumber(value);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return 0;
  const z = m[1].match(/^0+/);
  return z ? z[0].length : 0;
}

/**
 * مفتاح الشخص المميز: الاسم الطبيعي + تاريخ الميلاد.
 * يُرجع null إذا لم يوجد تاريخ ميلاد.
 */
export function personKey(name: string, birthDate: Date | null): string | null {
  if (!birthDate) return null;
  return `${normalizePersonName(name)}|${birthDate.toISOString().slice(0, 10)}`;
}

/**
 * خريطة رموز اللاحقة (suffix) إلى صلة القرابة.
 * مثال: WAB2025001D1 → D → ابنة
 */
const SUFFIX_RELATIONSHIP_MAP: Record<string, string> = {
  W: "زوجة",
  S: "ابن",
  D: "ابنة",
  M: "أم",
  F: "أب",
  B: "أخ",
};

/**
 * استخراج البطاقة الأساسية (بدون لاحقة العائلة) من رقم البطاقة.
 * مثال: WAB2025001D1 → WAB2025001
 *        WAB2025001   → WAB2025001  (بطاقة أساسية أصلاً)
 */
export function extractBaseCard(card: string): string {
  const c = normalizeCardNumber(card);
  const m = c.match(/^(WAB2025\d+?)([A-Z]\d+)?$/);
  if (!m) return c;
  return m[1];
}

/**
 * استنتاج صلة القرابة من لاحقة رقم البطاقة.
 * - بطاقة أساسية (WAB2025001) → null (رب الأسرة)
 * - بطاقة فرعية (WAB2025001D1) → "ابنة"
 */
export function deriveRelationshipFromCard(card: string): string | null {
  const c = normalizeCardNumber(card);
  const m = c.match(/^WAB2025\d+([A-Z])(\d+)$/);
  if (!m) return null; // بطاقة أساسية = رب الأسرة
  return SUFFIX_RELATIONSHIP_MAP[m[1]] ?? "قريب";
}

/**
 * هل البطاقة أساسية (بدون لاحقة عائلية)؟
 */
export function isBaseCard(card: string): boolean {
  return /^WAB2025\d+$/.test(normalizeCardNumber(card));
}
