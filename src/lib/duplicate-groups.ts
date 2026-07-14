/**
 * duplicate-groups.ts — منطق كشف وتجميع التكرارات.
 *
 * يعتمد على normalizePersonName الموحدة من @/lib/normalize.
 * BeneficiaryRow يتضمن birth_date الآن لتصفية الإيجابيات الكاذبة.
 */
import { normalizePersonName, normalizeCardNumber, canonicalizeCardNumber, leadingZeroScoreAfterPrefix } from "@/lib/normalize";

/**
 * نوع صف المستفيد المستخدم داخل نافذة التكرارات.
 * birth_date مطلوب لتصفية الحالات الحقيقية عن الإيجابيات الكاذبة.
 */
type BeneficiaryRow = {
  id: string;
  name: string;
  card_number: string;
  birth_date: Date | null;
  relationship?: string | null;
  head_of_household?: string | null;
  status: string;
  // FIX DATA-05: تغيير unknown إلى نوع صريح يضمن سلامة التحويلات العددية
  total_balance: number | string | { toString(): string };
  remaining_balance: number | string | { toString(): string };
  _count?: { transactions: number };
};

export type ZeroVariantGroup = {
  canonical: string;
  members: BeneficiaryRow[];
  preferredId: string;
  preferredCard: string;
};

export type NeedsReviewZeroVariantGroup = {
  canonical: string;
  members: BeneficiaryRow[];
  preferredId: string;
  preferredCard: string;
};

export type SameNameGroup = {
  nameKey: string;
  members: BeneficiaryRow[];
  cardCount: number;
  preferredId: string;
  preferredCard: string;
  /** true إذا كان الأعضاء لديهم تواريخ ميلاد مختلفة صريحة — قد يكونون أشخاصاً مختلفين */
  hasBirthDateConflict: boolean;
};

// الدوال المستوردة مباشرة من المكتبة الموحدة — aliases للاستخدام الداخلي
const normalizeName = normalizePersonName;
const canonicalCard = canonicalizeCardNumber;
const zeroScoreAfterPrefix = leadingZeroScoreAfterPrefix;

// تصدير Aliases للمستوردين الخارجيين
export { normalizePersonName as normalizeName, canonicalizeCardNumber as canonicalCard, leadingZeroScoreAfterPrefix as zeroScoreAfterPrefix } from "@/lib/normalize";

function cardShapeScore(value: string): number {
  const v = normalizeCardNumber(value);
  if (!v) return -10;

  let score = 0;
  if (/^WAB2025\d+[A-Z0-9]*$/.test(v)) score += 50;
  if (/^WAB2025/.test(v)) score += 10;
  if (/\[OBJECT OBJECT\]|UNDEFINED|NULL|NAN/.test(v)) score -= 80;
  if (/[^A-Z0-9]/.test(v.replace(/\s+/g, ""))) score -= 5;
  if (v.length > 8 && v.length < 24) score += 5;
  return score;
}

