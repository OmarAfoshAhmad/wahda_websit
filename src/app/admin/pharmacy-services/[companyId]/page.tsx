import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Pill } from "lucide-react";
import { Shell } from "@/components/shell";
import { PharmacyDeductionWorkspace } from "@/components/pharmacy/pharmacy-deduction-workspace";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";

export default async function PharmacyCompanyPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ order?: string }> }) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) redirect("/dashboard");

  const { companyId } = await params;
  const { order: orderId } = await searchParams;
  // الفتح من صندوق طلبات المستفيدين: الطلب يجب أن يكون موجهًا لهذا المرفق ولهذه الشركة.
  const order = orderId ? await prisma.pharmacyOrder.findFirst({
    where: { id: orderId, facility_id: session.id, company_id: companyId },
    select: { id: true, beneficiary_id: true, medicine_category: true, chronic_drug_ids: true, beneficiary: { select: { name: true, card_number: true } } },
  }) : null;
  const company = await prisma.insuranceCompany.findFirst({
    where: { id: companyId, deleted_at: null, is_active: true },
    select: {
      id: true,
      name: true,
      code: true,
      logo: true,
      service_policies: {
        where: { service_type: { code: "MEDICINE" }, is_active: true },
        take: 1,
        select: {
          coverage_percent: true,
          frequency_months: true,
          pharmacy_config: true,
        },
      },
    },
  });
  if (!company || company.service_policies.length === 0 || !company.service_policies[0].pharmacy_config) notFound();

  const config = company.service_policies[0].pharmacy_config!;
  const enabledCategories = ([
    config.routine_enabled ? "ROUTINE" : null,
    config.chronic_enabled ? "CHRONIC" : null,
    config.chemical_enabled ? "CHEMICAL" : null,
  ] as const).filter((value): value is "ROUTINE" | "CHRONIC" | "CHEMICAL" => value !== null);

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-4 pb-10">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400"><Pill className="h-5 w-5" /></div>
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white">صرف الأدوية — {company.name}</h1>
              <p className="text-xs font-bold text-slate-500">{company.code}</p>
            </div>
          </div>
          <Link href="/admin/pharmacy-services" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <ArrowRight className="h-4 w-4" /> الشركات
          </Link>
        </div>

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
      </div>
    </Shell>
  );
}
