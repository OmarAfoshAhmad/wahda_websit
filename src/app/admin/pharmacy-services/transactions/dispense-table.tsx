"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, CreditCard, Download, FileText, History, Printer, RotateCcw, Trash2 } from "lucide-react";
import { cancelPharmacyDispenses, deletePharmacyDispensesPermanently, restorePharmacyDispenses } from "@/app/actions/pharmacy";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { formatDateTripoli } from "@/lib/datetime";

export type DispenseRowData = {
  id: string;
  category: string;
  beneficiary: string;
  card: string;
  company: string;
  facility: string;
  createdAt: string;
  cancelledAt: string | null;
  fromPrescription: boolean;
  gross: number;
  companyShare: number;
  patientShare: number;
  cancelled: boolean;
  cancellationReason: string | null;
  prescriptionNumber: number | null;
  attachments: Array<{ id: string; kind: "INSURANCE_CARD" | "PRESCRIPTION" | null }>;
  items: Array<{ label: string; price: number; company: number; patient: number }>;
  canCancel: boolean;
};

type Action = "delete" | "restore" | "purge";
const ACTION_TEXT: Record<Action, { title: string; body: (n: number) => string; confirm: string; variant: "danger" | "info" }> = {
  delete: { title: "حذف الحركات", body: (n) => `ستُنقل ${n} حركة إلى «المحذوفة»: تُلغى حركتها المالية وتعود حصة الشركة إلى السقف، ويمكن استعادتها لاحقًا.`, confirm: "نعم، حذف", variant: "danger" },
  restore: { title: "استعادة الحركات", body: (n) => `ستعود ${n} حركة سارية وتُحتسب على سقف المستفيد من جديد.`, confirm: "نعم، استعادة", variant: "info" },
  purge: { title: "حذف نهائي", body: (n) => `ستُحذف ${n} حركة نهائيًا من قاعدة البيانات مع بنودها ومرفقاتها. لا يمكن التراجع.`, confirm: "نعم، حذف نهائي", variant: "danger" },
};

const money = (value: number) => value.toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (value: string) => formatDateTripoli(value);
const TH = "px-4 py-3 text-start font-black text-slate-500 dark:text-slate-400 whitespace-nowrap";
const TD = "px-4 py-3.5 align-middle";
const ICON = "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50";

