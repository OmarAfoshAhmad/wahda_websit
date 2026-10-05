import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronLeft, MessagesSquare, Pill, Receipt, ShieldCheck, Store, Users } from "lucide-react";
import { getFacilityOrdersBadge } from "@/app/actions/pharmacy-orders";
import { Shell } from "@/components/shell";
import { Card } from "@/components/ui";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";

const CARD_COLORS = [
  { bg: "from-teal-50 to-teal-100/50", border: "border-teal-200", badge: "bg-teal-100 text-teal-700" },
  { bg: "from-sky-50 to-sky-100/50", border: "border-sky-200", badge: "bg-sky-100 text-sky-700" },
  { bg: "from-violet-50 to-violet-100/50", border: "border-violet-200", badge: "bg-violet-100 text-violet-700" },
  { bg: "from-emerald-50 to-emerald-100/50", border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-700" },
  { bg: "from-amber-50 to-amber-100/50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700" },
  { bg: "from-rose-50 to-rose-100/50", border: "border-rose-200", badge: "bg-rose-100 text-rose-700" },
];

export default async function PharmacyServicesPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");

  const canAccess = hasPermission(session, "pharmacy_services")
    || hasPermission(session, "view_pharmacy_beneficiaries");
  if (!canAccess) redirect("/dashboard");

  const isFacility = session.role === "FACILITY"
    || (!session.is_admin && !session.is_manager && !session.is_employee);
  const transactionFilter = {
    is_cancelled: false,
    type: "MEDICINE" as const,
    ...(isFacility ? { facility_id: session.id } : {}),
  };

  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          beneficiaries: { where: { deleted_at: null, status: "ACTIVE" } },
          transactions: { where: transactionFilter },
        },
      },
      service_policies: {
        where: { service_type: { code: "MEDICINE" }, is_active: true },
        select: {
          ceiling_amount: true,
          coverage_percent: true,
          frequency_months: true,
          pharmacy_config: {
            select: {
              routine_enabled: true,
              routine_ceiling: true,
              routine_coverage_percent: true,
              routine_frequency_months: true,
              routine_prescription_limit: true,
              chronic_enabled: true,
              chronic_ceiling: true,
              chronic_coverage_percent: true,
              chronic_frequency_months: true,
              chronic_prescription_limit: true,
              chemical_enabled: true,
              chemical_ceiling: true,
              chemical_coverage_percent: true,
              chemical_frequency_months: true,
              chemical_prescription_limit: true,
              default_prescription_limit: true,
            },
          },
        },
      },
    },
  });

  const ordersBadge = hasPermission(session, "pharmacy_services") ? (await getFacilityOrdersBadge()).count : 0;
  const pharmacyCompanies = companies.filter((company) => company.service_policies.length > 0);

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
              <Pill className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">خدمات الصيدلية</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            إدارة صرف الأدوية لمستفيدي شركات التأمين وفق السقوف ونسب التغطية المعتمدة.
          </p>
          <div className="flex flex-wrap gap-2">
          {hasPermission(session, "pharmacy_services") && (
            <>
              <Link href="/admin/pharmacy-services/orders" className="inline-flex w-fit items-center gap-1.5 rounded-md bg-teal-600 px-3 py-2 text-sm font-bold text-white hover:bg-teal-700">
                <MessagesSquare className="h-4 w-4" /> طلبات المستفيدين
                {ordersBadge > 0 && <span className="rounded-full bg-white px-1.5 text-xs font-black text-teal-700">{ordersBadge}</span>}
              </Link>
              <Link href="/admin/pharmacy-services/transactions" className="inline-flex w-fit items-center gap-1.5 rounded-md border border-teal-300 px-3 py-2 text-sm font-bold text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/30">
                <Receipt className="h-4 w-4" /> حركات الصيدلية
              </Link>
              <Link href="/admin/pharmacy-services/my-pharmacy" className="inline-flex w-fit items-center gap-1.5 rounded-md border border-teal-300 px-3 py-2 text-sm font-bold text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/30">
                <Store className="h-4 w-4" /> بيانات صيدليتي
              </Link>
            </>
          )}
          {hasPermission(session, "manage_companies") && (
            <Link href="/admin/pharmacy-services/chronic-import" className="inline-flex w-fit items-center gap-1.5 rounded-md border border-teal-300 px-3 py-2 text-sm font-bold text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/30">
              <Pill className="h-4 w-4" /> استيراد الأدوية المزمنة من Excel
            </Link>
          )}
          </div>
        </div>

        {pharmacyCompanies.length === 0 ? (
          <Card className="border-2 border-dashed border-slate-200 p-12 text-center dark:border-slate-700">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Pill className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-black text-slate-700 dark:text-slate-300">لا توجد شركات بسياسة أدوية</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              يرجى تعريف سياسة أدوية (MEDICINE) فعالة للشركة من قسم سياسات التأمين.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pharmacyCompanies.map((company, index) => {
              const colors = CARD_COLORS[index % CARD_COLORS.length];
              const policy = company.service_policies[0];
              const coverage = Number(policy.coverage_percent);
              const pharmacyConfig = policy.pharmacy_config;
              const categoryCeilings: Array<{ label: string; value: number | null; coverage: number; frequency: number | null }> = [];
              if (pharmacyConfig?.routine_enabled) categoryCeilings.push({ label: "روتيني", value: pharmacyConfig.routine_ceiling === null ? null : Number(pharmacyConfig.routine_ceiling), coverage: pharmacyConfig.routine_coverage_percent === null ? coverage : Number(pharmacyConfig.routine_coverage_percent), frequency: pharmacyConfig.routine_frequency_months ?? policy.frequency_months });
              if (pharmacyConfig?.chronic_enabled) categoryCeilings.push({ label: "مزمن", value: pharmacyConfig.chronic_ceiling === null ? null : Number(pharmacyConfig.chronic_ceiling), coverage: pharmacyConfig.chronic_coverage_percent === null ? coverage : Number(pharmacyConfig.chronic_coverage_percent), frequency: pharmacyConfig.chronic_frequency_months ?? policy.frequency_months });
              if (pharmacyConfig?.chemical_enabled) categoryCeilings.push({ label: "كيميائي", value: pharmacyConfig.chemical_ceiling === null ? null : Number(pharmacyConfig.chemical_ceiling), coverage: pharmacyConfig.chemical_coverage_percent === null ? coverage : Number(pharmacyConfig.chemical_coverage_percent), frequency: pharmacyConfig.chemical_frequency_months ?? policy.frequency_months });

              return (
                <Link
                  key={company.id}
                  href={`/admin/pharmacy-services/${company.id}`}
                  className={`group block rounded-xl border ${colors.border} bg-gradient-to-br ${colors.bg} p-5 transition-all duration-200 hover:scale-[1.01] hover:shadow-md dark:border-slate-700 dark:bg-none dark:bg-slate-800/50`}
                >
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="mb-1 text-base font-black leading-snug text-slate-900 dark:text-white">{company.name}</h3>
                      <p className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400">{company.code}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                        {company.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={company.logo} alt={company.name} className="h-full w-full rounded-lg object-contain" />
                        ) : (
                          <Building2 className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                        )}
                      </div>
                      <ChevronLeft className="h-5 w-5 -rotate-180 text-slate-400 transition-colors group-hover:text-teal-600 dark:group-hover:text-teal-400" />
                    </div>
                  </div>

                  <div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${colors.badge} dark:bg-slate-700 dark:text-slate-300`}>
                      <Users className="h-3 w-3" />
                      {company._count.beneficiaries.toLocaleString("ar-LY")} مستفيد نشط
                    </span>
                    <div className="mt-1.5 grid w-full gap-1.5">
                    {categoryCeilings.map((category) => {
                      const periodLabel = category.frequency === 1
                        ? "شهري"
                        : category.frequency === 12
                          ? "سنوي"
                          : category.frequency === null
                            ? "غير محدد"
                            : `كل ${category.frequency.toLocaleString("ar-LY")} أشهر`;
                      return (
                      <span key={category.label} className="flex w-full items-center gap-1 rounded-full border border-slate-200 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <ShieldCheck className={`h-3 w-3 shrink-0 ${category.value === null ? "text-emerald-600" : "text-teal-600"}`} />
                        {category.label}: تغطية {category.coverage.toLocaleString("ar-LY")}% · سقف {category.value === null ? "مفتوح" : `${category.value.toLocaleString("ar-LY")} د.ل`} ({periodLabel})
                      </span>
                      );
                    })}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-200/60 pt-3 dark:border-slate-700">
                    <p className="text-xs font-bold text-teal-600 group-hover:text-teal-700 dark:text-teal-400">انقر للبحث والصرف ←</p>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {company._count.transactions.toLocaleString("ar-LY")} حركة مسجلة
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
