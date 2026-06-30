import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { PhysiotherapyTransactionImportUploader } from "@/components/physiotherapy-transaction-import-uploader";
import Link from "next/link";
import { Stethoscope, ArrowRight } from "lucide-react";
import prisma from "@/lib/prisma";

export default async function PhysiotherapyTransactionsImportPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/admin/physiotherapy-transactions");

  const resolvedParams = await searchParams;
  const initialCompanyId = resolvedParams.companyId ?? "";

  // Fetch all active insurance companies to select from
  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={initialCompanyId ? `/admin/physiotherapy-services/${initialCompanyId}` : "/admin/physiotherapy-transactions"}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <ArrowRight className="h-5 w-5" />
              </Link>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400">
                <Stethoscope className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white">
                {initialCompanyId 
                  ? `استيراد حركات لشركة: ${companies.find(c => c.id === initialCompanyId)?.name || ""}`
                  : "استيراد حركات العلاج الطبيعي لشركة محددة"}
              </h1>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {initialCompanyId 
                ? "استيراد وتحديث حركات العلاج الطبيعي التاريخية لمنتسبي هذه الشركة المحددة فقط عبر ملف Excel."
                : "يرجى اختيار شركة التأمين ثم رفع ملف Excel لاستيراد حركاتها التاريخية."}
            </p>
          </div>
        </div>

        {/* Content */}
        <PhysiotherapyTransactionImportUploader 
          companies={companies} 
          initialCompanyId={initialCompanyId} 
        />
      </div>
    </Shell>
  );
}
