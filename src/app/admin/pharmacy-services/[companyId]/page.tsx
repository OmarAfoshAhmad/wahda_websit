import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Pill } from "lucide-react";
import { Shell } from "@/components/shell";
import { PharmacyDeductionWorkspace } from "@/components/pharmacy/pharmacy-deduction-workspace";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";

export default async function PharmacyCompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) redirect("/dashboard");

  const { companyId } = await params;
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

  const policy = company.service_policies[0];
  const config = policy.pharmacy_config!;
  const defaultCoverage = Number(policy.coverage_percent);
  const defaultFrequency = policy.frequency_months;
  const categories = [
    config.routine_enabled ? {
      value: "ROUTINE" as const,
      label: "أدوية روتينية",
      ceiling: config.routine_ceiling === null ? null : Number(config.routine_ceiling),
      coverage: config.routine_coverage_percent === null ? defaultCoverage : Number(config.routine_coverage_percent),
      frequencyMonths: config.routine_frequency_months ?? defaultFrequency,
      prescriptionLimit: config.routine_prescription_limit ?? config.default_prescription_limit,
      attachmentRequired: true,
      maxAttachments: config.max_attachments,
    } : null,
    config.chronic_enabled ? {
      value: "CHRONIC" as const,
      label: "أدوية مزمنة",
      ceiling: config.chronic_ceiling === null ? null : Number(config.chronic_ceiling),
      coverage: config.chronic_coverage_percent === null ? defaultCoverage : Number(config.chronic_coverage_percent),
      frequencyMonths: config.chronic_frequency_months ?? defaultFrequency,
      prescriptionLimit: config.chronic_prescription_limit ?? config.default_prescription_limit,
      attachmentRequired: false,
      maxAttachments: config.max_attachments,
    } : null,
    config.chemical_enabled ? {
      value: "CHEMICAL" as const,
      label: "أدوية كيميائية",
      ceiling: config.chemical_ceiling === null ? null : Number(config.chemical_ceiling),
      coverage: config.chemical_coverage_percent === null ? defaultCoverage : Number(config.chemical_coverage_percent),
      frequencyMonths: config.chemical_frequency_months ?? defaultFrequency,
      prescriptionLimit: config.chemical_prescription_limit ?? config.default_prescription_limit,
      attachmentRequired: config.chemical_attachment_required,
      maxAttachments: config.max_attachments,
    } : null,
  ].filter((category): category is NonNullable<typeof category> => category !== null);

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
          categories={categories}
          currentFacility={{ id: session.id, name: session.name }}
        />
      </div>
    </Shell>
  );
}
