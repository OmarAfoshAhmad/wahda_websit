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

/**
 * Returns a Date object representing the start of the day (00:00:00) 
 * for the given YYYY-MM-DD string in Africa/Tripoli timezone.
 */
export function getStartOfDayTripoli(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+02:00`);
}

/**
 * Returns a Date object representing the end of the day (23:59:59.999) 
 * for the given YYYY-MM-DD string in Africa/Tripoli timezone.
 */
export function getEndOfDayTripoli(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+02:00`);
}
