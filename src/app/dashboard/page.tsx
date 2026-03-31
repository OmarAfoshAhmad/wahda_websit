import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { DeductForm } from "@/components/deduct-form";
import { Card } from "@/components/ui";
import { Users, CreditCard, TrendingDown, Building2 } from "lucide-react";
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
      `,
      prisma.facility.count({ where: { deleted_at: null } })
    ]);
    return {
      total_beneficiaries: stats[0]?.total_beneficiaries ? Number(stats[0].total_beneficiaries) : 0,
      active_beneficiaries: stats[0]?.active_beneficiaries ? Number(stats[0].active_beneficiaries) : 0,
      facilityCount,
    };
  },
  ["admin-dashboard-stats-v1"],
  { revalidate: 60 }
);

// ─── كاش حركات اليوم للحساب الحالي: تتحدث كل 30 ثانية ───
const getCachedTodayStats = unstable_cache(
  async (facilityId: string) => {
    // startOfDay string key is constant for today
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const result = await prisma.transaction.aggregate({
      where: {
        ...(facilityId !== "admin" ? { facility_id: facilityId } : {}),
        created_at: { gte: startOfDay },
        is_cancelled: false,
      },
      _sum: { amount: true },
      _count: true,
    });
    return {
      amount: Number(result._sum.amount ?? 0),
      count: result._count,
    };
  },
  // تضمين facilityId في مفتاح الكاش لمنع تصادم البيانات بين المرافق
  ["today-transactions-stats-v2"],
  { revalidate: 30 }
);

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAdmin = session.is_admin || session.is_manager;
  const cacheTag = isAdmin ? "admin" : session.id;

  const [adminStats, todayStats] = await Promise.all([
    isAdmin ? getCachedAdminStats() : Promise.resolve({ total_beneficiaries: 0, active_beneficiaries: 0, facilityCount: 0 }),
    getCachedTodayStats(cacheTag)
  ]);

  const totalBeneficiaries = adminStats.total_beneficiaries;
  const activeBeneficiaries = adminStats.active_beneficiaries;
  const facilityCount = adminStats.facilityCount;
  
  const todayAmount = todayStats.amount;
  const todayCount = todayStats.count;

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin} isManager={session.is_manager}>
      <div className="space-y-5">
        {/* عنوان الصفحة */}
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">مرحباً، {session.name}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isAdmin ? "لوحة تحكم المشرف" : "نافذة الخصم والمتابعة"}
          </p>
        </div>

        {/* بطاقات الإحصائيات */}
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
          {isAdmin && (
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

        {/* نموذج الخصم */}
        <div>
          <h2 className="mb-3 text-lg font-black text-slate-900 dark:text-white">خصم الأرصدة</h2>
          <DeductForm />
        </div>
      </div>
    </Shell>
  );
}