/** جدول حركات الصيدلية: أعمدة مستقلة، تحديد متعدد، حذف ناعم، ومن «المحذوفة» استعادة أو حذف نهائي. */
export function DispenseTable({ rows, deletedView, canRestore, canDeletePermanently, page, totalPages, total, prevHref, nextHref, printHref, exportHref, showCompany }: {
  rows: DispenseRowData[]; deletedView: boolean; canRestore: boolean; canDeletePermanently: boolean;
  page: number; totalPages: number; total: number; prevHref: string | null; nextHref: string | null;
  printHref: string; exportHref: string | null; showCompany: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ action: Action; ids: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const selectable = rows.filter((row) => (deletedView ? canRestore || canDeletePermanently : row.canCancel));
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.id));
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const names = new Map(rows.map((row) => [row.id, row.beneficiary]));

  const run = () => {
    if (!pendingAction) return;
    setError(null);
    startBusy(async () => {
      const { action, ids } = pendingAction;
      const result = action === "delete"
        ? await cancelPharmacyDispenses(ids, "حذف من شاشة حركات الصيدلية").then((value) => ("cancelled" in value && value.failed ? { success: true as const, done: value.cancelled ?? 0, failed: value.failed } : value))
        : action === "restore" ? await restorePharmacyDispenses(ids) : await deletePharmacyDispensesPermanently(ids);
      if ("error" in result && result.error) { setError(result.error); return; }
      if (!("done" in result)) return;
      const verb = action === "delete" ? "حُذفت" : action === "restore" ? "استُعيدت" : "حُذفت نهائيًا";
      setNotice(`${verb} ${result.done} حركة.` + (result.failed.length ? ` لم تُنفذ على ${result.failed.length}: ` + result.failed.map((item) => `${names.get(item.id) ?? ""} (${item.error})`).join("، ") : ""));
      setSelected(new Set(result.failed.map((item) => item.id)));
      setPendingAction(null);
      router.refresh();
    });
  };

  const ask = (action: Action, ids: string[]) => { setError(null); setNotice(null); setPendingAction({ action, ids }); };
  const ids = [...selected];

  const bulk = (label: string, action: Action, tone: "warning" | "danger" | "success") => (
    <button
      type="button"
      disabled={selected.size === 0}
      onClick={() => ask(action, ids)}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-4 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        tone === "warning" ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
        : tone === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
        : "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400"}`}
    >
      {label}
      <span className="rounded-full bg-white/80 px-1.5 text-[10px] dark:bg-slate-900/60">{selected.size}</span>
    </button>
  );

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <h2 className="flex items-center gap-2 text-base font-black text-slate-900 dark:text-white"><History className="h-5 w-5 text-teal-600" /> {deletedView ? "الحركات المحذوفة" : "سجل الحركات"}</h2>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-400 dark:border-slate-700 dark:bg-slate-800">صفحة {page} من {totalPages}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!deletedView && selectable.length > 0 && bulk("حذف المحدد", "delete", "warning")}
          {deletedView && canRestore && bulk("استعادة المحدد", "restore", "success")}
          {deletedView && canDeletePermanently && bulk("حذف نهائي للمحدد", "purge", "danger")}
          <a href={printHref} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><Printer className="h-4 w-4 text-teal-600" /> طباعة الكشف المصفى</a>
          {exportHref && <a href={exportHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-emerald-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-emerald-400"><Download className="h-4 w-4 text-emerald-600" /> تصدير Excel</a>}
        </div>
      </div>
      {notice && <p role="status" className="rounded-md bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-245 text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50">
            <tr>
              <th className="w-10 px-3 py-3">
                {selectable.length > 0 && <input type="checkbox" aria-label="تحديد الكل" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((row) => row.id)))} className="h-4 w-4 accent-teal-600" />}
              </th>
              <th className={TH}>المستفيد</th>
              <th className={TH}>رقم البطاقة</th>
              <th className={TH}>النوع</th>
              {showCompany && <th className={TH}>الشركة</th>}
              <th className={TH}>الصيدلية</th>
              <th className={TH}>{deletedView ? "تاريخ الحذف" : "التاريخ"}</th>
              <th className={`${TH} text-end`}>الإجمالي</th>
              <th className={`${TH} text-end`}>على الشركة</th>
              <th className={`${TH} text-end`}>على المستفيد</th>
              <th className={`${TH} text-center`}>إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => {
              const canSelect = selectable.includes(row);
              const expanded = open === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className={selected.has(row.id) ? "bg-teal-50/60 dark:bg-teal-950/20" : "hover:bg-slate-50/60 dark:hover:bg-slate-800/30"}>
                    <td className="px-3 py-2.5 text-center">{canSelect && <input type="checkbox" aria-label={`تحديد ${row.beneficiary}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} className="h-4 w-4 accent-teal-600" />}</td>
                    <td className={`${TD} font-bold`}>
                      <button type="button" onClick={() => setOpen(expanded ? null : row.id)} aria-expanded={expanded} className="inline-flex items-center gap-1 text-start hover:text-teal-700">
                        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} /> {row.beneficiary}
                      </button>
                    </td>
                    <td className={`${TD} font-mono text-xs text-slate-600 dark:text-slate-300`} dir="ltr">{row.card}</td>
                    <td className={TD}>{row.category}{row.prescriptionNumber ? <span className="text-xs text-slate-500"> · وصفة {row.prescriptionNumber}</span> : null}</td>
                    {showCompany && <td className={`${TD} text-xs text-slate-600 dark:text-slate-300`}>{row.company}</td>}
                    <td className={`${TD} text-xs font-bold text-slate-600 dark:text-slate-300`}>{row.facility}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300`} dir="ltr">{when(deletedView && row.cancelledAt ? row.cancelledAt : row.createdAt)}</td>
                    <td className={`${TD} text-end font-black tabular-nums`}>{money(row.gross)}</td>
                    <td className={`${TD} text-end tabular-nums text-teal-700 dark:text-teal-300`}>{money(row.companyShare)}</td>
                    <td className={`${TD} text-end tabular-nums`}>{money(row.patientShare)}</td>
                    <td className={TD}>
                      <div className="flex items-center justify-center gap-1.5">
                        <a href={`/admin/pharmacy-services/transactions/${row.id}/print`} target="_blank" rel="noopener noreferrer" title="طباعة الفاتورة مع المرفقات" className={`${ICON} border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300`}><Printer className="h-4 w-4" /></a>
                        {!deletedView && row.canCancel && <button type="button" title="حذف (يمكن استعادته)" onClick={() => ask("delete", [row.id])} className={`${ICON} border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400`}><Trash2 className="h-4 w-4" /></button>}
                        {deletedView && canRestore && (
                          <button type="button" title={row.fromPrescription ? "صرف وصفة: يُصرف من جديد من نافذة الصرف" : "استعادة الحركة"} disabled={row.fromPrescription} onClick={() => ask("restore", [row.id])} className={`${ICON} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-400`}><RotateCcw className="h-4 w-4" /></button>
                        )}
                        {deletedView && canDeletePermanently && <button type="button" title="حذف نهائي" onClick={() => ask("purge", [row.id])} className={`${ICON} border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400`}><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-slate-50/70 dark:bg-slate-900/40">
                      <td />
                      <td colSpan={showCompany ? 10 : 9} className="px-3 py-3">
                        <table className="w-full max-w-2xl text-xs">
                          <thead className="text-slate-500"><tr><th className="py-1 text-start">البند</th><th className="py-1 text-end">السعر</th><th className="py-1 text-end">على الشركة</th><th className="py-1 text-end">على المستفيد</th></tr></thead>
                          <tbody>
                            {row.items.map((item, index) => (
                              <tr key={index} className="border-t border-slate-200 dark:border-slate-700">
                                <td className="py-1" dir="auto">{item.label}</td>
                                <td className="py-1 text-end tabular-nums">{money(item.price)}</td>
                                <td className="py-1 text-end tabular-nums">{money(item.company)}</td>
                                <td className="py-1 text-end tabular-nums">{money(item.patient)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                          <span className="text-slate-500">{row.company}</span>
                          {row.attachments.map((attachment) => (
                            <a key={attachment.id} href={`/api/pharmacy/attachments/${attachment.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-teal-700 hover:underline dark:text-teal-300">
                              {attachment.kind === "INSURANCE_CARD" ? <CreditCard className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                              {attachment.kind === "INSURANCE_CARD" ? "البطاقة التأمينية" : "الوصفة"}
                            </a>
                          ))}
                          {row.cancelled && row.cancellationReason && <span className="text-rose-700">سبب الحذف: {row.cancellationReason}</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={showCompany ? 11 : 10} className="px-4 py-12 text-center font-bold text-slate-500 dark:text-slate-400">{deletedView ? "لا توجد حركات محذوفة." : "لا توجد حركات مطابقة للبحث أو معايير الفلترة المحددة."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex items-center gap-1">
            {[{ href: prevHref, icon: <ChevronRight className="h-4 w-4" />, title: "الصفحة السابقة" }, { href: nextHref, icon: <ChevronLeft className="h-4 w-4" />, title: "الصفحة التالية" }].map((item) => item.href ? (
              <Link key={item.title} href={item.href} title={item.title} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{item.icon}</Link>
            ) : (
              <span key={item.title} className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg border border-slate-100 bg-slate-50/50 text-slate-300 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-600">{item.icon}</span>
            ))}
          </div>
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">صفحة {page} من {totalPages} (إجمالي {total.toLocaleString("ar-LY")} حركة)</span>
        </div>
      )}

      {pendingAction && (
        <ConfirmationModal
          isOpen
          onClose={() => setPendingAction(null)}
          onConfirm={run}
          title={ACTION_TEXT[pendingAction.action].title}
          description={ACTION_TEXT[pendingAction.action].body(pendingAction.ids.length)}
          confirmLabel={ACTION_TEXT[pendingAction.action].confirm}
          variant={ACTION_TEXT[pendingAction.action].variant}
          isLoading={busy}
          error={error}
        />
      )}
    </div>
  );
}
