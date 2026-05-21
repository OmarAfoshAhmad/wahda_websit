import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { DentalTransactionImportUploader } from "@/components/dental-transaction-import-uploader";
import Link from "next/link";
import { Stethoscope, ArrowRight } from "lucide-react";

export default async function DentalTransactionsImportPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/admin/dental-transactions");

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/admin/dental-transactions"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <ArrowRight className="h-5 w-5" />
              </Link>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400">
                <Stethoscope className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white">استيراد حركات الأسنان</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              استيراد وتحديث حركات الأسنان التاريخية لجميع المؤمنين المسجلين دفعة واحدة عبر ملف Excel.
            </p>
          </div>
        </div>

        {/* Content */}
        <DentalTransactionImportUploader />
      </div>
    </Shell>
  );
}
