// قواعد الزمن لسياسة الصيدلية. كل الحدود اليومية والسنوية تُحسب بتوقيت طرابلس (UTC+2 بلا توقيت صيفي).
const TRIPOLI_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MedicineCategoryValue = "ROUTINE" | "CHRONIC" | "CHEMICAL";

function tripoliParts(date: Date) {
  const shifted = new Date(date.getTime() + TRIPOLI_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

function tripoliMidnight(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - TRIPOLI_OFFSET_MS);
}

/** بداية ونهاية اليوم الحالي بتوقيت طرابلس (منتصف الليل إلى منتصف الليل). */
export function getTripoliDayWindow(referenceDate: Date) {
  const { year, month, day } = tripoliParts(referenceDate);
  const start = tripoliMidnight(year, month, day);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** السنة التأمينية التي يقع فيها التاريخ، بدءًا من شهر البداية المحدد في السياسة. */
export function getPolicyYearWindow(referenceDate: Date, startMonth: number) {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error("شهر بداية السنة التأمينية يجب أن يكون بين 1 و12");
  }
  const { year, month } = tripoliParts(referenceDate);
  const startYear = month + 1 >= startMonth ? year : year - 1;
  return {
    start: tripoliMidnight(startYear, startMonth - 1, 1),
    end: tripoliMidnight(startYear + 1, startMonth - 1, 1),
  };
}

/**
 * أول يوم يُسمح فيه بصرف الدواء المزمن مجددًا: يوم الصرف السابق + الفترة (بالأيام التقويمية بتوقيت طرابلس).
 * مثال: صرف يوم 1 بفترة 28 يومًا ⇒ يُسمح من يوم 29.
 */
export function getNextChronicEligibleDate(lastDispensedAt: Date, intervalDays: number) {
  if (!Number.isInteger(intervalDays) || intervalDays < 1) throw new Error("فترة صرف المزمن يجب أن تكون يومًا على الأقل");
  const { year, month, day } = tripoliParts(lastDispensedAt);
  return tripoliMidnight(year, month, day + intervalDays);
}

export function isChronicDrugEligible(lastDispensedAt: Date | null, intervalDays: number, now: Date) {
  return lastDispensedAt === null || now.getTime() >= getNextChronicEligibleDate(lastDispensedAt, intervalDays).getTime();
}

type PharmacyConfigLike = {
  routine_enabled: boolean;
  chronic_enabled: boolean;
  chemical_enabled: boolean;
  routine_ceiling: unknown;
  chronic_ceiling: unknown;
  chemical_ceiling: unknown;
  routine_coverage_percent: unknown;
  chronic_coverage_percent: unknown;
  chemical_coverage_percent: unknown;
  routine_daily_limit: number;
  chemical_daily_limit: number;
  chronic_interval_days: number;
  policy_year_start_month: number;
};

type PolicyLike = { ceiling_amount: unknown; coverage_percent: unknown };

const toNumberOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** يجمع إعدادات الفئة: السقف الخاص بها يُطبَّق داخل السقف العام لخدمة الأدوية. */
export function resolvePharmacyCategoryPolicy(policy: PolicyLike, config: PharmacyConfigLike, category: MedicineCategoryValue) {
  const key = category === "ROUTINE" ? "routine" : category === "CHRONIC" ? "chronic" : "chemical";
  return {
    enabled: config[`${key}_enabled`] as boolean,
    categoryCeiling: toNumberOrNull(config[`${key}_ceiling`]),
    overallCeiling: toNumberOrNull(policy.ceiling_amount),
    coveragePercent: toNumberOrNull(config[`${key}_coverage_percent`]) ?? Number(policy.coverage_percent),
    dailyLimit: category === "ROUTINE" ? config.routine_daily_limit : category === "CHEMICAL" ? config.chemical_daily_limit : null,
    chronicIntervalDays: config.chronic_interval_days,
    policyYearStartMonth: config.policy_year_start_month,
  };
}
