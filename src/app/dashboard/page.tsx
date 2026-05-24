import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { DeductForm } from "@/components/deduct-form";
import { Card } from "@/components/ui";
import { Users, CreditCard, TrendingDown, Building2, AlertTriangle } from "lucide-react";
import { unstable_cache } from "next/cache";

// ─── كاش إحصائيات المشرف: تتحدث كل 60 ثانية ───
const getCachedAdminStats = unstable_cache(
  async () => {
    const [stats, facilityCount] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          total_beneficiaries: bigint;
          active_beneficiaries: bigint;
        }>
      >`
        SELECT
          COUNT(*) FILTER (WHERE "deleted_at" IS NULL) AS total_beneficiaries,
          COUNT(*) FILTER (WHERE "deleted_at" IS NULL AND status = 'ACTIVE') AS active_beneficiaries
        FROM "Beneficiary"
        WHERE ("company_id" = 'cmp7ha2km0000u9v8jse4ib5x' OR "company_id" IS NULL)
      `,
      prisma.facility.count({ where: { deleted_at: null } })
    ]);
    return {
      total_beneficiaries: stats[0]?.total_beneficiaries ? Number(stats[0].total_beneficiaries) : 0,
      active_beneficiaries: stats[0]?.active_beneficiaries ? Number(stats[0].active_beneficiaries) : 0,
      facilityCount,
    };
  },
  ["admin-dashboard-stats-v2"], // Incremented version to bust cache
  { revalidate: 60 }
);

// ─── كاش حركات اليوم للحساب الحالي: تتحدث كل 30 ثانية ───
function getCachedTodayStats(facilityId: string) {
  return unstable_cache(
    async () => {
      const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
      const result = await prisma.transaction.aggregate({
        where: {
          ...(facilityId !== "admin" ? { facility_id: facilityId } : {}),
          created_at: { gte: startOfDay },
          is_cancelled: false,
          type: { not: "DENTAL" },
          OR: [
            { company_id: "cmp7ha2km0000u9v8jse4ib5x" },
            { company_id: null }
          ],
        },
        _sum: { amount: true },
        _count: true,
      });
      return {
        amount: Number(result._sum.amount ?? 0),
        count: result._count,
      };
    },
    [`today-transactions-stats-v4-${facilityId}`], // Incremented version to bust cache
    { revalidate: 30 }
  )();
}

export default async function Dashboard() {
  const session = await getSessionWithFreshPermissions();
  
  if (!session) {
    redirect("/login");
  }

  const canUseCashClaim = hasPermission(session, "cash_claim");
  const hasAdminNav = hasPermission(session, "view_facilities") || 
                      hasPermission(session, "view_beneficiaries") ||
                      hasPermission(session, "manage_card_numbering") ||
                      hasPermission(session, "view_audit_log");

  if (session.role === "EMPLOYEE" && canUseCashClaim && !hasAdminNav) {
    redirect("/cash-claim");
  }

  const canViewStats = session.role === "ADMIN" || session.role === "MANAGER";
  const isAdmin = session.role === "ADMIN";
  const canUseDeduct = session.role !== "EMPLOYEE" && (session.role !== "MANAGER" || hasPermission(session, "deduct_balance"));
  const cacheTag = isAdmin ? "admin" : session.id;

  const [adminStats, todayStats] = await Promise.all([
    canViewStats ? getCachedAdminStats() : Promise.resolve({ total_beneficiaries: 0, active_beneficiaries: 0, facilityCount: 0 }),
    getCachedTodayStats(cacheTag)
  ]);

  const totalBeneficiaries = adminStats.total_beneficiaries;
  const activeBeneficiaries = adminStats.active_beneficiaries;
  const facilityCount = adminStats.facilityCount;

  const todayAmount = todayStats.amount;
  const todayCount = todayStats.count;

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        {/* عنوان الصفحة */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">مرحباً، {session.name}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {session.role === "ADMIN" ? "لوحة تحكم المشرف (المبرمج)" : session.role === "MANAGER" ? "لوحة تحكم المدير" : "نافذة الخصم والمتابعة"}
            </p>
          </div>
        </div>

        {/* نموذج الخصم */}
        {canUseDeduct ? (
          <div className="rounded-xl bg-white/50 dark:bg-slate-900/50 p-1 border border-slate-200/50 dark:border-slate-800/50">
            <DeductForm facilityType={session.facility_type} />
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 text-center dark:border-amber-900/30 dark:bg-amber-900/10">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
            <h2 className="text-lg font-black text-amber-800 dark:text-amber-400">غير مصرح لك بالخصم</h2>
            <p className="mt-1 text-sm text-amber-600 dark:text-amber-500">لا تملك صلاحية &quot;إمكانية خصم الرصيد&quot;. يرجى مراجعة مبرمج النظام.</p>
          </div>
        )}

        {/* بطاقات الإحصائيات */}
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${canViewStats ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
          {canViewStats && (
            <>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">إجمالي المستفيدين</p>
                    <p className="mt-1.5 text-2xl font-black text-slate-900 dark:text-slate-100">{totalBeneficiaries.toLocaleString("ar-LY")}</p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
                    <Users className="h-5 w-5" />
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">المستفيدون النشطون</p>
                    <p className="mt-1.5 text-2xl font-black text-emerald-600 dark:text-emerald-400">{activeBeneficiaries.toLocaleString("ar-LY")}</p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <CreditCard className="h-5 w-5" />
                  </div>
                </div>
              </Card>
            </>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">حركات اليوم</p>
                <p className="mt-1.5 text-2xl font-black text-slate-900 dark:text-slate-100">{todayCount.toLocaleString("ar-LY")}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{todayAmount.toLocaleString("ar-LY")} د.ل</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                <TrendingDown className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {isAdmin && (
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">المرافق الصحية</p>
                  <p className="mt-1.5 text-2xl font-black text-slate-900 dark:text-slate-100">{facilityCount.toLocaleString("ar-LY")}</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                  <Building2 className="h-5 w-5" />
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
