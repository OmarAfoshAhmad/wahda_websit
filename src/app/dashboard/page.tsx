import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { DeductForm } from "@/components/deduct-form";
import { Card } from "@/components/ui";
import { Users, CreditCard, TrendingDown, Building2 } from "lucide-react";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  // إحصائيات مخصصة حسب نوع المستخدم
  const isAdmin = session.is_admin;

  const [stats, todayStats] = await Promise.all([
    // الإحصائيات العامة
    isAdmin
      ? prisma.$queryRaw<
          Array<{
            total_beneficiaries: bigint;
            active_beneficiaries: bigint;
            total_facilities: bigint;
          }>
        >`
          SELECT
            COUNT(*) FILTER (WHERE "deleted_at" IS NULL) AS total_beneficiaries,
            COUNT(*) FILTER (WHERE "deleted_at" IS NULL AND status = 'ACTIVE') AS active_beneficiaries,
            0::bigint AS total_facilities
          FROM "Beneficiary"
        `
      : Promise.resolve(null),

    // حركات اليوم
    prisma.transaction.aggregate({
      where: {
        ...(isAdmin ? {} : { facility_id: session.id }),
        created_at: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        is_cancelled: false,
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  let facilityCount = 0;
  if (isAdmin) {
    facilityCount = await prisma.facility.count({ where: { deleted_at: null } });
  }

  const stat = stats?.[0];
  const totalBeneficiaries = stat ? Number(stat.total_beneficiaries) : 0;
  const activeBeneficiaries = stat ? Number(stat.active_beneficiaries) : 0;
  const todayAmount = Number(todayStats._sum.amount ?? 0);
  const todayCount = todayStats._count;

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
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
