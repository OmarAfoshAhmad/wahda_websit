import type prisma from "@/lib/prisma";
import type { TransactionType } from "@prisma/client";
import { getFiscalYearBounds } from "./fiscal-year";

type TxClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export type WalletType = "DENTAL" | "OPTICS" | "PHYSIOTHERAPY" | "EQUESTRIAN" | "GENERAL" | "MEDICINE" | "SUPPLIES";

export const DENTAL_CATEGORIES = ["DENTAL", "DENTAL_ORTHO", "DENTAL_IMPLANT", "DENTAL_PROSTHETICS"] as const;

/**
 * المصدر الوحيد لاستهلاك السقف السنوي لمحفظة مستفيد.
 *
 * الإلغاء يُمثَّل مرتين في الجدول: علم is_cancelled على الأصل، وصف CANCELLATION بقيم سالبة.
 * نعتمد العلم فقط ونستثني صفوف CANCELLATION صراحة؛ إدخالها كان يعكس كل إلغاء مرتين
 * فيمنح المستفيد سقفاً إضافياً بقيمة كل حركة ملغاة.
 */
export async function getCappedConsumption(
  tx: TxClient,
  input: { beneficiaryId: string; walletType: WalletType; fiscalYear: number; before?: Date },
): Promise<number> {
  const { start, end } = getFiscalYearBounds(input.fiscalYear);
  const categories: readonly string[] =
    input.walletType === "DENTAL" ? DENTAL_CATEGORIES : [input.walletType];

  const where = {
    beneficiary_id: input.beneficiaryId,
    is_cancelled: false,
    type: { not: "CANCELLATION" as TransactionType },
    created_at: input.before ? { gte: start, lt: input.before } : { gte: start, lte: end },
    OR: [
      { service_category: { in: [...categories] } },
      { service_category: null, type: input.walletType as TransactionType },
    ],
  };

  if (input.walletType === "PHYSIOTHERAPY") {
    // العلاج الطبيعي يُحاسب بعدد الجلسات (amount)؛ ceiling_consumed القديم قد يحوي كسوراً مالية.
    const agg = await tx.transaction.aggregate({ where, _sum: { amount: true } });
    return Number(agg._sum.amount ?? 0);
  }

  const agg = await tx.transaction.aggregate({ where, _sum: { ceiling_consumed: true } });
  return Number(agg._sum.ceiling_consumed ?? 0);
}
