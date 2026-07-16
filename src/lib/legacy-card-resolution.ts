import { canonicalizeCardNumber, getArabicNormalization } from "@/lib/normalize";

export type LegacyResolutionPerson = {
  id: string;
  name: string;
  cardNumber: string;
  birthDate: string | null;
  createdAt: string;
  batchNumber?: string | null;
  registryConfirmed?: boolean;
};

export type LegacyReplacementDecision = {
  kind: "SAFE" | "REVIEW" | "NONE";
  replacement: LegacyResolutionPerson | null;
  candidates: LegacyResolutionPerson[];
  reason: string;
};

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export function normalizeLegacyIdentityName(value: string): string {
  return getArabicNormalization(value)
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function classifyLegacyReplacement(
  legacy: LegacyResolutionPerson,
  possibleCandidates: LegacyResolutionPerson[],
): LegacyReplacementDecision {
  const legacyIdentityName = normalizeLegacyIdentityName(legacy.name);
  const legacyBirthDate = dateOnly(legacy.birthDate);
  const legacyCanonicalCard = canonicalizeCardNumber(legacy.cardNumber);

  const candidates = possibleCandidates
    .filter((candidate) => candidate.id !== legacy.id)
    .filter((candidate) => {
      const sameIdentityName = normalizeLegacyIdentityName(candidate.name) === legacyIdentityName;
      const sameCanonicalCard = canonicalizeCardNumber(candidate.cardNumber) === legacyCanonicalCard;
      return sameIdentityName || sameCanonicalCard;
    })
    .filter((candidate) => new Date(candidate.createdAt).getTime() >= new Date(legacy.createdAt).getTime())
    .filter((candidate) => {
      const candidateBirthDate = dateOnly(candidate.birthDate);
      return !(legacyBirthDate && candidateBirthDate && legacyBirthDate !== candidateBirthDate);
    });

  const strong = candidates.filter((candidate) => {
    const candidateBirthDate = dateOnly(candidate.birthDate);
    const sameBirthDate = Boolean(legacyBirthDate && candidateBirthDate && legacyBirthDate === candidateBirthDate);
    const sameCanonicalCard = canonicalizeCardNumber(candidate.cardNumber) === legacyCanonicalCard;
    // اختلاف رقم البطاقة مع تطابق الاسم والميلاد وحده لا يكفي لإثبات الهوية.
    // نقبله تلقائياً فقط عندما يؤكده سجل إصدار البطاقات الرسمي.
    const sameIdentityName = normalizeLegacyIdentityName(candidate.name) === legacyIdentityName;
    return sameCanonicalCard || (sameIdentityName && (sameBirthDate || candidate.registryConfirmed === true || candidates.length === 1));
  });

  if (strong.length === 1) {
    return {
      kind: "SAFE",
      replacement: strong[0],
      candidates,
      reason: canonicalizeCardNumber(strong[0].cardNumber) === legacyCanonicalCard
        ? "نفس الرقم المعياري بعد تجاهل اختلاف الأصفار، والسجل أحدث"
        : dateOnly(strong[0].birthDate) && legacyBirthDate && strong[0].registryConfirmed
        ? "تطابق الاسم وتاريخ الميلاد مع تأكيد سجل إصدار البطاقات"
        : "تطابق هوية الاسم مع وجود سجل بطاقة أحدث وحيد",
    };
  }

  if (strong.length > 1) {
    return {
      kind: "REVIEW",
      replacement: null,
      candidates: strong,
      reason: "يوجد أكثر من بديل قوي؛ يلزم اختيار يدوي لتجنب دمج شخصين مختلفين",
    };
  }

  if (candidates.length > 0) {
    return {
      kind: "REVIEW",
      replacement: null,
      candidates,
      reason: "الاسم متطابق لكن لا يوجد تاريخ ميلاد أو رقم معياري كافٍ لإثبات الهوية",
    };
  }

  return {
    kind: "NONE",
    replacement: null,
    candidates: [],
    reason: "لم تُكتشف بطاقة حديثة مؤكدة لنفس الشخص",
  };
}
