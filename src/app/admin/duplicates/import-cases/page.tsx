import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { Card, Button, Badge } from "@/components/ui";
import { getActiveImportDuplicateCases } from "@/lib/import-duplicate-cases";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export default async function ImportDuplicateCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const { ok, err } = await searchParams;
  const cases = await getActiveImportDuplicateCases();

  const totalExtra = cases.reduce((sum, row) => sum + row.extraAmount, 0);

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">حالات تكرار الاستيراد</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              عرض كل المستفيدين الذين لديهم أكثر من حركة IMPORT فعّالة، مع المبلغ الزائد المتوقع إرجاعه.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/duplicates" className="inline-flex">
              <Button type="button" variant="outline" className="h-10">العودة للتكرارات</Button>
            </Link>
            <form method="post" action="/api/admin/duplicates/import-cases/fix-all">
              <Button type="submit" className="h-10 bg-red-600 hover:bg-red-700 text-white">
                معالجة دفعة واحدة
              </Button>
            </form>
          </div>
        </div>

        {(ok || err) && (
          <Card className={`p-4 ${err ? "border-red-200 dark:border-red-900" : "border-emerald-200 dark:border-emerald-900"}`}>
            <div className="flex items-center gap-3">
              {err ? <AlertCircle className="h-5 w-5 text-red-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              <p className={`text-sm font-bold ${err ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                {err ?? ok}
              </p>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="warning">الحالات: {cases.length}</Badge>
            <Badge variant="danger">الإجمالي الزائد: {totalExtra.toLocaleString("en-US")} د.ل</Badge>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-245 text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-right">
                  <th className="px-3 py-2 font-bold">الاسم</th>
                  <th className="px-3 py-2 font-bold">رقم البطاقة</th>
                  <th className="px-3 py-2 font-bold">عدد IMPORT</th>
                  <th className="px-3 py-2 font-bold">الرصيد الحالي</th>
                  <th className="px-3 py-2 font-bold">الزيادة بسبب التكرار</th>
                  <th className="px-3 py-2 font-bold">الرصيد بعد التصحيح</th>
                  <th className="px-3 py-2 font-bold">الحالة الحالية</th>
                  <th className="px-3 py-2 font-bold">الحالة بعد التصحيح</th>
                </tr>
              </thead>
              <tbody>
                {cases.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                      لا توجد حالات تكرار IMPORT فعّالة.
                    </td>
                  </tr>
                ) : (
                  cases.map((row) => (
                    <tr key={row.beneficiaryId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">{row.cardNumber}</td>
                      <td className="px-3 py-2">{row.importCount}</td>
                      <td className="px-3 py-2">{row.currentRemaining.toLocaleString("en-US")}</td>
                      <td className="px-3 py-2 text-red-700 dark:text-red-400 font-bold">{row.extraAmount.toLocaleString("en-US")}</td>
                      <td className="px-3 py-2">{row.fixedRemaining.toLocaleString("en-US")}</td>
                      <td className="px-3 py-2">{row.currentStatus}</td>
                      <td className="px-3 py-2">{row.fixedStatus}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
