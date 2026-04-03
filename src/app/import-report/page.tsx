import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui";
import { ReportImportUploader } from "@/components/report-import-uploader";

export default async function ImportReportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
      <div className="space-y-5">
        <div className="mb-8 text-center">
          <Badge className="mb-4">للمشرف فقط</Badge>
          <h1 className="section-title text-2xl font-black text-slate-950 sm:text-3xl dark:text-white">
            استيراد الحركات القديمة
          </h1>
          <p className="mx-auto mt-2 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base dark:text-slate-400">
            هذا المسار مخصص لملف التقرير القديم الذي يحتوي على الحركات التاريخية بالتفصيل. بعد إدخال الحركات،
            يتم إعادة حساب الرصيد الفعلي للمستفيدين المتأثرين لضمان تطابق الحركات مع الرصيد المتبقي.
          </p>
        </div>

        <ReportImportUploader />
      </div>
    </Shell>
  );
}
