// أقدم تاريخ يمكن أن تحمله حركة حقيقية في المنظومة؛ ما قبله خطأ إدخال أو تحويل تاريخ.
export const MIN_VALID_TRANSACTION_ISO = "2020-01-01";
export const MIN_VALID_TRANSACTION_DATE = new Date(`${MIN_VALID_TRANSACTION_ISO}T00:00:00.000Z`);

export function tripoliIsoDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function parseDateOnlyAsNoonUtc(value: string): Date {
  // منتصف النهار UTC يمنع انزلاق اليوم عند التحويل إلى توقيت طرابلس.
  return new Date(`${value}T12:00:00.000Z`);
}

/**
 * الشذوذ الغالب هو انقلاب يوم/شهر أثناء تحليل ملفات Excel (05/10 تُقرأ 10/05).
 * لا نقترح القلب إلا إذا كان اليوم ≤ 12 وأنتج تاريخاً داخل النطاق المسموح.
 */
export function suggestSwappedDate(createdAt: Date, todayIso: string): string | null {
  const [y, m, d] = tripoliIsoDate(createdAt).split("-");
  if (Number(d) > 12) return null;
  const swapped = `${y}-${d}-${m}`;
  if (swapped === tripoliIsoDate(createdAt)) return null;
  if (swapped < MIN_VALID_TRANSACTION_ISO || swapped > todayIso) return null;
  return swapped;
}

export function validateCorrectedDate(
  newDateInput: string,
  todayIso: string = tripoliIsoDate(),
): { ok: true; date: Date } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDateInput)) {
    return { ok: false, error: "صيغة التاريخ يجب أن تكون YYYY-MM-DD" };
  }
  const parsed = parseDateOnlyAsNoonUtc(newDateInput);
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: "تاريخ غير صالح" };
  if (newDateInput < MIN_VALID_TRANSACTION_ISO) {
    return { ok: false, error: `التاريخ الجديد أقدم من الحد الأدنى المسموح (${MIN_VALID_TRANSACTION_ISO})` };
  }
  if (newDateInput > todayIso) return { ok: false, error: "لا يمكن تحديد تاريخ في المستقبل" };
  return { ok: true, date: parsed };
}
