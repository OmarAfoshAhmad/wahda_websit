"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AUDIT_ACTIONS } from "@/lib/constants";

type BackgroundActor = {
  username: string;
  isAdmin: true;
};

export type RecalcResult = {
  success: boolean;
  fixed_count: number;
  status_changes: number;
  total_drift: number;
  error?: string;
};

export type DriftCheckResult = {
  success: boolean;
  count: number;
  total_drift: number;
  error?: string;
};

export type CountCheckResult = {
  success: boolean;
  count: number;
  error?: string;
};

export type FixStatusAnomaliesResult = {
  success: boolean;
  fixed_count: number;
  active_to_finished: number;
  finished_to_active: number;
  error?: string;
};

export async function checkBalanceDriftAction(): Promise<DriftCheckResult> {
  const session = await getSession();
  if (!session?.is_admin) {
    return { success: false, count: 0, total_drift: 0, error: "غير مصرح" };
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ drift_count: number; total_drift: number }>>`
      SELECT
        COUNT(*)::int AS drift_count,
        COALESCE(SUM(ABS(drift)), 0)::float8 AS total_drift
      FROM (
        SELECT
          (b.remaining_balance - GREATEST(0,
            b.total_balance - COALESCE(
              SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END),
              0
            )
          ))::float8 AS drift
        FROM "Beneficiary" b
        LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
        WHERE b.deleted_at IS NULL
        GROUP BY b.id, b.total_balance, b.remaining_balance
        HAVING ABS(
          b.remaining_balance - GREATEST(0,
            b.total_balance - COALESCE(
              SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END),
              0
            )
          )
        ) > 0.01
      ) d
    `;

    return {
      success: true,
      count: Number(rows[0]?.drift_count ?? 0),
      total_drift: Number(rows[0]?.total_drift ?? 0),
    };
  } catch {
    return { success: false, count: 0, total_drift: 0, error: "تعذر فحص انجراف الرصيد" };
  }
}

export async function checkStatusAnomaliesAction(): Promise<CountCheckResult> {
  const session = await getSession();
  if (!session?.is_admin) {
    return { success: false, count: 0, error: "غير مصرح" };
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ anomaly_count: number }>>`
      SELECT COUNT(*)::int AS anomaly_count
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND (
          (status = 'ACTIVE'   AND remaining_balance <= 0.01)
          OR (status = 'FINISHED' AND remaining_balance > 0.01)
        )
    `;

    return { success: true, count: Number(rows[0]?.anomaly_count ?? 0) };
  } catch {
    return { success: false, count: 0, error: "تعذر فحص تناقضات الحالة" };
  }
}

export async function checkOrphanedNotificationsAction(): Promise<CountCheckResult> {
  const session = await getSession();
  if (!session?.is_admin) {
    return { success: false, count: 0, error: "غير مصرح" };
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ orphaned_count: number }>>`
      SELECT COUNT(*)::int AS orphaned_count
      FROM "Notification" n
      JOIN "Beneficiary" b ON b.id = n.beneficiary_id
      WHERE b.deleted_at IS NOT NULL
    `;

    return { success: true, count: Number(rows[0]?.orphaned_count ?? 0) };
  } catch {
    return { success: false, count: 0, error: "تعذر فحص الإشعارات اليتيمة" };
  }
}

export async function fixStatusAnomaliesAction(actor?: BackgroundActor): Promise<FixStatusAnomaliesResult> {
  const session = actor
    ? { username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
  if (!session?.is_admin) {
    return {
      success: false,
      fixed_count: 0,
      active_to_finished: 0,
      finished_to_active: 0,
      error: "غير مصرح",
    };
  }

  try {
    const [activeToFinishedCount, finishedToActiveCount] = await Promise.all([
      prisma.beneficiary.count({
        where: {
          deleted_at: null,
          status: "ACTIVE",
          remaining_balance: { lte: 0.01 },
        },
      }),
      prisma.beneficiary.count({
        where: {
          deleted_at: null,
          status: "FINISHED",
          remaining_balance: { gt: 0.01 },
        },
      }),
    ]);

    const fixedCount = activeToFinishedCount + finishedToActiveCount;
    if (fixedCount === 0) {
      return {
        success: true,
        fixed_count: 0,
        active_to_finished: 0,
        finished_to_active: 0,
      };
    }

    await prisma.$transaction([
      prisma.beneficiary.updateMany({
        where: {
          deleted_at: null,
          status: "ACTIVE",
          remaining_balance: { lte: 0.01 },
        },
        data: {
          status: "FINISHED",
          completed_via: "IMPORT",
        },
      }),
      prisma.beneficiary.updateMany({
        where: {
          deleted_at: null,
          status: "FINISHED",
          remaining_balance: { gt: 0.01 },
        },
        data: {
          status: "ACTIVE",
          completed_via: null,
        },
      }),
      prisma.auditLog.create({
        data: {
          user: session.username,
          action: AUDIT_ACTIONS.STATUS_ANOMALIES_FIX,
          metadata: {
            fixed_count: fixedCount,
            active_to_finished: activeToFinishedCount,
            finished_to_active: finishedToActiveCount,
          },
        },
      }),
    ]);

    return {
      success: true,
      fixed_count: fixedCount,
      active_to_finished: activeToFinishedCount,
      finished_to_active: finishedToActiveCount,
    };
  } catch {
    return {
      success: false,
      fixed_count: 0,
      active_to_finished: 0,
      finished_to_active: 0,
      error: "تعذر معالجة تناقضات الحالة",
    };
  }
}

export async function recalcBalancesAction(actor?: BackgroundActor): Promise<RecalcResult> {
  const session = actor
    ? { username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
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
