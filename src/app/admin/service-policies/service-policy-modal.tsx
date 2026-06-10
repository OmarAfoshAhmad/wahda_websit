"use client";

import React, { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { upsertServicePolicy } from "@/app/actions/service-policies";

interface ServicePolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  companies: any[];
  serviceTypes: any[];
  initialData: any | null;
}

export function ServicePolicyModal({
  isOpen,
  onClose,
  companies,
  serviceTypes,
  initialData,
}: ServicePolicyModalProps) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [companyId, setCompanyId] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [ceilingAmount, setCeilingAmount] = useState("");
  const [isUnlimitedCeiling, setIsUnlimitedCeiling] = useState(false);
  const [coveragePercent, setCoveragePercent] = useState("100");
  const [frequencyMonths, setFrequencyMonths] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setCompanyId(initialData.company_id);
        setServiceTypeId(initialData.service_type_id);
        setIsUnlimitedCeiling(initialData.ceiling_amount === null);
        setCeilingAmount(initialData.ceiling_amount !== null ? String(initialData.ceiling_amount) : "");
        setCoveragePercent(String(initialData.coverage_percent));
        setFrequencyMonths(initialData.frequency_months !== null ? String(initialData.frequency_months) : "");
        setIsActive(initialData.is_active);
      } else {
        setCompanyId(companies[0]?.id || "");
        setServiceTypeId(serviceTypes[0]?.id || "");
        setIsUnlimitedCeiling(false);
        setCeilingAmount("500");
        setCoveragePercent("100");
        setFrequencyMonths("12");
        setIsActive(true);
      }
    }
  }, [isOpen, initialData, companies, serviceTypes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !serviceTypeId) {
      toast.error("يجب اختيار الشركة والخدمة.");
      return;
    }

    setSubmitting(true);
    const ceiling = isUnlimitedCeiling ? null : Number(ceilingAmount) || 0;
    const frequency = frequencyMonths ? Number(frequencyMonths) : null;
    
    const res = await upsertServicePolicy({
      id: initialData?.id,
      company_id: companyId,
      service_type_id: serviceTypeId,
      ceiling_amount: ceiling,
      coverage_percent: Number(coveragePercent) || 100,
      frequency_months: frequency,
      is_active: isActive,
    });

    setSubmitting(false);

    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(initialData ? "تم تعديل السياسة بنجاح" : "تمت إضافة السياسة بنجاح");
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-right">
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
          <h3 className="text-lg font-black text-slate-900 dark:text-white">
            {initialData ? "تعديل سياسة الخدمة" : "إضافة سياسة جديدة"}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase text-slate-500">الشركة</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              disabled={!!initialData} // لا يمكن تغيير الشركة بعد الإنشاء
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase text-slate-500">الخدمة</label>
            <select
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              disabled={!!initialData}
            >
              {serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase text-slate-500">السقف المالي (د.ل)</label>
            <div className="flex gap-3 items-center">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={ceilingAmount}
                onChange={(e) => setCeilingAmount(e.target.value)}
                disabled={isUnlimitedCeiling}
                className="flex-1"
                placeholder={isUnlimitedCeiling ? "السقف مفتوح" : "مثال: 500"}
              />
              <label className="flex items-center gap-2 text-xs font-bold whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={isUnlimitedCeiling}
                  onChange={(e) => setIsUnlimitedCeiling(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                مفتوح
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase text-slate-500">نسبة التغطية (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                value={coveragePercent}
                onChange={(e) => setCoveragePercent(e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase text-slate-500">فترة الاستحقاق (أشهر)</label>
              <Input
                type="number"
                min="1"
                value={frequencyMonths}
                onChange={(e) => setFrequencyMonths(e.target.value)}
                placeholder="مثال: 12"
              />
              <p className="text-[9px] text-slate-400">اتركه فارغاً إذا لم يكن هناك قيود</p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-bold cursor-pointer mt-2 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-slate-300 text-teal-600 focus:ring-teal-600 w-4 h-4"
            />
            السياسة مفعلة (Is Active)
          </label>

          <div className="pt-4 flex gap-3">
            <Button type="submit" disabled={submitting} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-black">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "حفظ السياسة"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="flex-1 font-bold">
              إلغاء
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
