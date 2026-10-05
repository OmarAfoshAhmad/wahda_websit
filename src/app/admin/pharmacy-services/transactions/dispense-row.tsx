"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, CreditCard, FileText, Loader2, RotateCcw, XCircle } from "lucide-react";
import { cancelPharmacyDispense } from "@/app/actions/pharmacy";

type Row = {
  id: string;
  category: string;
  beneficiary: string;
  card: string;
  company: string;
  facility: string;
  createdAt: string;
  gross: number;
  companyShare: number;
  patientShare: number;
  cancelled: boolean;
  cancellationReason: string | null;
  prescriptionNumber: number | null;
  attachments: Array<{ id: string; kind: "INSURANCE_CARD" | "PRESCRIPTION" | null }>;
  items: Array<{ label: string; price: number; company: number; patient: number }>;
  canCancel: boolean;
  redispenseHref: string;
};

const money = (value: number) => `${value.toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} د.ل`;
const when = (value: string) => new Date(value).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli", dateStyle: "medium", timeStyle: "short" });

export function DispenseRow({ row }: { row: Row }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const cancel = () => {
    setError("");
    startTransition(async () => {
      const result = await cancelPharmacyDispense(row.id, reason);
      if ("error" in result && result.error) { setError(result.error); return; }
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <li className={row.cancelled ? "bg-slate-50 dark:bg-slate-900/50" : ""}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-start sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_auto_auto]">
        <span className="min-w-0">
          <span className={`block truncate text-sm font-black ${row.cancelled ? "text-slate-400 line-through" : ""}`}>{row.beneficiary}</span>
          <span className="block text-xs text-slate-500" dir="ltr">{row.card}</span>
        </span>
        <span className="hidden min-w-0 text-xs text-slate-600 sm:block dark:text-slate-300">
          <span className="block truncate">{row.category}{row.prescriptionNumber ? ` · وصفة ${row.prescriptionNumber}` : ""} · {row.company}</span>
          <span className="block truncate text-slate-500">{row.facility} · {when(row.createdAt)}</span>
        </span>
        <span className="text-end">
          <span className={`block text-sm font-black tabular-nums ${row.cancelled ? "text-slate-400 line-through" : ""}`}>{money(row.gross)}</span>
          {row.cancelled ? <span className="text-xs font-bold text-rose-700">ملغاة</span> : <span className="text-xs text-slate-500">شركة {money(row.companyShare)}</span>}
        </span>
        <ChevronDown className={`hidden h-4 w-4 text-slate-400 transition-transform sm:block ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-slate-500 sm:hidden">{row.category} · {row.company} · {row.facility} · {when(row.createdAt)}</p>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1 text-start">البند</th><th className="py-1 text-end">السعر</th><th className="py-1 text-end">الشركة</th><th className="py-1 text-end">المستفيد</th></tr></thead>
            <tbody>
              {row.items.map((item, index) => (
                <tr key={index} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1" dir="auto">{item.label}</td>
                  <td className="py-1 text-end tabular-nums">{money(item.price)}</td>
                  <td className="py-1 text-end tabular-nums">{money(item.company)}</td>
                  <td className="py-1 text-end tabular-nums">{money(item.patient)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-black dark:border-slate-700">
                <td className="py-1">الإجمالي</td><td className="py-1 text-end tabular-nums">{money(row.gross)}</td><td className="py-1 text-end tabular-nums">{money(row.companyShare)}</td><td className="py-1 text-end tabular-nums">{money(row.patientShare)}</td>
              </tr>
            </tbody>
          </table>

          {row.attachments.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {row.attachments.map((attachment) => (
                <a key={attachment.id} href={`/api/pharmacy/attachments/${attachment.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-teal-700 hover:underline dark:text-teal-300">
                  {attachment.kind === "INSURANCE_CARD" ? <CreditCard className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  {attachment.kind === "INSURANCE_CARD" ? "البطاقة التأمينية" : "الوصفة"}
                </a>
              ))}
            </div>
          )}

          {row.cancelled && row.cancellationReason && <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">سبب الإلغاء: {row.cancellationReason}</p>}

          {row.canCancel && !confirming && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming(true)} className="inline-flex h-9 items-center gap-1 rounded-md border border-rose-300 px-3 text-sm font-bold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30"><XCircle className="h-4 w-4" /> إلغاء الصرف</button>
              <p className="self-center text-xs text-slate-500">للتعديل: ألغِ الصرف ثم اصرف من جديد بالقيم الصحيحة.</p>
            </div>
          )}
          {confirming && (
            <div className="space-y-2 rounded-lg border border-rose-200 p-3 dark:border-rose-900">
              <p className="text-sm font-bold">سيُلغى الصرف وتُعاد حصة الشركة إلى السقف، وتعود البنود متاحة للصرف.</p>
              <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="سبب الإلغاء (مثال: خطأ في السعر)" aria-label="سبب الإلغاء" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
              {error && <p role="alert" className="text-sm font-bold text-rose-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={cancel} disabled={pending || reason.trim().length < 3} className="inline-flex h-9 items-center gap-1 rounded-md bg-rose-600 px-3 text-sm font-bold text-white disabled:opacity-50">{pending && <Loader2 className="h-4 w-4 animate-spin" />} تأكيد الإلغاء</button>
                <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">رجوع</button>
              </div>
            </div>
          )}
          {row.cancelled && (
            <Link href={row.redispenseHref} className="inline-flex items-center gap-1 text-sm font-bold text-teal-700 hover:underline dark:text-teal-300"><RotateCcw className="h-4 w-4" /> إعادة الصرف من نافذة الصرف</Link>
          )}
        </div>
      )}
    </li>
  );
}