export function buildDuplicateGroups(rows: BeneficiaryRow[], rawQuery?: string) {
  const query = normalizeCardNumber(rawQuery ?? "");

  // ── تجميع 1: اختلاف الأصفار (نفس البطاقة المعيارية) ──
  const byCanonical = new Map<string, BeneficiaryRow[]>();
  for (const r of rows) {
    const key = canonicalCard(r.card_number);
    const arr = byCanonical.get(key) ?? [];
    arr.push(r);
    byCanonical.set(key, arr);
  }

  const zeroVariantGroupsRaw: (ZeroVariantGroup & { _nameMismatch: boolean })[] = [];

  for (const [canonical, members] of byCanonical.entries()) {
    const uniqueCards = new Set(members.map((m) => normalizeCardNumber(m.card_number)));
    const uniqueNames = new Set(members.map((m) => normalizeName(m.name)));
    if (members.length <= 1 || uniqueCards.size <= 1) continue;

    const preferred = [...members].sort((a, b) => {
      const z = zeroScoreAfterPrefix(b.card_number) - zeroScoreAfterPrefix(a.card_number);
      if (z !== 0) return z;
      return a.card_number.localeCompare(b.card_number);
    })[0];

    zeroVariantGroupsRaw.push({
      canonical,
      members,
      preferredId: preferred.id,
      preferredCard: preferred.card_number,
      _nameMismatch: uniqueNames.size > 1,
    });
  }

  const filterByQuery = (g: ZeroVariantGroup) => {
    if (!query) return true;
    if (g.canonical.includes(query) || normalizeCardNumber(g.preferredCard).includes(query)) return true;
    return g.members.some((m) => normalizePersonName(m.name).includes(query) || normalizeCardNumber(m.card_number).includes(query));
  };

  // اختلاف الأصفار + نفس الاسم → جاهز للدمج التلقائي
  const zeroVariantGroups: ZeroVariantGroup[] = zeroVariantGroupsRaw
    .filter((g) => !g._nameMismatch)
    .filter(filterByQuery);

  // اختلاف الأصفار + اختلاف الاسم → يحتاج تدقيق يدوي
  const needsReviewZeroVariants: NeedsReviewZeroVariantGroup[] = zeroVariantGroupsRaw
    .filter((g) => g._nameMismatch)
    .filter(filterByQuery);

  // ── تجميع 2: نفس الاسم ببطاقات مختلفة (يحتاج مراجعة) ──
  const byName = new Map<string, BeneficiaryRow[]>();
  for (const r of rows) {
    const key = normalizeName(r.name);
    const arr = byName.get(key) ?? [];
    arr.push(r);
    byName.set(key, arr);
  }

  const sameNameGroups = [...byName.entries()]
    .map(([nameKey, members]) => {
      const uniqueCards = new Set(members.map((m) => normalizeCardNumber(m.card_number)));
      const uniqueCanonicalCards = new Set(members.map((m) => canonicalCard(m.card_number)));
      
      if (members.length <= 1 || uniqueCards.size <= 1) return null;
      
      // إذا كانت جميع البطاقات في هذه المجموعة تختلف فقط في الأصفار، 
      // فقد تمت إضافتها بالفعل في "حالات اختلاف الأصفار" (Zero Variants) ولا داعي لتكرار عرضها هنا.
      if (uniqueCanonicalCards.size === 1) return null;

      // FIX #sameNameGroups: كشف تعارض تاريخ الميلاد.
      // إذا كان جميع الأعضاء لديهم تواريخ ميلاد صريحة ومختلفة → أشخاص مختلفون.
      const knownBirthDates = members
        .map((m) => m.birth_date ? m.birth_date.toISOString().slice(0, 10) : null)
        .filter((d): d is string => d !== null);
      const uniqueBirthDates = new Set(knownBirthDates);
      const hasBirthDateConflict =
        knownBirthDates.length > 1 && uniqueBirthDates.size > 1;

      const preferred = [...members].sort((a, b) => {
        const s = cardShapeScore(b.card_number) - cardShapeScore(a.card_number);
        if (s !== 0) return s;
        return a.card_number.localeCompare(b.card_number);
      })[0];

      return {
        nameKey,
        members,
        cardCount: uniqueCards.size,
        preferredId: preferred.id,
        preferredCard: preferred.card_number,
        hasBirthDateConflict,
      };
    })
    .filter((g): g is SameNameGroup => !!g)
    .filter((g) => {
      if (!query) return true;
      if (g.nameKey.includes(query)) return true;
      return g.members.some((m) => normalizeCardNumber(m.card_number).includes(query));
    });

  return { zeroVariantGroups, sameNameGroups, needsReviewZeroVariants };
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return {
    items: items.slice(start, end),
    page: safePage,
    pages,
    total,
    pageSize,
  };
}
