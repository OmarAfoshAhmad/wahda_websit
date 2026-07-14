export type PhysiotherapySessionCalculation = {
  sessions: number;
  limit: number | null;
  consumedBefore: number;
  consumedAfter: number;
  remainingBefore: number | null;
  remainingAfter: number | null;
  exceededSessions: number;
};

function numericCellValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return Number.parseFloat(value.replace(/,/g, "").match(/[\d.]+/)?.[0] || "0");
  }
  if (typeof value === "object" && value && "result" in value) {
    return numericCellValue((value as { result?: unknown }).result);
  }
  return 0;
}

/** Reads sessions only from a dedicated sessions cell, or falls back to an explicit "جلسة" note. */
export function parsePhysiotherapySessionCount(sessionValue: unknown, notesValue: unknown): number {
  const dedicatedValue = numericCellValue(sessionValue);
  if (dedicatedValue > 0) return dedicatedValue;

  const notes = String(notesValue ?? "").trim();
  if (/^\d+(?:\.\d+)?$/.test(notes)) return Number.parseFloat(notes);
  if (!/جلس(?:ة|ات)?/.test(notes)) return 0;
  const match = notes.match(/(\d+(?:\.\d+)?)\s*جلس/);
  return match ? Number.parseFloat(match[1]) : 0;
}

/**
 * العلاج الطبيعي يُحاسب بوحدة الجلسة فقط.
 * لا تُطبق عليه نسب تغطية أو حصة مالية للمستفيد.
 */
export function calculatePhysiotherapySessions(input: {
  sessions: number;
  consumedBefore: number;
  limit: number | null;
}): PhysiotherapySessionCalculation {
  const sessions = Number(input.sessions);
  const consumedBefore = Math.max(0, Number(input.consumedBefore) || 0);
  const limit = input.limit === null ? null : Math.max(0, Number(input.limit) || 0);

  if (!Number.isFinite(sessions) || sessions <= 0 || !Number.isInteger(sessions)) {
    throw new Error("عدد جلسات العلاج الطبيعي يجب أن يكون عدداً صحيحاً أكبر من صفر.");
  }

  const consumedAfter = consumedBefore + sessions;
  const remainingBefore = limit === null ? null : Math.max(0, limit - consumedBefore);
  const remainingAfter = limit === null ? null : Math.max(0, limit - consumedAfter);
  const exceededSessions = limit === null ? 0 : Math.max(0, consumedAfter - limit);

  return {
    sessions,
    limit,
    consumedBefore,
    consumedAfter,
    remainingBefore,
    remainingAfter,
    exceededSessions,
  };
}
