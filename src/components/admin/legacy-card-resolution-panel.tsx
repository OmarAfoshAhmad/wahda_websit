import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { getLegacyCardResolutionAnalysis, type LegacyCardAnalysisItem } from "@/app/actions/legacy-card-resolution";
import { LegacyCardResolutionButton } from "./legacy-card-resolution-button";
import { LegacyCardBatchTools } from "./legacy-card-batch-tools";
import { LegacyCardBulkResolutionButton } from "./legacy-card-bulk-resolution-buttons";

function Money({ value }: { value: number }) {
  return <span dir="ltr">{Number(value).toFixed(2)} د.ل</span>;
}

function PersonCells({ item }: { item: LegacyCardAnalysisItem }) {
  return (
    <>
      <td className="p-2">
        <p className="font-bold">{item.name}</p>
        <p className="text-[11px] text-slate-500">{item.birthDate ? item.birthDate.slice(0, 10) : "تاريخ الميلاد غير مسجل"}</p>
      </td>
      <td className="p-2 font-mono text-xs" dir="ltr">{item.legacyCard}</td>
      <td className="p-2 text-xs">
        <p>المستهلك: <strong><Money value={item.spentAmount} /></strong></p>
        <p>الحركات الفعالة: {item.activeTransactionCount.toLocaleString("ar-LY")}</p>
        <p>كل الحركات: {item.transactionCount.toLocaleString("ar-LY")}</p>
      </td>
    </>
  );
}

