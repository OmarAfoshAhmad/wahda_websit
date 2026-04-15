"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AUDIT_ACTIONS } from "@/lib/constants";

export type RecalcResult = {
  success: boolean;
  fixed_count: number;
  status_changes: number;
  total_drift: number;
  error?: string;
};

export async function recalcBalancesAction(): Promise<RecalcResult> {
  const session = await getSession();
  if (!session?.is_admin) {
    return { success: false, fixed_count: 0, status_changes: 0, total_drift: 0, error: "غير مصرح" };
  }

  try {
    // جلب جميع المستفيدين النشطين
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        card_number: true,
        name: true,
        total_balance: true,
        remaining_balance: true,
        status: true,
        completed_via: true,
      },
    });

    // جلب جميع الحركات الفعّالة (غير ملغاة وليست CANCELLATION)
    const transactions = await prisma.transaction.findMany({
      where: {
        beneficiary_id: { in: beneficiaries.map((b) => b.id) },
        is_cancelled: false,
        type: { not: "CANCELLATION" },
      },
      select: { beneficiary_id: true, amount: true },
    });

    // تجميع المبالغ المصروفة لكل مستفيد
    const spentMap = new Map<string, number>();
    for (const tx of transactions) {
      spentMap.set(tx.beneficiary_id, (spentMap.get(tx.beneficiary_id) ?? 0) + Number(tx.amount));
    }

    // حساب ما يحتاج تعديل
    const changes: {
      id: string;
      remaining_balance: number;
      status: string;
      completed_via: string | null;
      old_status: string;
      drift: number;
    }[] = [];

    for (const ben of beneficiaries) {
      const totalBalance = Number(ben.total_balance);
      const currentRemaining = Number(ben.remaining_balance);
      const totalSpent = spentMap.get(ben.id) ?? 0;
      const correctRemaining = Math.max(0, totalBalance - totalSpent);
      const drift = Math.abs(correctRemaining - currentRemaining);

      if (drift <= 0.001) continue;

      let correctStatus = ben.status;
      if (ben.status !== "SUSPENDED") {
        correctStatus = correctRemaining <= 0 ? "FINISHED" : "ACTIVE";
      }

      let correctCompletedVia = ben.completed_via;
      if (correctStatus === "FINISHED" && ben.status !== "FINISHED") {
        correctCompletedVia = "IMPORT";
      } else if (correctStatus !== "FINISHED") {
        correctCompletedVia = null;
      }

      changes.push({
        id: ben.id,
        remaining_balance: correctRemaining,
        status: correctStatus,
        completed_via: correctCompletedVia,
        old_status: ben.status,
        drift,
      });
    }

    if (changes.length === 0) {
      return { success: true, fixed_count: 0, status_changes: 0, total_drift: 0 };
    }

    const status_changes = changes.filter((c) => c.status !== c.old_status).length;
    const total_drift = changes.reduce((sum, c) => sum + c.drift, 0);

    // تطبيق التعديلات في transaction واحدة
    await prisma.$transaction([
      ...changes.map((c) =>
        prisma.beneficiary.update({
          where: { id: c.id },
          data: {
            remaining_balance: c.remaining_balance,
            status: c.status as "ACTIVE" | "FINISHED" | "SUSPENDED",
            completed_via: c.completed_via as "IMPORT" | null | undefined,
          },
        }),
      ),
      prisma.auditLog.create({
        data: {
          user: session.username,
          action: AUDIT_ACTIONS.BALANCE_DRIFT_FIX,
          metadata: {
            fixed_count: changes.length,
            status_changes,
            total_drift: Math.round(total_drift * 100) / 100,
          },
        },
      }),
    ]);

    return { success: true, fixed_count: changes.length, status_changes, total_drift };
  } catch (err) {
    console.error("[recalcBalancesAction]", err);
    return { success: false, fixed_count: 0, status_changes: 0, total_drift: 0, error: "حدث خطأ أثناء الإصلاح" };
  }
}
