import { redirect } from "next/navigation";
import { Building2, Plus, Edit2, Power, PowerOff } from "lucide-react";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card, Badge, Button } from "@/components/ui";
import { CompanyForm } from "./company-form";
import { DeleteCompany } from "./delete-company";
import { PurgeBeneficiaries } from "./purge-beneficiaries";
import { toggleCompanyStatus } from "@/app/actions/company";

export default async function CompaniesPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin && !session.is_manager) {
    redirect("/dashboard");
  }

  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { 
          transactions: true,
          beneficiaries: true,  // total (active + deleted)
        }
      },
      service_policies: {
        where: { service_type: { code: 'DENTAL' } },
        select: { ceiling_amount: true, coverage_percent: true }
      }
    }
  });

  // حساب المستفيدين النشطين والمحذوفين بطريقة مجمعة (أداء عال)
  const activeCounts = await prisma.beneficiary.groupBy({
    by: ["company_id"],
    where: { deleted_at: null },
    _count: { _all: true },
  });
  const deletedCounts = await prisma.beneficiary.groupBy({
    by: ["company_id"],
    where: { deleted_at: { not: null } },
    _count: { _all: true },
  });

  const activeMap = new Map(activeCounts.map(r => [r.company_id, r._count._all]));
  const deletedMap = new Map(deletedCounts.map(r => [r.company_id, r._count._all]));

  const companiesWithStats = companies.map((c: any) => {
    const dentalPolicy = c.service_policies?.[0];
    return {
      ...c,
      dental_ceiling: dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null,
      dental_coverage: dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100,
    general_ceiling: c.general_ceiling ? Number(c.general_ceiling) : null,
    general_coverage: c.general_coverage ? Number(c.general_coverage) : 80,
    medicine_ceiling: c.medicine_ceiling ? Number(c.medicine_ceiling) : null,
    medicine_coverage: c.medicine_coverage ? Number(c.medicine_coverage) : 80,
    dental_settings: c.dental_settings ? JSON.parse(JSON.stringify(c.dental_settings)) : null,
    service_type_mappings: c.service_type_mappings ? JSON.parse(JSON.stringify(c.service_type_mappings)) : null,
    created_at: c.created_at.toISOString(),
    updated_at: c.updated_at.toISOString(),
    deleted_at: c.deleted_at ? c.deleted_at.toISOString() : null,
    stats: {
      active: activeMap.get(c.id) ?? 0,
      deleted: deletedMap.get(c.id) ?? 0,
    }
  };
  });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-24">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">إدارة شركات التأمين</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              إدارة الجهات الضامنة، أنماط البطاقات، والربط مع سياسات الخدمات.
            </p>
          </div>
          <CompanyForm />
        </div>

        <div className="grid gap-6">
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase">اسم الشركة</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase">الكود</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase">نمط البطاقات</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">المستفيدون</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">السقف المالي</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">نسبة التغطية</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">الحالة</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {companiesWithStats.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-slate-500 dark:text-slate-400 font-bold">
                        لا توجد شركات مسجلة حالياً.
                      </td>
                    </tr>
                  ) : (
                    companiesWithStats.map((company) => (
                      <tr key={company.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {company.logo ? (
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 shadow-sm">
                                <img src={company.logo} alt={company.name} className="h-full w-full object-contain rounded" />
                              </div>
                            ) : (
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-blue-900/30 dark:text-blue-400">
                                <Building2 className="h-5 w-5" />
                              </div>
                            )}
                            <div className="flex flex-col">
                              <span className="font-black text-slate-900 dark:text-white leading-tight">{company.name}</span>
                              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                                الأسنان: {company.dental_ceiling ? `${Number(company.dental_ceiling).toLocaleString("ar-LY")} د.ل` : "مفتوح"} | تغطية {Number(company.dental_coverage)}%
                              </span>
                              {company.dental_settings && (() => {
                                const settings = company.dental_settings;
                                const activePolicies = [];
                                if (settings.ortho?.enabled) {
                                  activePolicies.push(`تقويم (${settings.ortho.coverage}%)`);
                                }
                                if (settings.implant?.enabled) {
                                  activePolicies.push(`زراعة (${settings.implant.coverage}%)`);
                                }
                                if (settings.prosthetics?.enabled) {
                                  activePolicies.push(`تركيبات (${settings.prosthetics.coverage}%)`);
                                }
                                if (activePolicies.length === 0) return null;
                                return (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {activePolicies.map((policy, idx) => (
                                      <span key={idx} className="inline-flex items-center rounded bg-teal-50 dark:bg-teal-950/40 px-1 py-0.2 text-[8px] font-extrabold text-teal-700 dark:text-teal-400 border border-teal-200/40 dark:border-teal-900/20">
                                        {policy}
                                      </span>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 font-mono text-sm font-bold text-slate-600 dark:text-slate-300">
                          {company.code}
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {company.card_pattern || "بدون نمط"}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <Badge variant="success" className="font-mono text-[10px] px-1.5 py-0">
                              {company.stats.active.toLocaleString()} نشط
                            </Badge>
                            {company.stats.deleted > 0 && (
                              <Badge variant="warning" className="font-mono text-[10px] px-1.5 py-0 opacity-60">
                                {company.stats.deleted.toLocaleString()} محذوف
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center font-mono font-black text-sm text-slate-900 dark:text-white">
                          {company.dental_ceiling ? `${Number(company.dental_ceiling).toLocaleString("ar-LY")} د.ل` : "مفتوح"}
                        </td>
                        <td className="px-5 py-4 text-center font-mono font-black text-sm text-teal-700 dark:text-teal-400">
                          {company.dental_coverage !== null ? `${Number(company.dental_coverage)}%` : "0%"}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <Badge variant={company.is_active ? "success" : "danger"}>
                            {company.is_active ? "نشط" : "متوقف"}
                          </Badge>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-center gap-1">
                            <CompanyForm company={company} />
                            {session.is_admin && (
                              <>
                                <PurgeBeneficiaries
                                  companyId={company.id}
                                  companyName={company.name}
                                  activeBeneficiariesCount={company.stats.active}
                                />
                                <DeleteCompany 
                                  companyId={company.id} 
                                  companyName={company.name} 
                                  activeBeneficiariesCount={company.stats.active}
                                  hasTransactions={company._count.transactions > 0}
                                />
                              </>
                            )}
                            <form action={toggleCompanyStatus.bind(null, company.id, company.is_active) as unknown as (formData: FormData) => void}>
                              <button
                                type="submit"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary dark:hover:text-blue-400"
                                title={company.is_active ? "إيقاف الشركة" : "تفعيل الشركة"}
                              >
                                {company.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
