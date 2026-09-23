import { Prisma, type TransactionType } from "@prisma/client";
import { roundCurrency } from "@/lib/money";

/** أنواع لا تستهلك السقف النقدي الأساسي؛ لكل منها محفظة/سياسة مستقلة. */
export const BASE_BALANCE_EXCLUDED_TRANSACTION_TYPES = [
  "CANCELLATION",
  "DENTAL",
  "OPTICS",
  "PHYSIOTHERAPY",
  "EQUESTRIAN",
] as const satisfies readonly TransactionType[];

/** أجزاء SQL موحدة للاستعلامات التي تستخدم الاسم المختصر t لجدول الحركات. */
export const BASE_BALANCE_ELIGIBLE_SQL = Prisma.sql`
  t.is_cancelled = false
  AND t.type NOT IN ('CANCELLATION', 'DENTAL', 'OPTICS', 'PHYSIOTHERAPY', 'EQUESTRIAN')
`;

export const BASE_BALANCE_AMOUNT_SQL = Prisma.sql`COALESCE(t.actual_company_share, t.amount)`;

export const BASE_BALANCE_SPENT_SUM_SQL = Prisma.sql`
  COALESCE(SUM(CASE
    WHEN ${BASE_BALANCE_ELIGIBLE_SQL} THEN ${BASE_BALANCE_AMOUNT_SQL}
    ELSE 0
  END), 0)
`;

/**
 * بلا قصّ عند الصفر: الصرف فوق الرصيد خطأ يجب أن يظهر سالباً ويُرفض عند الكتابة،
 * لا أن يُخفى كصفر يمرّ منه حارس الثبات بنجاح.
 */
export function calculateBaseRemaining(totalBalance: number, spent: number): number {
  return roundCurrency(Number(totalBalance) - Number(spent));
}
