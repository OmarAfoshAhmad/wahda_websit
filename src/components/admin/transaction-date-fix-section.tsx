"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, CalendarCheck, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmationModal } from "@/components/ui";
import {
  fixTransactionDateAction,
  applySuggestedTransactionDatesAction,
  type OutOfRangeDateRow,
} from "@/app/actions/transaction-date-health-actions";
import { formatDateTripoli } from "@/lib/datetime";

const TYPE_LABELS: Record<string, string> = {
  GENERAL: "كشف عام",
  MEDICINE: "دواء",
  SUPPLIES: "مستلزمات",
  DENTAL: "أسنان",
  OPTICS: "بصريات",
  PHYSIOTHERAPY: "علاج طبيعي",
  IMPORT: "استيراد",
};

const RECALC_HINT = "تغيّرت السنة المالية لحركة ذات سقف — شغّل «إعادة احتساب تجاوز السقف» في القسم السابق.";

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function DateFixRow({ row }: { row: OutOfRangeDateRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newDate, setNewDate] = useState(row.suggested_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await fixTransactionDateAction({ transactionId: row.id, newDate });
      if (!res.success) {
        setError(res.error ?? "فشل التصحيح");
        return;
      }
      setDone(res.needsCeilingRecalc ? `تم التصحيح. ${RECALC_HINT}` : "تم التصحيح.");
      router.refresh();
    });
  };

  const isFuture = row.anomaly === "FUTURE";

  return (
    <tr className="border-b dark:border-slate-800">
      <td className="p-2">
        <Link href={`/beneficiaries?q=${encodeURIComponent(row.card_number)}`} className="font-bold text-primary hover:underline">
          {row.beneficiary_name}
        </Link>
      </td>
      <td className="p-2 font-mono text-xs">{row.card_number}</td>
      <td className="p-2 text-xs">{row.facility_name}</td>
      <td className="p-2 text-xs">{TYPE_LABELS[row.type] ?? row.type}</td>
      <td className="p-2 text-left ltr">{row.amount.toLocaleString("ar-LY")}</td>
      <td className="p-2">
        <span
          className={
            isFuture
              ? "rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
              : "rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          }
        >
          {isFuture ? "في المستقبل" : "أقدم من 2020"}
        </span>
      </td>
      <td className="p-2 text-xs ltr font-mono">{formatDateTripoli(row.created_at)}</td>
      <td className="p-2 text-xs ltr font-mono">
        {row.suggested_date ? (
          <span className="font-bold text-sky-700 dark:text-sky-400">{row.suggested_date}</span>
        ) : (
          <span className="text-slate-400">— يدوي</span>
        )}
      </td>
      <td className="p-2">
        {done ? (
          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{done}</span>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={newDate}
                min="2020-01-01"
                max={todayIso()}
                onChange={(e) => setNewDate(e.target.value)}
                disabled={isPending}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
              />
              <button
                type="button"
                onClick={submit}
                disabled={isPending || !newDate}
                className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded bg-teal-700 px-3 text-xs font-black text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarCheck className="h-3 w-3" />}
                تصحيح
              </button>
            </div>
            {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}
          </div>
        )}
      </td>
    </tr>
  );
}

function BulkApplyButton({ companyId, count }: { companyId: string; count: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await applySuggestedTransactionDatesAction(companyId);
      if (!res.success) {
        setError(res.error ?? "فشل التطبيق");
        return;
      }
      setConfirmOpen(false);
      const recalc = res.needsCeilingRecalcCount ?? 0;
      setStatusMessage(
        `تم تصحيح ${(res.appliedCount ?? 0).toLocaleString("ar-LY")} حركة.` +
          (recalc > 0 ? ` ${recalc.toLocaleString("ar-LY")} منها ${RECALC_HINT}` : ""),
      );
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => { setError(null); setConfirmOpen(true); }}
        disabled={isPending || count === 0}
        className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-sky-700 px-4 text-sm font-black text-white transition-colors hover:bg-sky-800 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        تطبيق كل اقتراحات القلب ({count.toLocaleString("ar-LY")})
      </button>

      {statusMessage && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400">
          {statusMessage}
        </p>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="تأكيد تطبيق اقتراحات قلب اليوم/الشهر"
        description={`سيُصحَّح تاريخ ${count.toLocaleString("ar-LY")} حركة بقلب اليوم والشهر (مثال: 2026-10-05 تصبح 2026-05-10). تُنفَّذ العملية كلها أو لا شيء، ويُسجَّل كل تغيير في سجل المراقبة بالتاريخ القديم والجديد. لا يتأثر أي رصيد.`}
        confirmLabel="نعم، طبّق الاقتراحات"
        cancelLabel="إلغاء"
        variant="danger"
        isLoading={isPending}
        error={error}
      />
    </div>
  );
}

export function TransactionDateFixSection({ companyId, rows }: { companyId: string; rows: OutOfRangeDateRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm font-medium text-emerald-600">✓ لا توجد حركات بتواريخ خارج النطاق المنطقي.</p>;
  }

  const suggestedCount = rows.filter((r) => r.suggested_date !== null).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="rounded border border-sky-300 bg-sky-50 px-2 py-1 font-bold text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
          بقلب اليوم/الشهر: {suggestedCount.toLocaleString("ar-LY")} — يدوي: {(rows.length - suggestedCount).toLocaleString("ar-LY")}
        </span>
        <BulkApplyButton companyId={companyId} count={suggestedCount} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
              <th className="p-2">المستفيد</th>
              <th className="p-2">رقم البطاقة</th>
              <th className="p-2">المرفق</th>
              <th className="p-2">النوع</th>
              <th className="p-2">المبلغ / الجلسات</th>
              <th className="p-2">نوع الشذوذ</th>
              <th className="p-2">التاريخ المسجَّل</th>
              <th className="p-2">المقترح</th>
              <th className="p-2">التاريخ الصحيح</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DateFixRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
