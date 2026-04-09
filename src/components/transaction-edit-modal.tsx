"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { Loader2 } from "lucide-react";
import { updateTransactionEntry } from "@/app/actions/transaction";
import { DateTimeInput } from "@/components/date-input";

type FacilityOption = {
  id: string;
  name: string;
};

type TransactionView = {
  id: string;
  amount: number;
  type: string;
  created_at: string;
  facility_id?: string;
  facility_name: string;
  is_cancelled: boolean;
};

export function TransactionEditModal({
  transaction,
  facilities,
  datalistId,
}: {
  transaction: TransactionView;
  facilities: FacilityOption[];
  datalistId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [nowLocal] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
  );
  const defaultDate = useMemo(() => {
    const parsed = new Date(transaction.created_at);
    if (Number.isNaN(parsed.getTime())) return nowLocal;
    return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }, [transaction.created_at, nowLocal]);

  const defaultFacilityId =
    transaction.facility_id ?? facilities.find((f) => f.name === transaction.facility_name)?.id ?? facilities[0]?.id ?? "";
  const defaultFacilityName = facilities.find((f) => f.id === defaultFacilityId)?.name ?? transaction.facility_name;

  const [amount, setAmount] = useState(String(transaction.amount));
  const [type, setType] = useState<"MEDICINE" | "SUPPLIES">(
    transaction.type === "MEDICINE" ? "MEDICINE" : "SUPPLIES"
  );
  const [transactionDate, setTransactionDate] = useState(defaultDate);
  const [facilityQuery, setFacilityQuery] = useState(defaultFacilityName);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) setOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, isPending]);

  const canEdit = !transaction.is_cancelled && transaction.type !== "CANCELLATION";

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const resolvedFacilityId = facilities.find(
        (f) => f.name === facilityQuery.trim() || f.id === facilityQuery.trim()
      )?.id;

      if (!resolvedFacilityId) {
        setError("الرجاء اختيار مرفق صحيح من القائمة");
        return;
      }

      const parsedAmount = Number(amount);
      const result = await updateTransactionEntry({
        id: transaction.id,
        amount: parsedAmount,
        type,
        transactionDate,
        facilityId: resolvedFacilityId,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setOpen(false);
      router.refresh();
    });
  };

  if (!canEdit) {
    return <span className="text-xs font-medium text-slate-400">غير متاح</span>;
  }

  return (
    <>
      <Button type="button" variant="outline" className="h-8 px-3 text-xs" onClick={() => setOpen(true)}>
        تعديل
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white">تعديل الحركة</h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                إغلاق
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">المرفق</label>
                <Input
                  value={facilityQuery}
                  onChange={(e) => setFacilityQuery(e.target.value)}
                  list={datalistId ?? `tx-edit-facilities-${transaction.id}`}
                  placeholder="ابحث عن المرفق بالاسم"
                  autoComplete="off"
                />
                {!datalistId && (
                  <datalist id={`tx-edit-facilities-${transaction.id}`}>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.name} />
                    ))}
                  </datalist>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">قيمة الخصم</label>
                <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">نوع الحركة</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as "MEDICINE" | "SUPPLIES")}
                  className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-200"
                >
                  <option value="SUPPLIES">كشف عام</option>
                  <option value="MEDICINE">أدوية صرف عام</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">تاريخ ووقت الحركة</label>
                <DateTimeInput value={transactionDate} onChange={setTransactionDate} max={nowLocal} />
              </div>

              {error && <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={isPending}>
                إلغاء
              </Button>
              <Button type="button" className="flex-1" onClick={handleSave} disabled={isPending}>
                {isPending && <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />}
                {isPending ? "جارٍ الحفظ..." : "حفظ التعديل"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
