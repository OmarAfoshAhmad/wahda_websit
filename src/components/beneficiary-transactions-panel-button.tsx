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
  import_source_file_name: string | null;
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
  family: {
    base_card: string;
    members_count: number;
    members: Array<{
      id: string;
      name: string;
      card_number: string;
      status: string;
      remaining_balance: number;
      is_selected: boolean;
    }>;
  };
  family_financials: {
    source: {
      file_name: string | null;
      imported_by: string | null;
      last_imported_at: string | null;
      family_count_from_file: number | null;
      total_balance_from_file: number | null;
      used_balance_from_file: number | null;
    };
    system: {
      family_members_in_system: number;
      family_total_balance: number;
      family_remaining_balance: number;
      distributed_from_system: number;
      distributed_from_import_only: number;
      debt_to_company: number;
    };
    import_reconciliation: {
      expected_from_file: number | null;
      applied_import_only: number;
      diff: number | null;
      is_match: boolean | null;
    };
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

  const load = async (targetBeneficiaryId: string, shouldOpen = true) => {
    if (shouldOpen) setOpen(true);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/beneficiaries/${encodeURIComponent(targetBeneficiaryId)}/transactions`, {
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

  const handleFamilyMemberClick = (memberId: string) => {
    if (loading) return;
    if (data?.beneficiary.id === memberId) return;
    void load(memberId, false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void load(beneficiaryId, true)}
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

                <div className="space-y-2">
                  <p className="text-xs font-black text-slate-600 dark:text-slate-300">مقارنة المنظومة والملف</p>
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <p className="px-1 text-[11px] font-black text-slate-500 dark:text-slate-400">الرصيد الكلي</p>
                      <div className="rounded border border-indigo-200 bg-indigo-50 px-2 py-2 dark:border-indigo-900 dark:bg-indigo-900/30">
                        <p className="text-indigo-700 dark:text-indigo-300">المنظومة</p>
                        <p className="font-black text-indigo-900 dark:text-indigo-100">
                          {Number(data.family_financials.system.family_total_balance).toLocaleString("ar-LY")} د.ل
                        </p>
                      </div>
                      <div className="rounded border border-violet-200 bg-violet-50 px-2 py-2 dark:border-violet-900 dark:bg-violet-900/30">
                        <p className="text-violet-700 dark:text-violet-300">الملف</p>
                        <p className="font-black text-violet-900 dark:text-violet-100">
                          {data.family_financials.source.total_balance_from_file === null
                            ? "—"
                            : `${Number(data.family_financials.source.total_balance_from_file).toLocaleString("ar-LY")} د.ل`}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="px-1 text-[11px] font-black text-slate-500 dark:text-slate-400">عدد الأفراد</p>
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                        <p className="text-slate-500 dark:text-slate-400">المنظومة</p>
                        <p className="font-black text-slate-900 dark:text-slate-100">
                          {Number(data.family_financials.system.family_members_in_system).toLocaleString("ar-LY")}
                        </p>
                      </div>
                      <div className="rounded border border-cyan-200 bg-cyan-50 px-2 py-2 dark:border-cyan-900 dark:bg-cyan-900/30">
                        <p className="text-cyan-700 dark:text-cyan-300">الملف</p>
                        <p className="font-black text-cyan-900 dark:text-cyan-100">
                          {data.family_financials.source.family_count_from_file === null
                            ? "—"
                            : Number(data.family_financials.source.family_count_from_file).toLocaleString("ar-LY")}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="px-1 text-[11px] font-black text-slate-500 dark:text-slate-400">الرصيد المستخدم/الموزع</p>
                      <div className="rounded border border-sky-200 bg-sky-50 px-2 py-2 dark:border-sky-900 dark:bg-sky-900/30">
                        <p className="text-sky-700 dark:text-sky-300">المنظومة (استيراد فقط)</p>
                        <p className="font-black text-sky-900 dark:text-sky-100">
                          {Number(data.family_financials.system.distributed_from_import_only).toLocaleString("ar-LY")} د.ل
                        </p>
                      </div>
                      <div className="rounded border border-amber-200 bg-amber-50 px-2 py-2 dark:border-amber-900 dark:bg-amber-900/30">
                        <p className="text-amber-700 dark:text-amber-300">الملف</p>
                        <p className="font-black text-amber-900 dark:text-amber-100">
                          {data.family_financials.source.used_balance_from_file === null
                            ? "—"
                            : `${Number(data.family_financials.source.used_balance_from_file).toLocaleString("ar-LY")} د.ل`}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="px-1 text-[11px] font-black text-slate-500 dark:text-slate-400">مرجع</p>
                      <div
                        className={`rounded border px-2 py-2 ${data.family_financials.import_reconciliation.is_match === null
                          ? "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40"
                          : data.family_financials.import_reconciliation.is_match
                          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-900/30"
                          : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/30"}`}
                      >
                        <p
                          className={`text-[11px] font-bold ${data.family_financials.import_reconciliation.is_match === null
                            ? "text-slate-600 dark:text-slate-300"
                            : data.family_financials.import_reconciliation.is_match
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-red-700 dark:text-red-300"}`}
                        >
                          دين لصالح الشركة (فرق التوزيع)
                        </p>
                        <p className="font-black text-slate-900 dark:text-slate-100">
                          {data.family_financials.import_reconciliation.diff === null
                            ? "—"
                            : `${Number(data.family_financials.import_reconciliation.diff).toLocaleString("ar-LY")} د.ل`}
                        </p>
                      </div>
                      <div className="rounded border border-slate-300 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                        <p className="text-slate-500 dark:text-slate-400">اسم ملف الاستيراد</p>
                        <p className="truncate font-black text-slate-900 dark:text-slate-100" title={data.family_financials.source.file_name ?? "—"}>
                          {data.family_financials.source.file_name ?? "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-800 dark:bg-sky-900/20">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-black text-sky-800 dark:text-sky-300">
                      أفراد الأسرة ({data.family.members_count.toLocaleString("ar-LY")})
                    </p>
                    <p className="text-[11px] font-bold text-sky-700 dark:text-sky-400" dir="ltr">
                      {data.family.base_card}
                    </p>
                  </div>

                  {data.family.members.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">لا يوجد أفراد أسرة مطابقون.</p>
                  ) : (
                    <div className="max-h-52 overflow-y-auto space-y-1">
                      {data.family.members.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => handleFamilyMemberClick(member.id)}
                          disabled={loading}
                          className={`w-full text-right rounded border px-2 py-1.5 text-xs transition-colors ${member.is_selected
                            ? "border-sky-300 bg-sky-100/70 dark:border-sky-700 dark:bg-sky-900/40"
                            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/50"
                            } ${loading ? "cursor-wait opacity-70" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                          title="عرض حركات هذا الفرد"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate font-bold text-slate-900 dark:text-slate-100">{member.name}</p>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                              {member.status === "ACTIVE"
                                ? "نشط"
                                : member.status === "SUSPENDED"
                                ? "موقوف"
                                : "مكتمل"}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                            <span dir="ltr">{member.card_number}</span>
                            <span>{member.remaining_balance.toLocaleString("ar-LY")} د.ل</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                        <th className="p-2">النوع</th>
                        <th className="p-2">المبلغ</th>
                        <th className="p-2">ملف الاستيراد</th>
                        <th className="p-2">المرفق</th>
                        <th className="p-2">الحالة</th>
                        <th className="p-2">التاريخ</th>
                        <th className="p-2">مرجع التصحيح</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transactions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-3 text-center text-slate-500 dark:text-slate-400">لا توجد حركات لهذا المستفيد</td>
                        </tr>
                      ) : (
                        data.transactions.map((tx) => (
                          <tr key={tx.id} className="border-b dark:border-slate-800">
                            <td className="p-2">{typeLabel(tx.type)}</td>
                            <td className="p-2">{tx.amount.toLocaleString("ar-LY")} د.ل</td>
                            <td className="p-2" title={tx.import_source_file_name ?? "—"}>{tx.import_source_file_name ?? "—"}</td>
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
