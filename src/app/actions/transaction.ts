"use server";

import { deductBalance } from "@/app/actions/deduction";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { revalidatePath, revalidateTag } from "next/cache";
import { formatCurrency, roundCurrency } from "@/lib/money";
import { assertBeneficiaryBalanceInvariant } from "@/lib/tx-balance-guard";
import { Prisma } from "@prisma/client";
import {
  AMOUNT_POLICY_ERROR,
  isAllowedDeductionAmount,
  MAX_DEDUCTION_AMOUNT,
  MAX_AMOUNT_POLICY_ERROR,
} from "@/lib/validation";
import { InsuranceEngine } from "@/lib/insurance/engine";

export type AddTransactionState = {
  success?: string;
  error?: string;
  newBalance?: number;
};

export type EditTransactionInput = {
  id: string;
  amount: number;
  type: "MEDICINE" | "SUPPLIES" | "IMPORT" | "DENTAL";
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

async function recalculateDentalTransactionsForBeneficiary(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  beneficiaryId: string,
  year: number
) {
  const beneficiary = await tx.beneficiary.findUnique({
    where: { id: beneficiaryId },
    select: {
      id: true,
      company_id: true,
    }
  });

  if (!beneficiary || !beneficiary.company_id) {
    return;
  }

  const company = await tx.insuranceCompany.findUnique({
    where: { id: beneficiary.company_id },
    include: { service_policies: { include: { service_type: true } } }
  });

  if (!company || !company.is_active) {
    return;
  }

  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

  // Fetch all dental transactions chronologically
  const txs = await tx.transaction.findMany({
    where: {
      beneficiary_id: beneficiaryId,
      type: "DENTAL",
      is_cancelled: false,
      created_at: { gte: startDate, lte: endDate },
    },
    orderBy: [
      { created_at: "asc" },
      { id: "asc" }
    ]
  });

  let runningConsumed = 0;
  const dentalPolicy = (company as any).service_policies?.find((p: any) => p.service_type?.code === "DENTAL");
  const policy = {
    service_type: "DENTAL",
    annual_ceiling: dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null,
    copay_percentage: Math.max(0, 100 - (dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100)),
    allow_partial_coverage: true,
  };

  for (const t of txs) {
    const subCategory = t.service_category || "DENTAL";
    const settings = company.dental_settings ? (company.dental_settings as any) : null;
    let categoryCoverage = dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100; // default coverage

    if (subCategory === "DENTAL_ORTHO" && settings?.ortho?.enabled) {
      categoryCoverage = Number(settings.ortho.coverage);
    } else if (subCategory === "DENTAL_IMPLANT" && settings?.implant?.enabled) {
      categoryCoverage = Number(settings.implant.coverage);
    } else if (subCategory === "DENTAL_PROSTHETICS" && settings?.prosthetics?.enabled) {
      categoryCoverage = Number(settings.prosthetics.coverage);
    }

    const copayPercentage = Math.max(0, 100 - categoryCoverage);

    const calcResult = InsuranceEngine.calculate({
      amount: Number(t.amount),
      consumedThisYear: runningConsumed,
      policy: {
        serviceType: "DENTAL",
        annualCeiling: policy.annual_ceiling,
        copayPercentage: copayPercentage,
        allowPartialCoverage: true
      }
    });

    await tx.transaction.update({
      where: { id: t.id },
      data: {
        original_company_share: calcResult.originalCompanyShare,
        original_patient_share: calcResult.originalPatientShare,
        actual_company_share: calcResult.actualCompanyShare,
        actual_patient_share: calcResult.actualPatientShare,
        remaining_ceiling_before: calcResult.remainingCeilingBefore,
        ceiling_consumed: calcResult.ceilingConsumed,
        remaining_ceiling_after: calcResult.remainingCeilingAfter,
        consumed_before: calcResult.consumedBefore,
        consumed_after: calcResult.consumedAfter,
        policy_snapshot: JSON.parse(JSON.stringify(policy)),
        calc_metadata: {
          ...(t.calc_metadata as any || {}),
          engineVersion: calcResult.metadata.engineVersion,
          timestamp: calcResult.metadata.timestamp,
        }
      }
    });

    runningConsumed += calcResult.ceilingConsumed;
  }
}

export async function updateTransactionEntry(input: EditTransactionInput): Promise<{ success?: string; error?: string }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "edit_transaction")) {
    return { error: "غير مصرح لك بإجراء هذه العملية" };
  }

  if (!input.id) {
    return { error: "معرف الحركة مطلوب" };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { error: "قيمة المبلغ غير صالحة" };
  }

  if (input.type !== "DENTAL") {
    if (input.amount > MAX_DEDUCTION_AMOUNT) {
      return { error: MAX_AMOUNT_POLICY_ERROR };
    }

    if (!isAllowedDeductionAmount(input.amount)) {
      return { error: AMOUNT_POLICY_ERROR };
    }
  } else {
    const rounded = roundCurrency(input.amount);
    if (Math.abs(input.amount - rounded) > 1e-9) {
      return { error: "الحد الأقصى لكسور المبلغ هو قرشان (رقمين عشريين)" };
    }
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
          company_id: true,
          service_category: true,
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

      // غير المشرف لا يغير مصدر الحركة ولا يعدّل حركات خارج مرفقه (إلا إذا كان لديه صلاحية استثنائية).
      const canEditAny = hasPermission(session, "edit_any_facility_transaction");
      if (!session.is_admin && transaction.facility_id !== session.id && !canEditAny) {
        throw new Error("غير مصرح لك بتعديل حركة خارج مرفقك");
      }

      if (!session.is_admin && targetFacilityId !== transaction.facility_id && !canEditAny) {
        throw new Error("غير مصرح لك بتغيير مرفق الحركة");
      }

      const isDental = transaction.type === "DENTAL";
      const oldAmount = Number(transaction.amount);

      if (isDental) {
        // 1. Update the transaction basic data
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            amount: input.amount,
            created_at: parsedDate,
            facility_id: facility.id,
          },
        });

        // 2. Recalculate dental transactions for the beneficiary
        const oldYear = transaction.created_at.getFullYear();
        const newYear = parsedDate.getFullYear();
        await recalculateDentalTransactionsForBeneficiary(tx, transaction.beneficiary_id, oldYear);
        if (oldYear !== newYear) {
          await recalculateDentalTransactionsForBeneficiary(tx, transaction.beneficiary_id, newYear);
        }

        // 3. Create Audit Log
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
              old_type: transaction.type,
              new_type: input.type,
              old_date: transaction.created_at?.toISOString?.() ?? null,
              new_date: parsedDate.toISOString(),
              old_facility_id: transaction.facility_id ?? null,
              new_facility_id: facility.id,
              is_dental: true,
            },
          },
        });
      } else {
        const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string }>>`
          SELECT id, remaining_balance, status FROM "Beneficiary"
          WHERE id = ${transaction.beneficiary_id}
          FOR UPDATE
        `;

        if (locked.length === 0) {
          throw new Error("المستفيد غير موجود");
        }

        const currentBalance = Number(locked[0].remaining_balance);
        const lockedStatus = locked[0].status;
        const balanceBeforeThisTransaction = roundCurrency(currentBalance + oldAmount);

        if (input.amount > balanceBeforeThisTransaction) {
          throw new Error(`المبلغ أكبر من الرصيد المتاح قبل الحركة (${formatCurrency(balanceBeforeThisTransaction)} د.ل)`);
        }

        const newBalance = roundCurrency(balanceBeforeThisTransaction - input.amount);
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
              old_type: transaction.type,
              new_type: input.type,
              old_date: transaction.created_at?.toISOString?.() ?? null,
              new_date: parsedDate.toISOString(),
              old_facility_id: transaction.facility_id ?? null,
              new_facility_id: facility.id,
              old_balance_before_deduction: balanceBeforeThisTransaction,
              old_deducted_amount: oldAmount,
              old_remaining_after_deduction: currentBalance,
              new_balance_before_deduction: balanceBeforeThisTransaction,
              new_deducted_amount: input.amount,
              new_remaining_after_deduction: newBalance,
              balance_before: currentBalance,
              balance_after: newBalance,
            },
          },
        });

        await assertBeneficiaryBalanceInvariant(tx, transaction.beneficiary_id, "updateTransactionEntry");
      }
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
