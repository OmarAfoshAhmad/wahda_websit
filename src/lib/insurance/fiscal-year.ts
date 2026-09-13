import { getEndOfDayTripoli, getStartOfDayTripoli } from "@/lib/datetime";

/**
 * السنة المالية = السنة الميلادية بتوقيت طرابلس، لا بتوقيت الخادم.
 * الخادم في الحاوية يعمل بـUTC، فحركة 1 يناير 01:00 بطرابلس كانت تُحسب على السنة السابقة.
 */
export function getFiscalYear(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Tripoli", year: "numeric" }).format(date),
  );
}

export function getFiscalYearBounds(fiscalYear: number): { start: Date; end: Date } {
  return {
    start: getStartOfDayTripoli(`${fiscalYear}-01-01`),
    end: getEndOfDayTripoli(`${fiscalYear}-12-31`),
  };
}
