import { redirect } from "next/navigation";
import { ShieldCheck, Plus, Settings2, Trash2 } from "lucide-react";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card, Badge, Button } from "@/components/ui";
import { PolicyForm } from "./policy-form";
import { formatCurrency } from "@/lib/money";

export default async function PoliciesPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin && !session.is_manager) {
    redirect("/dashboard");
  }

  const [rawPolicies, companies] = await Promise.all([
    prisma.servicePolicy.findMany({
      include: { company: true },
      orderBy: [{ company: { name: "asc" } }, { service_type: "asc" }]
    }),
    prisma.insuranceCompany.findMany({
      where: { is_active: true },
      orderBy: { name: "asc" }
    })
  ]);

  const policies = rawPolicies.map(p => ({
    ...p,
    annual_ceiling: Number(p.annual_ceiling),
    copay_percentage: Number(p.copay_percentage)
  }));

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-24">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">سياسات الخدمات الطبية</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              ضبط السقوف السنوية، نسب التحمل، وقواعد التغطية لكل شركة.
            </p>
          </div>
          <PolicyForm companies={companies} />
        </div>

        <div className="grid gap-6">
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase">الشركة</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase">نوع الخدمة</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">السقف السنوي</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">نسبة التحمل</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">التغطية الجزئية</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">الحالة</th>
                    <th className="px-5 py-4 text-xs font-black text-slate-500 dark:text-slate-400 uppercase text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {policies.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-slate-500 dark:text-slate-400 font-bold">
                        لا توجد سياسات معرفة حالياً. اضغط على "إضافة سياسة" للبدء.
                      </td>
                    </tr>
                  ) : (
                    policies.map((policy) => (
                      <tr key={policy.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-5 py-4">
                          <span className="font-black text-slate-900 dark:text-white">{policy.company.name}</span>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant="info" className="font-black">
                            {policy.service_type === "GENERAL" ? "كشف عام / أدوية" : 
                             policy.service_type === "DENTAL" ? "أسنان" : 
                             policy.service_type === "OPTICS" ? "بصريات" : 
                             policy.service_type}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-center font-mono font-bold text-primary dark:text-blue-400">
                          {policy.annual_ceiling === null || policy.annual_ceiling === 0 
                            ? <Badge variant="success" className="text-[10px]">مفتوح</Badge>
                            : formatCurrency(Number(policy.annual_ceiling))}
                        </td>
                        <td className="px-5 py-4 text-center font-mono font-bold">
                          {policy.copay_percentage}%
                        </td>
                        <td className="px-5 py-4 text-center">
                          {policy.allow_partial_coverage ? (
                            <Badge variant="success">مفعلة</Badge>
                          ) : (
                            <Badge variant="warning">مرفوضة</Badge>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <Badge variant={policy.is_active ? "success" : "danger"}>
                            {policy.is_active ? "نشط" : "متوقف"}
                          </Badge>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <PolicyForm policy={policy} companies={companies} />
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
