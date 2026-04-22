"use server";

import { deductBalance } from "@/app/actions/deduction";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { revalidatePath, revalidateTag } from "next/cache";
import { formatCurrency, roundCurrency } from "@/lib/money";
import { Prisma } from "@prisma/client";
import {
  AMOUNT_POLICY_ERROR,
  isAllowedDeductionAmount,
  MAX_DEDUCTION_AMOUNT,
  MAX_AMOUNT_POLICY_ERROR,
} from "@/lib/validation";

export type AddTransactionState = {
  success?: string;
  error?: string;
  newBalance?: number;
};

export type EditTransactionInput = {
  id: string;
  amount: number;
  type: "MEDICINE" | "SUPPLIES" | "IMPORT";
  transactionDate: string;
  facilityId?: string;
};

function getTripoliIsoDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDateOnlyAsNoonUtc(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

export async function addTransactionFromForm(
  _prev: AddTransactionState | null,
  formData: FormData,
): Promise<AddTransactionState> {
  const facilityIdRaw = String(formData.get("facility_id") ?? "").trim();
  const cardNumber = String(formData.get("card_number") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const typeRaw = String(formData.get("type") ?? "").trim();
  const transactionDateRaw = String(formData.get("transaction_date") ?? "").trim();

  const amount = Number(amountRaw);
  const type = typeRaw === "MEDICINE" ? "MEDICINE" : typeRaw === "SUPPLIES" ? "SUPPLIES" : null;

  if (!cardNumber) {
    return { error: "رقم البطاقة مطلوب" };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "قيمة المبلغ غير صالحة" };
  }

  if (amount > MAX_DEDUCTION_AMOUNT) {
    return { error: MAX_AMOUNT_POLICY_ERROR };
  }

  if (!isAllowedDeductionAmount(amount)) {
    return { error: AMOUNT_POLICY_ERROR };
  }

  if (!type) {
    return { error: "نوع الحركة مطلوب" };
  }

  const beneficiary = await prisma.beneficiary.findFirst({
    where: {
      card_number: cardNumber,
      deleted_at: null,
    },
    select: {
      id: true,
      status: true,
      remaining_balance: true,
    },
  });

  if (beneficiary && (beneficiary.status === "FINISHED" || Number(beneficiary.remaining_balance) <= 0)) {
    return { error: "لا يمكن إضافة حركة: رصيد المستفيد منتهي أو حالته مكتمل" };
  }

  let transactionDate: Date | undefined;
  if (transactionDateRaw) {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(transactionDateRaw);
    const parsedDate = isDateOnly ? parseDateOnlyAsNoonUtc(transactionDateRaw) : new Date(transactionDateRaw);
    if (Number.isNaN(parsedDate.getTime())) {
      return { error: "تاريخ الحركة غير صالح" };
    }
    if (isDateOnly) {
      const todayTripoli = getTripoliIsoDate();
      if (transactionDateRaw > todayTripoli) {
        return { error: "لا يمكن تحديد تاريخ حركة في المستقبل" };
      }
    } else if (parsedDate.getTime() > Date.now() + 60_000) {
      return { error: "لا يمكن تحديد تاريخ حركة في المستقبل" };
    }
    transactionDate = parsedDate;
  }

  const result = await deductBalance({
    beneficiary_id: beneficiary?.id,
    card_number: cardNumber,
    amount,
    type,
    transactionDate,
    facilityId: facilityIdRaw || undefined,
  });

  if (result.error) {
    return { error: result.error };
  }

  return {
    success: "تمت إضافة الحركة اليدوية بنجاح",
    newBalance: result.newBalance,
  };
}

export async function updateTransactionEntry(input: EditTransactionInput): Promise<{ success?: string; error?: string }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "correct_transactions")) {
    return { error: "غير مصرح لك بإجراء هذه العملية" };
  }

  if (!input.id) {
    return { error: "معرف الحركة مطلوب" };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { error: "قيمة المبلغ غير صالحة" };
  }

  if (input.amount > MAX_DEDUCTION_AMOUNT) {
    return { error: MAX_AMOUNT_POLICY_ERROR };
  }

  if (!isAllowedDeductionAmount(input.amount)) {
    return { error: AMOUNT_POLICY_ERROR };
  }

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate);
  const parsedDate = isDateOnly
    ? parseDateOnlyAsNoonUtc(input.transactionDate)
    : new Date(input.transactionDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: "تاريخ الحركة غير صالح" };
  }

  const minAllowedDate = new Date("1900-01-01T00:00:00");
  if (parsedDate.getTime() < minAllowedDate.getTime()) {
    return { error: "تاريخ الحركة غير صالح" };
  }

  if (isDateOnly) {
    const todayTripoli = getTripoliIsoDate();
    if (input.transactionDate > todayTripoli) {
      return { error: "لا يمكن تحديد تاريخ حركة في المستقبل" };
    }
  } else if (parsedDate.getTime() > Date.now() + 60_000) {
    return { error: "لا يمكن تحديد تاريخ حركة في المستقبل" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          beneficiary_id: true,
          amount: true,
          is_cancelled: true,
          type: true,
          created_at: true,
          facility_id: true,
          beneficiary: {
            select: {
              name: true,
              card_number: true,
            },
          },
        },
      });

      if (!transaction) {
        throw new Error("الحركة غير موجودة");
      }

      if (transaction.is_cancelled) {
        throw new Error("لا يمكن تعديل حركة ملغاة");
      }

      if (transaction.type === "CANCELLATION") {
        throw new Error("لا يمكن تعديل حركة مصححة مباشرة");
      }

      // مالك الحركة يبقى كما هو، ولا يتحول إلى مرفق المعدّل.
      const targetFacilityId = input.facilityId?.trim() || transaction.facility_id || null;
      if (!targetFacilityId) {
        throw new Error("المرفق المحدد غير موجود");
      }

      const facility = await tx.facility.findFirst({
        where: { id: targetFacilityId, deleted_at: null },
        select: { id: true },
      });

      if (!facility) {
        throw new Error("المرفق المحدد غير موجود");
      }

      // غير المشرف لا يغير مصدر الحركة ولا يعدّل حركات خارج مرفقه.
      if (!session.is_admin && transaction.facility_id !== session.id) {
        throw new Error("غير مصرح لك بتعديل حركة خارج مرفقك");
      }

      if (!session.is_admin && targetFacilityId !== transaction.facility_id) {
        throw new Error("غير مصرح لك بتغيير مرفق الحركة");
      }

      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string }>>`
        SELECT id, remaining_balance, status FROM "Beneficiary"
        WHERE id = ${transaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const oldAmount = Number(transaction.amount);
      const currentBalance = Number(locked[0].remaining_balance);
      const lockedStatus = locked[0].status;
      const balanceBeforeThisTransaction = roundCurrency(currentBalance + oldAmount);

      if (input.amount > balanceBeforeThisTransaction) {
        throw new Error(`المبلغ أكبر من الرصيد المتاح قبل الحركة (${formatCurrency(balanceBeforeThisTransaction)} د.ل)`);
      }

      const newBalance = roundCurrency(balanceBeforeThisTransaction - input.amount);
      // FIX: احترام حالة الإيقاف — لا نغير SUSPENDED إلى ACTIVE أو FINISHED
      const newStatus = lockedStatus === "SUSPENDED" ? "SUSPENDED" : (newBalance <= 0 ? "FINISHED" : "ACTIVE");

      await tx.beneficiary.update({
        where: { id: transaction.beneficiary_id },
        data: {
          remaining_balance: newBalance,
          status: newStatus,
        },
      });

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          amount: input.amount,
          type: input.type,
          created_at: parsedDate,
          facility_id: facility.id,
        },
      });

      await tx.auditLog.create({
        data: {
          facility_id: facility.id,
          user: session.username,
          action: "EDIT_TRANSACTION",
          metadata: {
            transaction_id: transaction.id,
            beneficiary_name: transaction.beneficiary.name,
            card_number: transaction.beneficiary.card_number,
            old_amount: oldAmount,
            new_amount: input.amount,
            // تفاصيل الحركة قبل/بعد التعديل لعرض واضح في سجل المراقبة
            old_balance_before_deduction: balanceBeforeThisTransaction,
            old_deducted_amount: oldAmount,
            old_remaining_after_deduction: currentBalance,
            new_balance_before_deduction: balanceBeforeThisTransaction,
            new_deducted_amount: input.amount,
            new_remaining_after_deduction: newBalance,
            // SEC-FIX: حفظ جميع القيم القديمة والجديدة لإمكانية التراجع
            old_type: transaction.type,
            new_type: input.type,
            old_date: transaction.created_at?.toISOString?.() ?? null,
            new_date: parsedDate.toISOString(),
            old_facility_id: transaction.facility_id ?? null,
            new_facility_id: facility.id,
            balance_before: currentBalance,
            balance_after: newBalance,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: "تم تعديل الحركة بنجاح" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تعديل الحركة";
    return { error: message };
  }
}
