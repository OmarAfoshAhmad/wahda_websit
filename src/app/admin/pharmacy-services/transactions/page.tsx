import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Receipt } from "lucide-react";
import { Shell } from "@/components/shell";
import { PharmacyTransactionsSection } from "@/components/pharmacy/pharmacy-transactions-section";
import prisma from "@/lib/prisma";
import { getAllowedCompanyIds } from "@/lib/company-scope";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import type { DispenseFilterParams } from "@/lib/pharmacy/dispense-filter";

/** حركات الصيدلية لكل الشركات (للإدارة والصيدلية). حركات شركة واحدة في تبويب «آخر الحركات» داخل صفحة الشركة. */
export default async function PharmacyTransactionsPage({ searchParams }: { searchParams: Promise<DispenseFilterParams> }) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) redirect("/dashboard");
  const params = await searchParams;
  // الروابط القديمة ?company= تفتح تبويب حركات الشركة نفسها.
  if (params.company) {
    const rest = new URLSearchParams(Object.entries(params).filter(([key, value]) => value && key !== "company") as Array<[string, string]>);
    rest.set("tab", "transactions");
    redirect(`/admin/pharmacy-services/${params.company}?${rest}`);
  }
  const companies = await prisma.insuranceCompany.findMany({ where: { id: { in: await getAllowedCompanyIds(session) } }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-4 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <h1 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-white"><Receipt className="h-6 w-6 text-teal-600" /> حركات الصيدلية — كل الشركات</h1>
          <Link href="/admin/pharmacy-services" className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-teal-700"><ArrowRight className="h-4 w-4" /> خدمات الصيدلية</Link>
        </div>
        <PharmacyTransactionsSection session={session} params={params} basePath="/admin/pharmacy-services/transactions" hidden={{}} companies={companies} />
      </div>
    </Shell>
  );
}
