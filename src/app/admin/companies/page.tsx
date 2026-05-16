import { redirect } from "next/navigation";
import { Building2, Plus, Edit2, Power, PowerOff } from "lucide-react";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card, Badge, Button } from "@/components/ui";
import { CompanyForm } from "./company-form";
import { DeleteCompany } from "./delete-company";
import { toggleCompanyStatus } from "@/app/actions/company";

export default async function CompaniesPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin && !session.is_manager) {
    redirect("/dashboard");
  }

  const companies = await prisma.insuranceCompany.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { 
          service_policies: true 
        }
      },
      beneficiaries: {
        select: {
          id: true,
          deleted_at: true
        }
      }
    }
  });

  const companiesWithStats = companies.map(company => {
    const active = company.beneficiaries.filter(b => !b.deleted_at).length;
    const deleted = company.beneficiaries.filter(b => !!b.deleted_at).length;
    return {
      ...company,
      stats: { active, deleted }
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
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">السياسات</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">الحالة</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {companiesWithStats.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-slate-500 dark:text-slate-400 font-bold">
                        لا توجد شركات مسجلة حالياً.
                      </td>
                    </tr>
                  ) : (
                    companiesWithStats.map((company) => (
                      <tr key={company.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-blue-900/30 dark:text-blue-400">
                              <Building2 className="h-5 w-5" />
                            </div>
                            <span className="font-black text-slate-900 dark:text-white">{company.name}</span>
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
                        <td className="px-5 py-4 text-center">
                          <Badge variant="info" className="font-mono">
                            {company._count.service_policies}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <Badge variant={company.is_active ? "success" : "danger"}>
                            {company.is_active ? "نشط" : "متوقف"}
                          </Badge>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-center gap-1">
                            <CompanyForm company={company} />
                            {session.is_admin && company.stats.active === 0 && (
                              <DeleteCompany companyId={company.id} companyName={company.name} />
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
