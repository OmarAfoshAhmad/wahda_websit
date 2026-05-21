import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card } from "@/components/ui";
import Link from "next/link";
import { ArrowRight, Building2, Users, ShieldCheck, History, Printer } from "lucide-react";
import { DentalDeductForm } from "@/components/dental-deduct-form";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";

export default async function DentalCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin && !session.is_manager) redirect("/dashboard");

  const { companyId } = await params;
  const { tab } = await searchParams;
  const activeTab = tab === "transactions" ? "transactions" : "deduct";

  // جلب بيانات الشركة مع سياسة الأسنان
  const company = await prisma.insuranceCompany.findUnique({
    where: { id: companyId, deleted_at: null, is_active: true },
    include: {
      service_policies: {
        where: { service_type: "DENTAL", is_active: true },
      },
      _count: {
        select: { beneficiaries: { where: { deleted_at: null, status: "ACTIVE" } } },
      },
    },
  });

  if (!company) notFound();

  const dentalPolicy = company.service_policies[0] ?? null;
  const ceiling = dentalPolicy?.annual_ceiling ? Number(dentalPolicy.annual_ceiling) : null;
  const copay = dentalPolicy?.copay_percentage ? Number(dentalPolicy.copay_percentage) : 0;

  // جلب آخر 10 حركات أسنان لهذه الشركة في هذا المرفق
  const recentTransactions = await prisma.transaction.findMany({
    where: {
      company_id: companyId,
      facility_id: session.id,
      type: "DENTAL",
      is_cancelled: false,
    },
    include: {
      beneficiary: {
        select: {
          name: true,
          card_number: true,
        },
      },
    },
    orderBy: {
      created_at: "desc",
    },
    take: 10,
  });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        {/* breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Link href="/admin/dental-services" className="hover:text-teal-600 dark:hover:text-teal-400 font-bold transition-colors">
            خدمات الأسنان
          </Link>
          <ArrowRight className="h-4 w-4 rotate-180" />
          <span className="font-black text-slate-900 dark:text-white">{company.name}</span>
        </div>

        {/* بطاقة معلومات الشركة */}
        <Card className="p-5 border border-teal-200 dark:border-teal-850 bg-gradient-to-r from-teal-50/50 to-white dark:from-teal-900/10 dark:to-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400">
                {company.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.logo} alt={company.name} className="h-10 w-10 object-contain rounded-lg" />
                ) : (
                  <Building2 className="h-6 w-6" />
                )}
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-white">{company.name}</h1>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400 font-mono">{company.code}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2">
                <Users className="h-4 w-4 text-teal-600" />
                <span className="text-sm font-black text-slate-900 dark:text-white">{company._count.beneficiaries.toLocaleString("ar-LY")}</span>
                <span className="text-xs text-slate-500">مستفيد نشط</span>
              </div>
              {ceiling !== null ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-3 py-2">
                  <ShieldCheck className="h-4 w-4 text-teal-600" />
                  <span className="text-sm font-black text-teal-800 dark:text-teal-300">{ceiling.toLocaleString("ar-LY")} د.ل</span>
                  <span className="text-xs text-teal-600 dark:text-teal-400">سقف سنوي</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-black text-emerald-800 dark:text-emerald-300">سقف مفتوح</span>
                </div>
              )}
              {copay > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                  <span className="text-sm font-black text-amber-800 dark:text-amber-300">تحمل {copay}%</span>
                  <span className="text-xs text-amber-605 dark:text-amber-400">على المؤمن</span>
                </div>
              )}
              <Link
                href={`/admin/dental-transactions?company=${company.id}`}
                className="flex items-center gap-1.5 rounded-lg border border-teal-650 dark:border-teal-500 bg-teal-600 dark:bg-teal-950 text-white dark:text-teal-300 hover:bg-teal-700 dark:hover:bg-teal-900 px-3.5 py-2 text-xs font-black transition-all shadow-sm hover:scale-[1.02] active:scale-[0.98]"
              >
                <History className="h-4 w-4" />
                <span>السجل الكامل للشركة</span>
              </Link>
            </div>
          </div>
        </Card>

        {/* التبويبات لعزل الخصم عن الحركات */}
        {dentalPolicy && (
          <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-1 w-fit">
            <Link
              href={`/admin/dental-services/${companyId}?tab=deduct`}
              className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                activeTab === "deduct"
                  ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              إجراء الخصم
            </Link>
            <Link
              href={`/admin/dental-services/${companyId}?tab=transactions`}
              className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                activeTab === "transactions"
                  ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>آخر الحركات</span>
                <span className="text-[10px] font-black bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full">
                  {recentTransactions.length}
                </span>
              </div>
            </Link>
          </div>
        )}

        {!dentalPolicy && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-4">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
              ⚠️ لا توجد سياسة أسنان نشطة لهذه الشركة. يرجى تعريف سياسة من نوع DENTAL من قسم سياسات الخدمات.
            </p>
          </div>
        )}

        {/* نموذج ومحرك الاقتطاع التفاعلي لخدمات الأسنان */}
        {dentalPolicy && activeTab === "deduct" && (
          <DentalDeductForm
            companyId={companyId}
            companyName={company.name}
            annualCeiling={ceiling}
            copayPercentage={copay}
          />
        )}

        {/* جدول آخر 10 حركات أسنان للشركة في هذا المرفق */}
        {dentalPolicy && activeTab === "transactions" && (
          <Card className="p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <History className="h-5 w-5 text-teal-600" />
                  آخر 10 حركات أسنان لهذه الشركة في هذا المرفق
                </h2>
                <span className="text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-2.5 py-1">
                  سجل المرفق الحالي
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/dental-services/${companyId}/print`}
                  target="_blank"
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-xs font-black text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-350 transition-colors shadow-sm"
                >
                  <Printer className="h-4 w-4 text-teal-600" />
                  <span>طباعة الكشف</span>
                </Link>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400">المستفيد</th>
                    <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400">رقم البطاقة</th>
                    <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">قيمة الفاتورة</th>
                    <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">حصة الشركة</th>
                    <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">حصة المؤمن</th>
                    <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400">التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recentTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400 font-bold">
                        لا توجد حركات سابقة لهذه الشركة في هذا المرفق بعد.
                      </td>
                    </tr>
                  ) : (
                    recentTransactions.map((tx) => {
                      const amount = Number(tx.amount);
                      const companyShare = tx.actual_company_share !== null ? Number(tx.actual_company_share) : 0;
                      const patientShare = tx.actual_patient_share !== null ? Number(tx.actual_patient_share) : 0;

                      return (
                        <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-3.5 font-black text-slate-900 dark:text-white">
                            {tx.beneficiary?.name ?? "—"}
                          </td>
                          <td className="px-4 py-3.5 font-mono font-bold text-slate-600 dark:text-slate-400 text-xs">
                            {tx.beneficiary?.card_number ?? "—"}
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono font-black text-slate-900 dark:text-white">
                            {amount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono font-black text-teal-700 dark:text-teal-400">
                            {companyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono font-black text-amber-600 dark:text-amber-450">
                            {patientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                          </td>
                          <td className="px-4 py-3.5 text-xs">
                            <span className="font-bold text-slate-700 dark:text-slate-300">{formatDateTripoli(tx.created_at)}</span>
                            <span className="text-slate-400 mr-2">{formatTimeTripoli(tx.created_at)}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
