import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Building2, Pill, ShieldCheck, Users } from "lucide-react";
import { Shell } from "@/components/shell";
import { PharmacyDeductionWorkspace } from "@/components/pharmacy/pharmacy-deduction-workspace";
import { PharmacyBeneficiariesPanel } from "@/components/pharmacy/pharmacy-beneficiaries-panel";
import { PharmacyTransactionsSection } from "@/components/pharmacy/pharmacy-transactions-section";
import { canAccessAdmin } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { ACTIVE_DISPENSE_WHERE, type DispenseFilterParams } from "@/lib/pharmacy/dispense-filter";

type Search = DispenseFilterParams & { order?: string; tab?: string };

const TAB = "px-4 py-2 rounded-md text-sm font-bold transition-colors";
const TAB_ON = "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700";
const TAB_OFF = "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200";
const COUNT = "text-[10px] font-black bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full";

/** صفحة الصيدلية لكل شركة، بنفس هيكل الخدمات الأخرى: إجراء الصرف، آخر الحركات، المستفيدين. */
export default async function PharmacyCompanyPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Search> }) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) redirect("/dashboard");

  const { companyId } = await params;
  const sp = await searchParams;
  const staff = canAccessAdmin(session);
  const canDispense = hasPermission(session, "pharmacy_services");
  // تبويب المستفيدين (الهاتف وكلمة مرور الأسرة) لموظفي الإدارة فقط.
  const tabs = [...(canDispense ? ["deduct"] : []), "transactions", ...(staff ? ["beneficiaries"] : [])];
  const activeTab = sp.tab && tabs.includes(sp.tab) ? sp.tab : tabs[0];

  // الفتح من صندوق طلبات المستفيدين: الطلب يجب أن يكون موجهًا لهذا المرفق ولهذه الشركة.
  const order = sp.order ? await prisma.pharmacyOrder.findFirst({
    where: { id: sp.order, facility_id: session.id, company_id: companyId },
    select: { id: true, beneficiary_id: true, medicine_category: true, chronic_drug_ids: true, beneficiary: { select: { name: true, card_number: true } } },
  }) : null;
  const company = await prisma.insuranceCompany.findFirst({
    where: { id: companyId, deleted_at: null, is_active: true },
    select: {
      id: true, name: true, code: true, logo: true,
      _count: { select: { beneficiaries: { where: { deleted_at: null } } } },
      service_policies: { where: { service_type: { code: "MEDICINE" }, is_active: true }, take: 1, select: { ceiling_amount: true, coverage_percent: true, pharmacy_config: true } },
    },
  });
  if (!company || company.service_policies.length === 0 || !company.service_policies[0].pharmacy_config) notFound();

  const policy = company.service_policies[0];
  const config = policy.pharmacy_config!;
  const enabledCategories = ([config.routine_enabled ? "ROUTINE" : null, config.chronic_enabled ? "CHRONIC" : null, config.chemical_enabled ? "CHEMICAL" : null] as const)
    .filter((value): value is "ROUTINE" | "CHRONIC" | "CHEMICAL" => value !== null);
  const transactionsCount = await prisma.pharmacyDispense.count({ where: { company_id: company.id, ...ACTIVE_DISPENSE_WHERE, ...(staff ? {} : { facility_id: session.id }) } });
  const ceiling = policy.ceiling_amount === null ? null : Number(policy.ceiling_amount);
  const copay = 100 - Number(policy.coverage_percent);
  const base = `/admin/pharmacy-services/${company.id}`;

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-4 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-600 dark:border-teal-900/40 dark:bg-teal-900/30 dark:text-teal-400">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Link href="/admin/pharmacy-services" className="font-bold transition-colors hover:text-teal-600 dark:hover:text-teal-400">خدمات الصيدلية</Link>
                <ArrowRight className="h-3.5 w-3.5 rotate-180" />
                <span className="font-medium">{company.name}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="mt-0.5 text-xl font-black text-slate-900 dark:text-white">
                  {company.name}
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{company.code}</span>
                </h1>
                <nav aria-label="أقسام الصيدلية" className="mr-1 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/50">
                  {canDispense && <Link href={`${base}?tab=deduct`} aria-current={activeTab === "deduct" ? "page" : undefined} className={`${TAB} ${activeTab === "deduct" ? TAB_ON : TAB_OFF}`}>إجراء الصرف</Link>}
                  <Link href={`${base}?tab=transactions`} aria-current={activeTab === "transactions" ? "page" : undefined} className={`${TAB} ${activeTab === "transactions" ? TAB_ON : TAB_OFF}`}>
                    <span className="flex items-center gap-1.5">آخر الحركات <span className={COUNT}>{transactionsCount.toLocaleString("ar-LY")}</span></span>
                  </Link>
                  {staff && (
                    <Link href={`${base}?tab=beneficiaries`} aria-current={activeTab === "beneficiaries" ? "page" : undefined} className={`${TAB} ${activeTab === "beneficiaries" ? TAB_ON : TAB_OFF}`}>
                      <span className="flex items-center gap-1.5">المستفيدين <span className={COUNT}>{company._count.beneficiaries.toLocaleString("ar-LY")}</span></span>
                    </Link>
                  )}
                </nav>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
              <Users className="h-3.5 w-3.5 text-teal-600" />
              <span className="font-black text-slate-900 dark:text-white">{company._count.beneficiaries.toLocaleString("ar-LY")}</span>
              <span className="text-slate-500">مستفيد</span>
            </div>
            {ceiling !== null ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs dark:border-teal-800 dark:bg-teal-900/20">
                <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
                <span className="font-black text-teal-800 dark:text-teal-300">{ceiling.toLocaleString("ar-LY")} د.ل</span>
                <span className="text-teal-600 dark:text-teal-400">سقف</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs dark:border-emerald-800 dark:bg-emerald-900/20">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span className="font-black text-emerald-800 dark:text-teal-300">سقف مفتوح</span>
              </div>
            )}
            {copay > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs dark:border-amber-800 dark:bg-amber-900/20">
                <span className="font-black text-amber-800 dark:text-amber-300">تحمل {copay}%</span>
              </div>
            )}
            {hasPermission(session, "manage_companies") && (
              <Link href="/admin/pharmacy-services/chronic-import" className="mr-1 flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                <Pill className="h-3.5 w-3.5 text-teal-600" />
                <span>استيراد الأدوية المزمنة</span>
              </Link>
            )}
          </div>
        </div>

        {activeTab === "deduct" && (
          <PharmacyDeductionWorkspace
            company={{ id: company.id, name: company.name, code: company.code, logo: company.logo }}
            enabledCategories={enabledCategories}
            fromOrder={order ? {
              orderId: order.id,
              beneficiaryId: order.beneficiary_id,
              beneficiaryLabel: `${order.beneficiary.name} - ${order.beneficiary.card_number}`,
              category: order.medicine_category,
              chronicDrugIds: Array.isArray(order.chronic_drug_ids) ? (order.chronic_drug_ids as string[]) : [],
            } : null}
            currentFacility={{ id: session.id, name: session.name }}
          />
        )}
        {activeTab === "transactions" && (
          <PharmacyTransactionsSection session={session} params={{ q: sp.q, view: sp.view, category: sp.category, facility: sp.facility, from: sp.from, to: sp.to, page: sp.page, company: company.id }} basePath={base} hidden={{ tab: "transactions", company: company.id }} />
        )}
        {activeTab === "beneficiaries" && (
          <PharmacyBeneficiariesPanel companyId={company.id} canEdit={hasPermission(session, "edit_beneficiary")} canExport={session.is_admin || hasPermission(session, "export_data")} />
        )}
      </div>
    </Shell>
  );
}