export async function LegacyCardResolutionPanel({ searchQuery = "" }: { searchQuery?: string }) {
  const analysis = await getLegacyCardResolutionAnalysis(searchQuery);
  const total = analysis.confirmedCurrent.length + analysis.safeWithReplacement.length + analysis.withoutReplacement.length + analysis.needsReview.length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/20">
        <h2 className="font-black text-slate-900 dark:text-white">معالجة دقيقة للبطاقات القديمة</h2>
        <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-300">
          المطابقة الآمنة تعتمد على الاسم مع تاريخ الميلاد أو الرقم المعياري. تطابق الاسم وحده لا ينفذ أي دمج تلقائي.
          كل عملية تعيد التحقق من البيانات لحظة التنفيذ وتسجل في سجل المراجعة، والحذف هنا حذف ناعم قابل للاسترجاع.
        </p>
        <div className="mt-3"><LegacyCardBatchTools /></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded border p-3"><p className="text-xs text-slate-500">إجمالي الموسومة</p><p className="text-xl font-black">{total.toLocaleString("ar-LY")}</p></div>
        <div className="rounded border border-emerald-200 p-3"><p className="text-xs text-emerald-700">حديثة مؤكدة/لها بديل</p><p className="text-xl font-black text-emerald-700">{(analysis.confirmedCurrent.length + analysis.safeWithReplacement.length).toLocaleString("ar-LY")}</p></div>
        <div className="rounded border border-amber-200 p-3"><p className="text-xs text-amber-700">تحتاج مراجعة</p><p className="text-xl font-black text-amber-700">{analysis.needsReview.length.toLocaleString("ar-LY")}</p></div>
        <div className="rounded border border-rose-200 p-3"><p className="text-xs text-rose-700">بلا بديل مؤكد</p><p className="text-xl font-black text-rose-700">{analysis.withoutReplacement.length.toLocaleString("ar-LY")}</p></div>
      </div>

      {analysis.truncated && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-800">النتائج تجاوزت 1000 سجل؛ استخدم البحث لتضييق النطاق قبل المعالجة.</p>
      )}

      <section className="overflow-hidden rounded-lg border border-emerald-200 dark:border-emerald-900">
        <div className="bg-emerald-50 p-4 dark:bg-emerald-950/20">
          <h3 className="flex items-center gap-2 font-black text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /> صدرت لهم بطاقة حديثة مؤكدة</h3>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">البطاقة الموسومة قديمة ولها حركة يدوية تُحتفظ كما هي ويزال وسم القديمة. حركة IMPORT وحدها لا تُعد دليلاً. وعند وجود بديل مستقل تُنقل إليه الحركات.</p>
          <div className="mt-3"><LegacyCardBulkResolutionButton mode="merge_confirmed" count={analysis.confirmedCurrent.length + analysis.safeWithReplacement.length} /></div>
        </div>
        {analysis.confirmedCurrent.length > 0 ? (
          <div className="border-t border-emerald-200 bg-emerald-50/40 p-3 text-xs text-emerald-800">
            <strong>احتفاظ مباشر ({analysis.confirmedCurrent.length.toLocaleString("ar-LY")}):</strong>{" "}
            {analysis.confirmedCurrent.slice(0, 8).map((item) => `${item.name} (${item.legacyCard})`).join("، ")}
            {analysis.confirmedCurrent.length > 8 ? "…" : ""}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-240 text-right text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/60"><tr><th className="p-2">المستفيد</th><th className="p-2">القديمة</th><th className="p-2">الاستهلاك</th><th className="p-2">الحديثة</th><th className="p-2">سبب الثقة</th><th className="p-2">الإجراء</th></tr></thead>
            <tbody>
              {analysis.safeWithReplacement.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا توجد حالات مؤكدة.</td></tr> : analysis.safeWithReplacement.map((item) => (
                <tr key={item.legacyId} className="border-t dark:border-slate-800">
                  <PersonCells item={item} />
                  <td className="p-2"><Link className="font-mono text-xs font-bold text-primary hover:underline" href={`/beneficiaries?q=${encodeURIComponent(item.replacement!.cardNumber)}`} dir="ltr">{item.replacement!.cardNumber}</Link><p className="text-[11px] text-slate-500">{item.replacement!.batchNumber ? `دفعة ${item.replacement!.batchNumber}` : "إصدار فردي"}</p></td>
                  <td className="p-2 text-xs text-emerald-700">{item.reason}</td>
                  <td className="p-2"><LegacyCardResolutionButton legacyId={item.legacyId} replacementId={item.replacement!.id} hasUsage={item.transactionCount > 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-rose-200 dark:border-rose-900">
        <div className="bg-rose-50 p-4 dark:bg-rose-950/20">
          <h3 className="flex items-center gap-2 font-black text-rose-800 dark:text-rose-300"><ShieldAlert className="h-5 w-5" /> لم تصدر لهم بطاقة حديثة مؤكدة</h3>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">يُحذف سجل البطاقة القديمة حذفًا ناعمًا مع إبقاء جميع حركاتها المالية محفوظة للتدقيق.</p>
          <div className="mt-3"><LegacyCardBulkResolutionButton mode="delete_without_replacement" count={analysis.withoutReplacement.length} /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-right text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/60"><tr><th className="p-2">المستفيد</th><th className="p-2">البطاقة</th><th className="p-2">الاستهلاك</th><th className="p-2">الحكم</th><th className="p-2">الإجراء</th></tr></thead>
            <tbody>
              {analysis.withoutReplacement.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا توجد حالات.</td></tr> : analysis.withoutReplacement.map((item) => {
                const hasUsage = item.activeTransactionCount > 0 || Math.abs(item.spentAmount) > 0.000001;
                return <tr key={item.legacyId} className="border-t dark:border-slate-800"><PersonCells item={item} /><td className="p-2 text-xs"><span className="font-bold text-emerald-700">قابل للحذف الناعم</span>{hasUsage ? <p className="mt-1 font-bold text-amber-700">الحركات ستبقى محفوظة</p> : null}<p className="mt-1 text-slate-500">{item.reason}</p></td><td className="p-2"><LegacyCardResolutionButton legacyId={item.legacyId} hasUsage={hasUsage} /></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-amber-200 dark:border-amber-900">
        <div className="bg-amber-50 p-4 dark:bg-amber-950/20"><h3 className="flex items-center gap-2 font-black text-amber-800 dark:text-amber-300"><AlertTriangle className="h-5 w-5" /> حالات تحتاج مراجعة يدوية</h3><p className="mt-1 text-xs text-amber-700 dark:text-amber-400">لا يوجد زر دمج أو حذف هنا لأن دليل الهوية غير كافٍ أو البدائل متعددة.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-200 text-right text-sm"><thead className="bg-slate-50 dark:bg-slate-900/60"><tr><th className="p-2">المستفيد</th><th className="p-2">القديمة</th><th className="p-2">الاستهلاك</th><th className="p-2">البدائل المحتملة</th><th className="p-2">سبب المنع</th></tr></thead><tbody>
          {analysis.needsReview.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا توجد حالات غامضة.</td></tr> : analysis.needsReview.map((item) => <tr key={item.legacyId} className="border-t dark:border-slate-800"><PersonCells item={item} /><td className="p-2 font-mono text-xs" dir="ltr">{item.candidateCards.join("، ")}</td><td className="p-2 text-xs font-bold text-amber-700">{item.reason}<p className="mt-1"><Link href={`/beneficiaries?q=${encodeURIComponent(item.name)}`} className="text-primary hover:underline">فتح نتائج الاسم</Link></p></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
