"use client";

import { useState, useEffect, useTransition } from "react";
import { Loader2, RefreshCw, CheckCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { 
  getCardDiscrepanciesAction, 
  alignCardNumberAction, 
  alignAllCardNumbersAction,
  DiscrepancyRow 
} from "@/app/actions/truth-registry-alignment";

export function TruthRegistryAlignmentTool() {
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadData = async () => {
    setLoading(true);
    setError(null);
    const res = await getCardDiscrepanciesAction();
    if (res.error) {
      setError(res.error);
    } else if (res.discrepancies) {
      setDiscrepancies(res.discrepancies);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAlignSingle = async (beneficiaryId: string, targetCardNumber: string) => {
    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const res = await alignCardNumberAction(beneficiaryId, targetCardNumber);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccessMessage("تمت مواءمة البطاقة بنجاح!");
        loadData();
      }
    });
  };

  const handleAlignAll = async () => {
    if (!confirm("هل أنت متأكد من مواءمة وتوحيد كافة أرقام البطاقات؟ سيقوم هذا الإجراء بتعديل شكل كتابة أرقام البطاقات لتطابق تماماً جدول الحقيقة الرسمي وبحذر شديد.")) {
      return;
    }
    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const res = await alignAllCardNumbersAction();
      if (res.error) {
        setError(res.error);
      } else if (res.success) {
        setSuccessMessage(`تمت مواءمة وتوحيد ${res.successCount} بطاقة بنجاح مع جدول الحقيقة! (تم تخطي ${res.skipCount} بطاقات بسبب تكرار البيانات).`);
        loadData();
      }
    });
  };

  return (
    <Card className="p-4 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            مواءمة وتوحيد أرقام البطاقات (الأصفار البادئة)
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            مواءمة أرقام بطاقات المستفيدين النشطين بالمنظومة لتطابق تماماً شكل كتابتها الرسمي في جدول الحقيقة (مثال: WAB2025000123 مقابل WAB2025123).
          </p>
        </div>
        <Button 
          type="button" 
          variant="outline" 
          size="sm" 
          onClick={loadData} 
          disabled={loading || isPending}
          className="h-9 gap-1"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          تحديث الفحص
        </Button>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-500 mt-2">جاري فحص وتدقيق الفروقات في أرقام البطاقات...</p>
        </div>
      )}

      {!loading && (
        <>
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {discrepancies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 bg-emerald-50/50 dark:bg-emerald-950/10 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
              <CheckCircle className="h-10 w-10 text-emerald-500 mb-2" />
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">✓ لا توجد فروقات في الأصفار البادئة!</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">كافة أرقام بطاقات المستفيدين متطابقة تماماً في شكل كتابتها مع جدول الحقيقة.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-amber-800 dark:text-amber-400">
                      تم العثور على {discrepancies.length} بطاقة تختلف كتابتها عن جدول الحقيقة
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
                      تختلف هذه البطاقات في عدد الأصفار البادئة فقط، ولكنها متطابقة رياضياً ومعمارياً. يرجى مواءمتها لتسهيل ربط الدفعات وعرض المدن بدقة.
                    </p>
                  </div>
                </div>
                <Button 
                  type="button" 
                  disabled={isPending}
                  onClick={handleAlignAll}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold h-9 text-xs gap-1"
                >
                  {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  توحيد الكل ({discrepancies.length} بطاقة)
                </Button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800 max-h-96 overflow-y-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b dark:border-slate-800">
                      <th className="p-2.5 font-bold">الاسم</th>
                      <th className="p-2.5 font-bold">الرقم الحالي بالمنظومة</th>
                      <th className="p-2.5 font-bold">الرقم بجدول الحقيقة</th>
                      <th className="p-2.5 font-bold">المدينة</th>
                      <th className="p-2.5 font-bold">الدفعة</th>
                      <th className="p-2.5 font-bold text-left">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discrepancies.map((row) => (
                      <tr 
                        key={row.beneficiary_id} 
                        className="border-b dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
                      >
                        <td className="p-2.5 font-medium">{row.beneficiary_name}</td>
                        <td className="p-2.5 font-mono text-red-600 dark:text-red-400">{row.current_card_number}</td>
                        <td className="p-2.5 font-mono text-emerald-600 dark:text-emerald-400 font-bold">{row.registry_card_number}</td>
                        <td className="p-2.5 text-slate-600 dark:text-slate-400">{row.city}</td>
                        <td className="p-2.5 text-slate-600 dark:text-slate-400 font-mono">{row.batch_number || "—"}</td>
                        <td className="p-2.5 text-left">
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={isPending}
                            onClick={() => handleAlignSingle(row.beneficiary_id, row.registry_card_number)}
                            className="h-7 text-xs px-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:text-emerald-600"
                          >
                            مواءمة
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
export default TruthRegistryAlignmentTool;
