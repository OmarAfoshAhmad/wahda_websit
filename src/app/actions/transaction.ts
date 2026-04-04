"use server";

import { deductBalance } from "@/app/actions/deduction";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";

export type AddTransactionState = {
  success?: string;
  error?: string;
  newBalance?: number;
};

export type EditTransactionInput = {
  id: string;
  amount: number;
  type: "MEDICINE" | "SUPPLIES";
  transactionDate: string;
  facilityId?: string;
};

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

  if (!type) {
    return { error: "نوع الحركة مطلوب" };
  }

  let transactionDate: Date | undefined;
  if (transactionDateRaw) {
    const parsedDate = new Date(transactionDateRaw);
    if (Number.isNaN(parsedDate.getTime())) {
      return { error: "تاريخ الحركة غير صالح" };
    }
    if (parsedDate.getTime() > Date.now() + 60_000) {
      return { error: "لا يمكن تحديد تاريخ حركة في المستقبل" };
    }
    transactionDate = parsedDate;
  }

  const result = await deductBalance({
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

  const parsedDate = new Date(input.transactionDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: "تاريخ الحركة غير صالح" };
  }

  if (parsedDate.getTime() > Date.now() + 60_000) {
    return { error: "لا يمكن تحديد تاريخ حركة في المستقبل" };
  }

  const targetFacilityId = session.is_admin && input.facilityId ? input.facilityId : session.id;
  const facility = await prisma.facility.findFirst({
    where: { id: targetFacilityId, deleted_at: null },
    select: { id: true },
  });

  if (!facility) {
    return { error: "المرفق المحدد غير موجود" };
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
      const balanceBeforeThisTransaction = currentBalance + oldAmount;

      if (input.amount > balanceBeforeThisTransaction) {
        throw new Error(`المبلغ أكبر من الرصيد المتاح قبل الحركة (${balanceBeforeThisTransaction.toLocaleString("ar-LY")} د.ل)`);
      }

      const newBalance = balanceBeforeThisTransaction - input.amount;
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
            old_amount: oldAmount,
            new_amount: input.amount,
            new_type: input.type,
            new_date: parsedDate.toISOString(),
            balance_before: currentBalance,
            balance_after: newBalance,
          },
        },
      });
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    return { success: "تم تعديل الحركة بنجاح" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل تعديل الحركة";
    return { error: message };
  }
}
