import { redirect } from "next/navigation";
import { Stethoscope, Users, Building2, Upload, ChevronLeft, ShieldCheck } from "lucide-react";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";
import Link from "next/link";
import { DentalImportUploader } from "@/components/dental-import-uploader";
import { Decimal } from "@prisma/client/runtime/library";

export default async function DentalServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  
  const canAccess = session.is_admin || hasPermission(session, "dental_services");
  if (!canAccess) {
    redirect("/dashboard");
  }





  const canImport = session.is_admin || hasPermission(session, "import_beneficiaries");
  const { tab } = await searchParams;
  let activeTab = tab === "import" ? "import" : "companies";
  if (!canImport && activeTab === "import") {
    activeTab = "companies";
  }

  // جلب شركات التأمين مع إحصائيات المستفيدين
  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          beneficiaries: {
            where: { deleted_at: null, status: "ACTIVE" },
          },
        },
      },
    },
  });

  // جميع الشركات النشطة تدعم خدمات الأسنان
  const dentalCompanies = companies;
  // جميع الشركات (للاستيراد)
  const allCompaniesForImport = companies.map(c => ({ id: c.id, name: c.name, code: c.code }));

  const DENTAL_COLORS = [
    { bg: "from-teal-50 to-teal-100/50", border: "border-teal-200", icon: "bg-teal-100 text-teal-700", badge: "bg-teal-100 text-teal-700" },
    { bg: "from-sky-50 to-sky-100/50", border: "border-sky-200", icon: "bg-sky-100 text-sky-700", badge: "bg-sky-100 text-sky-700" },
    { bg: "from-violet-50 to-violet-100/50", border: "border-violet-200", icon: "bg-violet-100 text-violet-700", badge: "bg-violet-100 text-violet-700" },
    { bg: "from-emerald-50 to-emerald-100/50", border: "border-emerald-200", icon: "bg-emerald-100 text-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
    { bg: "from-amber-50 to-amber-100/50", border: "border-amber-200", icon: "bg-amber-100 text-amber-700", badge: "bg-amber-100 text-amber-700" },
    { bg: "from-rose-50 to-rose-100/50", border: "border-rose-200", icon: "bg-rose-100 text-rose-700", badge: "bg-rose-100 text-rose-700" },
  ];

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        {/* العنوان */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400">
                <Stethoscope className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white">خدمات الأسنان</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              إدارة مستفيدي شركات التأمين لخدمات الأسنان وتطبيق الاقتطاع المالي.
            </p>
          </div>
        </div>



        {/* التبويبات */}
        <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-1 w-fit">
          <Link
            href="/admin/dental-services?tab=companies"
            className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
              activeTab === "companies"
                ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              شركات التأمين
              <span className="text-[10px] font-black bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full">
                {dentalCompanies.length}
              </span>
            </div>
          </Link>
          {canImport && (
            <Link
              href="/admin/dental-services?tab=import"
              className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                activeTab === "import"
                  ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                استيراد المستفيدين
              </div>
            </Link>
          )}
        </div>

        {/* محتوى التبويب: الشركات */}
        {activeTab === "companies" && (
          <div>
            {dentalCompanies.length === 0 ? (
              <Card className="p-12 text-center border-dashed border-2 border-slate-200 dark:border-slate-700">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 mx-auto mb-4">
                  <Stethoscope className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-black text-slate-700 dark:text-slate-300">لا توجد شركات بسياسة أسنان</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  يرجى إضافة شركات التأمين وتعريف سياسات الأسنان (DENTAL) لها من قسم الصيانة.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {dentalCompanies.map((company, idx) => {
                  const colors = DENTAL_COLORS[idx % DENTAL_COLORS.length];
                  const ceiling = company.dental_ceiling ? Number(company.dental_ceiling) : null;
                  const copay = Math.max(0, 100 - Number(company.dental_coverage));
                  const beneficiaryCount = company._count.beneficiaries;

                  return (
                    <Link
                      key={company.id}
                      href={`/admin/dental-services/${company.id}`}
                      className={`group block rounded-xl border ${colors.border} bg-gradient-to-br ${colors.bg} p-5 transition-all duration-200 hover:shadow-md hover:scale-[1.01] dark:bg-none dark:bg-slate-800/50 dark:border-slate-700`}
                    >
                      <div className="flex items-center justify-between mb-4 gap-4">
                        {/* اليمين: اسم الشركة والكود */}
                        <div className="min-w-0">
                          <h3 className="text-base font-black text-slate-900 dark:text-white mb-1 leading-snug">{company.name}</h3>
                          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 font-mono">{company.code}</p>
                        </div>
                        {/* اليسار: الشعار والـ Chevron */}
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex h-16 w-24 items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-sm p-1.5">
                            {company.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={company.logo} alt={company.name} className="h-full w-full object-contain rounded-lg" />
                            ) : (
                              <Building2 className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                            )}
                          </div>
                          <ChevronLeft className="h-5 w-5 text-slate-400 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors -rotate-180" />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${colors.badge} dark:bg-slate-700 dark:text-slate-300`}>
                          <Users className="h-3 w-3" />
                          {beneficiaryCount.toLocaleString("ar-LY")} مستفيد نشط
                        </span>
                        {ceiling !== null ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-white/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            <ShieldCheck className="h-3 w-3 text-teal-600" />
                            سقف {ceiling.toLocaleString("ar-LY")} د.ل
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-white/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            <ShieldCheck className="h-3 w-3 text-emerald-600" />
                            سقف مفتوح
                          </span>
                        )}
                        {copay > 0 && (
                          <span className="inline-flex items-center text-[11px] font-bold px-2 py-1 rounded-full bg-white/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            تحمل {copay}%
                          </span>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700">
                        <p className="text-xs font-bold text-teal-600 dark:text-teal-400 group-hover:text-teal-700">
                          انقر للبحث والاقتطاع ←
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* محتوى التبويب: الاستيراد */}
        {activeTab === "import" && (
          <div>
            {allCompaniesForImport.length === 0 ? (
              <Card className="p-12 text-center">
                <p className="text-slate-500">لا توجد شركات تأمين مسجلة. أضف شركة أولاً من قسم الصيانة.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/10 p-4">
                  <p className="text-sm font-bold text-teal-800 dark:text-teal-300">
                    📋 تعليمات الاستيراد: اختر شركة التأمين المستهدفة، ثم ارفع ملف Excel يحتوي على أعمدة <code className="bg-teal-100 dark:bg-teal-800 px-1 rounded">card_number</code> و <code className="bg-teal-100 dark:bg-teal-800 px-1 rounded">name</code>. سيتم ربط المستفيدين تلقائياً بالشركة المختارة.
                  </p>
                </div>
                <DentalImportUploader companies={allCompaniesForImport} />
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
