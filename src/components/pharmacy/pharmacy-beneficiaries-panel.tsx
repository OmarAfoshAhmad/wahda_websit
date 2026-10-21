"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { KeyRound, Loader2, Pencil, Phone, Search, ShieldCheck, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { listPharmacyBeneficiaries, resetFamilyPassword, setBeneficiaryPhone } from "@/app/actions/pharmacy-beneficiaries";

type Row = {
  id: string;
  name: string;
  card_number: string;
  phone_number: string | null;
  status: string;
  has_password: boolean;
  chronic_count: number;
  is_account_holder: boolean;
};

/** مستفيدو الشركة في الصيدلية: هاتف صاحب البطاقة (وجهة رمز التحقق) وحالة كلمة مرور الأسرة. */
export function PharmacyBeneficiariesPanel({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [busy, startBusy] = useTransition();

  const apply = useCallback((result: Awaited<ReturnType<typeof listPharmacyBeneficiaries>>) => {
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setRows(result.items);
    setTotal(result.total);
    setPageSize(result.pageSize);
  }, []);
  const load = useCallback(async () => apply(await listPharmacyBeneficiaries(companyId, applied, page)), [apply, companyId, applied, page]);

  useEffect(() => {
    let cancelled = false;
    listPharmacyBeneficiaries(companyId, applied, page).then((result) => { if (!cancelled) apply(result); });
    return () => { cancelled = true; };
  }, [apply, companyId, applied, page]);

  const savePhone = (row: Row) => {
    setError("");
    startBusy(async () => {
      const result = await setBeneficiaryPhone(row.id, phoneDraft);
      if (result.error) { setError(result.error); return; }
      setEditing(null);
      setNotice(result.phone ? `حُفظ هاتف ${row.name}: ${result.phone}` : `حُذف هاتف ${row.name}`);
      await load();
    });
  };

  const resetPassword = (row: Row) => {
    if (!window.confirm(`مسح كلمة مرور أسرة ${row.name}؟ سيسجل صاحب البطاقة مرة أخرى برمز التحقق ثم ينشئ كلمة جديدة.`)) return;
    setError("");
    startBusy(async () => {
      const result = await resetFamilyPassword(row.id);
      if (result.error) { setError(result.error); return; }
      setNotice(`مُسحت كلمة مرور أسرة ${row.name}`);
      await load();
    });
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card className="space-y-3 p-3 sm:p-4">
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setLoading(true); setPage(1); setApplied(query); }}>
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="الاسم أو رقم البطاقة أو الرقم الوظيفي" className="h-10 pr-9" aria-label="بحث في المستفيدين" />
        </div>
        <Button type="submit" className="h-10 bg-teal-600 px-4 text-white hover:bg-teal-700">بحث</Button>
      </form>

      <p className="text-xs text-slate-500">
        رمز التحقق يصل إلى هاتف <strong>صاحب البطاقة</strong> فقط، وعليه كلمة مرور الأسرة التي يدخل بها كل أفرادها.
      </p>
      {notice && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="p-2 text-start">المستفيد</th>
              <th className="p-2 text-start">البطاقة</th>
              <th className="p-2 text-start">هاتف صاحب البطاقة</th>
              <th className="p-2 text-start">كلمة مرور الأسرة</th>
              <th className="p-2 text-start">أدوية مزمنة</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-teal-600" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا يوجد مستفيدون مطابقون</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-2">
                  <span className="font-bold">{row.name}</span>
                  <span className="block text-xs text-slate-500">{row.is_account_holder ? "صاحب البطاقة" : "فرد من الأسرة"}{row.status !== "ACTIVE" ? ` · ${row.status === "SUSPENDED" ? "موقوف" : "رصيده العام منتهٍ"}` : ""}</span>
                </td>
                <td className="p-2 font-mono text-xs" dir="ltr">{row.card_number}</td>
                <td className="p-2">
                  {!row.is_account_holder ? (
                    <span className="text-xs text-slate-400">يستخدم هاتف صاحب البطاقة</span>
                  ) : editing === row.id ? (
                    <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); savePhone(row); }}>
                      <Input autoFocus value={phoneDraft} onChange={(event) => setPhoneDraft(event.target.value)} placeholder="0912345678" dir="ltr" inputMode="tel" className="h-9 w-36" aria-label={`هاتف ${row.name}`} />
                      <Button type="submit" disabled={busy} className="h-9 bg-teal-600 px-3 text-xs text-white hover:bg-teal-700">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}</Button>
                      <button type="button" onClick={() => setEditing(null)} aria-label="إلغاء" className="p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                    </form>
                  ) : (
                    <span className="flex items-center gap-2">
                      {row.phone_number ? <span className="inline-flex items-center gap-1 font-mono" dir="ltr"><Phone className="h-3.5 w-3.5 text-slate-400" />{row.phone_number}</span> : <span className="text-xs font-bold text-amber-700">لا يوجد</span>}
                      {canEdit && (
                        <button type="button" onClick={() => { setEditing(row.id); setPhoneDraft(row.phone_number ?? ""); setNotice(""); setError(""); }} className="inline-flex items-center gap-1 rounded-md border border-teal-300 px-2 py-1 text-xs font-bold text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300">
                          <Pencil className="h-3 w-3" aria-hidden /> {row.phone_number ? "تعديل" : "إضافة"}
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td className="p-2">
                  {!row.is_account_holder ? <span className="text-xs text-slate-400">مشتركة مع الأسرة</span> : row.has_password ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> مُنشأة</span>
                      {canEdit && <button type="button" disabled={busy} onClick={() => resetPassword(row)} className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300"><KeyRound className="h-3 w-3" /> مسح</button>}
                    </span>
                  ) : <span className="text-xs text-slate-500">لم يسجّل بعد</span>}
                </td>
                <td className="p-2 tabular-nums">{row.chronic_count || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total.toLocaleString("en")} مستفيد</span>
        <span className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => value - 1); }} className="h-8 px-3 text-xs">السابق</Button>
          <span className="tabular-nums">{page} / {pages}</span>
          <Button type="button" variant="outline" disabled={page >= pages || loading} onClick={() => { setLoading(true); setPage((value) => value + 1); }} className="h-8 px-3 text-xs">التالي</Button>
        </span>
      </div>
    </Card>
  );
}
