const TRIPOLI_TIMEZONE = "Africa/Tripoli";

type DateLike = Date | string | number;

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTripoli(value: DateLike, locale: string = "en-GB"): string {
  return toDate(value).toLocaleDateString(locale, { timeZone: TRIPOLI_TIMEZONE });
}

export function formatTimeTripoli(value: DateLike, locale: string = "en-GB"): string {
  return toDate(value).toLocaleTimeString(locale, { timeZone: TRIPOLI_TIMEZONE });
}

export function formatDateTimeTripoli(
  value: DateLike,
  locale: string = "ar-LY",
  options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
): string {
  return toDate(value).toLocaleString(locale, { ...options, timeZone: TRIPOLI_TIMEZONE });
}
