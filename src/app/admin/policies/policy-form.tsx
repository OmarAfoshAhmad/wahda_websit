"use client";

import React, { useState } from "react";
import { Plus, Pencil, X, Loader2, ShieldAlert } from "lucide-react";
import { Button, Input, Card } from "@/components/ui";
import { createOrUpdatePolicy } from "@/app/actions/policy";

interface Props {
  policy?: any;
  companies: any[];
}

export function PolicyForm({ policy, companies }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const currentYear = new Date().getFullYear();
  const defaultFrom = `${currentYear}-01-01`;
  const defaultTo = `${currentYear}-12-31`;

  const [formData, setFormData] = useState({
    company_id: policy?.company_id ?? (companies[0]?.id || ""),
    service_type: policy?.service_type ?? "GENERAL",
    annual_ceiling: policy?.annual_ceiling !== undefined && policy?.annual_ceiling !== null ? String(policy.annual_ceiling) : "",
    copay_percentage: policy?.copay_percentage ? Number(policy.copay_percentage) : 20,
    allow_partial_coverage: policy?.allow_partial_coverage ?? true,
    is_active: policy?.is_active ?? true,
    effective_from: policy?.effective_from ? new Date(policy.effective_from).toISOString().split("T")[0] : defaultFrom,
    effective_to: policy?.effective_to ? new Date(policy.effective_to).toISOString().split("T")[0] : defaultTo,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_id) {
      setError("يرجى اختيار الشركة أولاً");
      return;
    }

    if (!formData.effective_from) {
      setError("يرجى تحديد تاريخ سريان السياسة");
      setLoading(false);
      return;
    }
    if (formData.effective_to && formData.effective_to <= formData.effective_from) {
      setError("تاريخ الانتهاء يجب أن يكون بعد تاريخ السريان");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createOrUpdatePolicy({
        ...formData,
        annual_ceiling: formData.annual_ceiling === "" ? null : Number(formData.annual_ceiling),
        effective_from: formData.effective_from,
        effective_to: formData.effective_to || null,
      });

      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
        }, 800);
      }
    } catch {
      setError("خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {policy ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary dark:hover:text-blue-400"
          title="تعديل السياسة"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button onClick={() => setOpen(true)} className="gap-2" disabled={companies.length === 0}>
          <Plus className="h-4 w-4" />
          إضافة سياسة جديدة
        </Button>
      )}

      {open && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <Card className="w-full max-w-lg p-6">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  {policy ? "تعديل سياسة الخدمة" : "تعريف سياسة خدمة جديدة"}
                </h2>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">شركة التأمين</label>
                  <select
                    value={formData.company_id}
                    onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                    disabled={!!policy}
                    className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">نوع الخدمة</label>
                  <select
                    value={formData.service_type}
                    onChange={(e) => setFormData({ ...formData, service_type: e.target.value })}
                    disabled={!!policy}
                    className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:cursor-not-allowed"
                  >
                    <option value="GENERAL">كشف عام (GENERAL)</option>
                    <option value="MEDICINE">أدوية صرف عام (MEDICINE)</option>
                    <option value="DENTAL">أسنان (DENTAL)</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">السقف السنوي (د.ل)</label>
                  <Input
                    type="number"
                    value={formData.annual_ceiling}
                    onChange={(e) => setFormData({ ...formData, annual_ceiling: e.target.value })}
                    placeholder="اتركه فارغاً للسقف المفتوح"
                    min={0}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">ملاحظة: اتركه فارغاً إذا كان السقف غير محدود.</p>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">نسبة التحمل (%)</label>
                  <Input
                    type="number"
                    value={formData.copay_percentage}
                    onChange={(e) => setFormData({ ...formData, copay_percentage: Number(e.target.value) })}
                    required
                    min={0}
                    max={100}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">تاريخ السريان</label>
                  <Input
                    type="date"
                    value={formData.effective_from}
                    onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">تاريخ الانتهاء</label>
                  <Input
                    type="date"
                    value={formData.effective_to}
                    onChange={(e) => setFormData({ ...formData, effective_to: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30">
                <div className="flex items-center gap-3">
                  <input
                    id="partial"
                    type="checkbox"
                    checked={formData.allow_partial_coverage}
                    onChange={(e) => setFormData({ ...formData, allow_partial_coverage: e.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                  <label htmlFor="partial" className="text-sm font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                    السماح بالتغطية الجزئية عند قرب انتهاء السقف
                  </label>
                </div>
                <p className="mr-7 text-[11px] text-slate-500 leading-relaxed">
                  في حال تفعيل هذا الخيار، إذا كان المتبقي في السقف أقل من حصة الشركة، سيتم استهلاك المتبقي فقط ويتحمل المؤمن الفرق تلقائياً.
                </p>
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                  ✓ تم حفظ السياسة بنجاح
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
                <Button type="submit" disabled={loading} className="w-full sm:flex-1">
                  {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                  {policy ? "تحديث السياسة" : "حفظ السياسة"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} className="w-full sm:flex-1">
                  إلغاء
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
