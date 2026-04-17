"use client";

import { useState } from "react";
import { Loader2, List } from "lucide-react";
import { formatDateTripoli } from "@/lib/datetime";

type Props = {
  beneficiaryId: string;
  beneficiaryName: string;
  hasTransactions: boolean;
};

type TxItem = {
  id: string;
  amount: number;
  type: string;
  is_cancelled: boolean;
  created_at: string;
  facility_name: string;
  original_transaction_id: string | null;
};

type Payload = {
  beneficiary: {
    id: string;
    name: string;
    card_number: string;
    total_balance: number;
    remaining_balance: number;
    status: string;
    deleted_at: string | null;
  };
  summary: {
    transactions_count: number;
    active_transactions_count: number;
    cancelled_transactions_count: number;
    total_used: number;
  };
  transactions: TxItem[];
};

function typeLabel(type: string) {
  if (type === "SUPPLIES") return "كشف عام";
  if (type === "MEDICINE") return "أدوية";
  if (type === "IMPORT") return "استيراد";
  if (type === "CANCELLATION") return "تصحيح/إرجاع";
  return type;
}

export function BeneficiaryTransactionsPanelButton({ beneficiaryId, beneficiaryName, hasTransactions }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/beneficiaries/${encodeURIComponent(beneficiaryId)}/transactions`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.item) {
        setError(json?.error ?? "تعذر جلب حركات المستفيد");
        setData(null);
        setLoading(false);
        return;
      }

      setData(json.item as Payload);
      setLoading(false);
    } catch {
      setError("تعذر جلب حركات المستفيد");
      setData(null);
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={load}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${hasTransactions
          ? "border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50"
          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          }`}
        title="عرض كل حركات المستفيد"
        aria-label="عرض كل حركات المستفيد"
      >
        <List className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="fixed left-0 top-0 z-50 h-full w-full max-w-4xl overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-slate-100">كل حركات المستفيد</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{beneficiaryName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                إغلاق
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل الحركات...
              </div>
            )}

            {!loading && error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
                {error}
              </div>
            )}

            {!loading && !error && data && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 dark:border-emerald-900 dark:bg-emerald-900/30">
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">الرصيد المتبقي الحالي</p>
                    <p className="mt-1 text-xl font-black text-emerald-800 dark:text-emerald-200">
                      {Number(data.beneficiary.remaining_balance).toLocaleString("ar-LY")} د.ل
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">الرصيد الكلي</p>
                    <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">
                      {Number(data.beneficiary.total_balance).toLocaleString("ar-LY")} د.ل
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">الحالة الحالية</p>
                    <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">
                      {data.beneficiary.status === "ACTIVE"
                        ? "نشط"
                        : data.beneficiary.status === "SUSPENDED"
                        ? "موقوف"
                        : "مكتمل"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-slate-500 dark:text-slate-400">إجمالي الحركات</p>
                    <p className="font-black text-slate-900 dark:text-slate-100">{data.summary.transactions_count.toLocaleString("ar-LY")}</p>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-slate-500 dark:text-slate-400">الحركات النشطة</p>
                    <p className="font-black text-slate-900 dark:text-slate-100">{data.summary.active_transactions_count.toLocaleString("ar-LY")}</p>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-slate-500 dark:text-slate-400">الحركات الملغاة</p>
                    <p className="font-black text-slate-900 dark:text-slate-100">{data.summary.cancelled_transactions_count.toLocaleString("ar-LY")}</p>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-slate-500 dark:text-slate-400">إجمالي المستهلك</p>
                    <p className="font-black text-slate-900 dark:text-slate-100">{data.summary.total_used.toLocaleString("ar-LY")} د.ل</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                        <th className="p-2">النوع</th>
                        <th className="p-2">المبلغ</th>
                        <th className="p-2">المرفق</th>
                        <th className="p-2">الحالة</th>
                        <th className="p-2">التاريخ</th>
                        <th className="p-2">مرجع التصحيح</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transactions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-3 text-center text-slate-500 dark:text-slate-400">لا توجد حركات لهذا المستفيد</td>
                        </tr>
                      ) : (
                        data.transactions.map((tx) => (
                          <tr key={tx.id} className="border-b dark:border-slate-800">
                            <td className="p-2">{typeLabel(tx.type)}</td>
                            <td className="p-2">{tx.amount.toLocaleString("ar-LY")} د.ل</td>
                            <td className="p-2">{tx.facility_name}</td>
                            <td className="p-2">
                              {tx.is_cancelled ? (
                                <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-black text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">ملغاة</span>
                              ) : (
                                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300">نشطة</span>
                              )}
                            </td>
                            <td className="p-2">{formatDateTripoli(new Date(tx.created_at), "en-GB")}</td>
                            <td className="p-2">{tx.original_transaction_id ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}
