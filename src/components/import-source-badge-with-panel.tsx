"use client";

import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { Loader2, X } from "lucide-react";

type DetailResponse = {
  detail: {
    family_base_card: string;
    source: {
      family_count_from_file: number | null;
      total_balance_from_file: number | null;
      used_balance_from_file: number | null;
      source_row_number: number | null;
      last_imported_at: string | null;
    };
    system: {
      found_in_system_count: number;
    };
    amounts: {
      expected_deduction: number;
      actual_deduction: number;
      deduction_diff: number;
    };
    members: Array<{
      id: string;
      name: string;
      card_number: string;
      status: string;
      total_balance: number;
      remaining_balance: number;
      import_deducted: number;
      manual_deducted: number;
      consumed_total: number;
    }>;
  };
};

export function ImportSourceBadgeWithPanel({
  source,
  transactionId,
}: {
  source: "import" | "manual";
  transactionId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse["detail"] | null>(null);

  if (source === "manual") {
    return <Badge variant="warning">يدوي</Badge>;
  }

  const onOpen = async () => {
    if (!transactionId) return;
    setOpen(true);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/import-transactions/details/${transactionId}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as { error?: string } & Partial<DetailResponse>;

      if (!response.ok || payload.error || !payload.detail) {
        setError(payload.error ?? "تعذر تحميل تفاصيل الاستيراد");
        setDetail(null);
        return;
      }

      setDetail(payload.detail);
    } catch {
      setError("تعذر تحميل تفاصيل الاستيراد");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex"
        title="عرض تفاصيل الاستيراد"
      >
        <Badge variant="success" className="cursor-pointer hover:brightness-95">استيراد</Badge>
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="إغلاق"
          />

          <aside className="absolute inset-y-0 left-0 w-full max-w-2xl overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">تفاصيل خصم الاستيراد</h3>
              <Button type="button" variant="outline" className="h-9 w-9 p-0" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                جار تحميل التفاصيل...
              </div>
            )}

            {!loading && error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}

            {!loading && !error && detail && (
              <div className="space-y-4">
                <Card className="p-4">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">بطاقة العائلة الأساسية</p>
                  <p className="mt-1 text-base font-black text-slate-900 dark:text-white">{detail.family_base_card}</p>
                </Card>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Metric label="الرصيد الكلي (المصدر)" value={detail.source.total_balance_from_file} unit="د.ل" />
                  <Metric label="عدد أفراد العائلة (المصدر)" value={detail.source.family_count_from_file} />
                  <Metric label="المتوفر في المنظومة" value={detail.system.found_in_system_count} />
                  <Metric label="الخصم المتوقع" value={detail.amounts.expected_deduction} unit="د.ل" />
                  <Metric label="الخصم الحقيقي" value={detail.amounts.actual_deduction} unit="د.ل" />
                  <Metric
                    label="الفارق"
                    value={detail.amounts.deduction_diff}
                    unit="د.ل"
                    tone={detail.amounts.deduction_diff === 0 ? "neutral" : "warn"}
                  />
                </div>

                <Card className="overflow-hidden">
                  <div className="border-b border-slate-200 px-4 py-3 text-sm font-black text-slate-800 dark:border-slate-700 dark:text-slate-200">
                    تفاصيل الأفراد
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800/60">
                        <tr>
                          <th className="px-3 py-2 text-right text-xs font-black text-slate-500">المستفيد</th>
                          <th className="px-3 py-2 text-right text-xs font-black text-slate-500">البطاقة</th>
                          <th className="px-3 py-2 text-right text-xs font-black text-slate-500">المخصوم</th>
                          <th className="px-3 py-2 text-right text-xs font-black text-slate-500">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.members.map((m) => (
                          <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-200">{m.name}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-300">{m.card_number}</td>
                            <td className="px-3 py-2 font-black text-slate-800 dark:text-slate-100">{m.import_deducted.toLocaleString("ar-LY")}</td>
                            <td className="px-3 py-2 font-black text-emerald-700 dark:text-emerald-400">{m.remaining_balance.toLocaleString("ar-LY")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function Metric({
  label,
  value,
  unit,
  tone = "neutral",
}: {
  label: string;
  value: number | null;
  unit?: string;
  tone?: "neutral" | "warn";
}) {
  const color = tone === "warn"
    ? "text-amber-700 dark:text-amber-400"
    : "text-slate-900 dark:text-white";

  return (
    <Card className="p-3">
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-black ${color}`}>
        {value === null ? "—" : value.toLocaleString("ar-LY")}
        {unit ? <span className="mr-1 text-xs font-bold text-slate-500">{unit}</span> : null}
      </p>
    </Card>
  );
}
