import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { Shell } from "@/components/shell";
import prisma from "@/lib/prisma";
import { getAllowedCompanyIds } from "@/lib/company-scope";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { ChronicImportClient } from "./chronic-import-client";

export default async function ChronicImportPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "manage_companies")) redirect("/admin/pharmacy-services");

  const companies = await prisma.insuranceCompany.findMany({
    where: {
      id: { in: await getAllowedCompanyIds(session) },
      deleted_at: null,
      is_active: true,
      service_policies: { some: { service_type: { code: "MEDICINE" }, is_active: true } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 dark:border-slate-800">
          <Link href="/admin/pharmacy-services" className="inline-flex w-fit items-center gap-1 text-sm font-bold text-slate-500 hover:text-teal-700">
            <ArrowRight className="h-4 w-4" /> خدمات الصيدلية
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">استيراد الأدوية المزمنة</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ربط الأدوية المزمنة بالمستفيدين من ملف Excel. فقط المستفيد المرتبط بدواء واحد على الأقل يستحق خدمة الأدوية المزمنة.
          </p>
        </div>
        <ChronicImportClient companies={companies} />
      </div>
    </Shell>
  );
}
