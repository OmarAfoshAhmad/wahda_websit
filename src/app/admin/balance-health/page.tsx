import { redirect } from "next/navigation";
import { AlertTriangle, Activity, BadgeAlert, BellOff } from "lucide-react";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { FixBalancesButton } from "@/components/fix-balances-button";

type BalanceDriftSummary = {
  drift_count: number;
  total_drift: number;
};

type StatusAnomalySummary = {
  anomaly_count: number;
};

type OrphanedNotificationSummary = {
  orphaned_count: number;
};

export const dynamic = "force-dynamic";

function StatCard({ title, value, hint, icon }: { title: string; value: string; hint: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300">{title}</h2>
        <div className="text-slate-500 dark:text-slate-400">{icon}</div>
      </div>
      <p className="text-2xl font-black text-slate-900 dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}

export default async function BalanceHealthPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const [driftSummary, statusSummary, orphanedSummary] = await Promise.all([
    prisma.$queryRaw<BalanceDriftSummary[]>`
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
    `,
    prisma.$queryRaw<StatusAnomalySummary[]>`
      SELECT COUNT(*)::int AS anomaly_count
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND (
          (status = 'ACTIVE'   AND remaining_balance <= 0.01)
          OR (status = 'FINISHED' AND remaining_balance > 0.01)
        )
    `,
    prisma.$queryRaw<OrphanedNotificationSummary[]>`
      SELECT COUNT(*)::int AS orphaned_count
      FROM "Notification" n
      JOIN "Beneficiary" b ON b.id = n.beneficiary_id
      WHERE b.deleted_at IS NOT NULL
    `,
  ]);

  const driftCount = Number(driftSummary[0]?.drift_count ?? 0);
  const totalDrift = Number(driftSummary[0]?.total_drift ?? 0);
  const statusAnomalies = Number(statusSummary[0]?.anomaly_count ?? 0);
  const orphanedNotifications = Number(orphanedSummary[0]?.orphaned_count ?? 0);

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5 pb-16">
        <header className="space-y-2">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">صحة الرصيد والبيانات</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            لوحة متابعة سريعة لاكتشاف انحراف الأرصدة وتناقض الحالات والإشعارات اليتيمة.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="حالات انجراف الرصيد"
            value={driftCount.toLocaleString("ar-LY")}
            hint="عدد المستفيدين الذين لا يطابق رصيدهم المحسوب"
            icon={<Activity className="h-5 w-5" />}
          />
          <StatCard
            title="إجمالي الانجراف"
            value={`${totalDrift.toFixed(2)} د.ل`}
            hint="مجموع القيمة المطلقة لفروقات الأرصدة"
            icon={<AlertTriangle className="h-5 w-5" />}
          />
          <StatCard
            title="تناقضات الحالة"
            value={statusAnomalies.toLocaleString("ar-LY")}
            hint="ACTIVE برصيد صفري أو FINISHED برصيد موجب"
            icon={<BadgeAlert className="h-5 w-5" />}
          />
          <StatCard
            title="إشعارات يتيمة"
            value={orphanedNotifications.toLocaleString("ar-LY")}
            hint="إشعارات مرتبطة بمستفيدين محذوفين"
            icon={<BellOff className="h-5 w-5" />}
          />
        </div>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-base font-black text-amber-900 dark:text-amber-300">إصلاح تلقائي لانجراف الرصيد</h2>
              <p className="text-sm text-amber-800 dark:text-amber-400">
                سيُعاد حساب remaining_balance وتحديث الحالة لكل مستفيد متأثر، مع تسجيل العملية في سجل المراقبة.
              </p>
            </div>
            <FixBalancesButton />
          </div>
        </section>
      </div>
    </Shell>
  );
}
