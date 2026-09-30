"use client";

import React, { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { upsertServicePolicy } from "@/app/actions/service-policies";
import {
  EQUESTRIAN_CATEGORIES,
  EQUESTRIAN_CATEGORY_CEILINGS,
} from "@/lib/constants";

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
  const [defaultPrescriptionLimit, setDefaultPrescriptionLimit] = useState("");
  const [routineEnabled, setRoutineEnabled] = useState(true);
  const [routineCeiling, setRoutineCeiling] = useState("");
  const [routineUnlimited, setRoutineUnlimited] = useState(true);
  const [routineCoverage, setRoutineCoverage] = useState("");
  const [routineFrequency, setRoutineFrequency] = useState("");
  const [routinePrescriptionLimit, setRoutinePrescriptionLimit] = useState("");
  const [chronicEnabled, setChronicEnabled] = useState(true);
  const [chronicCeiling, setChronicCeiling] = useState("");
  const [chronicUnlimited, setChronicUnlimited] = useState(true);
  const [chronicCoverage, setChronicCoverage] = useState("");
  const [chronicFrequency, setChronicFrequency] = useState("");
  const [chronicPrescriptionLimit, setChronicPrescriptionLimit] = useState("");
  const [chemicalEnabled, setChemicalEnabled] = useState(false);
  const [chemicalCeiling, setChemicalCeiling] = useState("");
  const [chemicalUnlimited, setChemicalUnlimited] = useState(true);
  const [chemicalCoverage, setChemicalCoverage] = useState("");
  const [chemicalFrequency, setChemicalFrequency] = useState("");
  const [chemicalPrescriptionLimit, setChemicalPrescriptionLimit] = useState("");
  const [chemicalAttachmentRequired, setChemicalAttachmentRequired] = useState(true);
  const [maxAttachments, setMaxAttachments] = useState("2");
  const [equestrianEmergencyCeiling, setEquestrianEmergencyCeiling] = useState("3000");
  const [equestrianInpatientSurgeryCeiling, setEquestrianInpatientSurgeryCeiling] = useState("7000");

  const selectedService = serviceTypes.find((service) => service.id === serviceTypeId);
  const isMedicinePolicy = selectedService?.code === "MEDICINE";
  const isEquestrianPolicy = selectedService?.code === "EQUESTRIAN";
  const equestrianTotalCeiling = (Number(equestrianEmergencyCeiling) || 0)
    + (Number(equestrianInpatientSurgeryCeiling) || 0);

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
        setDefaultPrescriptionLimit(initialData.pharmacy_config?.default_prescription_limit != null ? String(initialData.pharmacy_config.default_prescription_limit) : "");
        setRoutineEnabled(initialData.pharmacy_config?.routine_enabled ?? true);
        setRoutineUnlimited(initialData.pharmacy_config?.routine_ceiling == null);
        setRoutineCeiling(initialData.pharmacy_config?.routine_ceiling != null ? String(initialData.pharmacy_config.routine_ceiling) : "");
        setRoutineCoverage(initialData.pharmacy_config?.routine_coverage_percent != null ? String(initialData.pharmacy_config.routine_coverage_percent) : "");
        setRoutineFrequency(initialData.pharmacy_config?.routine_frequency_months != null ? String(initialData.pharmacy_config.routine_frequency_months) : "");
        setRoutinePrescriptionLimit(initialData.pharmacy_config?.routine_prescription_limit != null ? String(initialData.pharmacy_config.routine_prescription_limit) : "");
        setChronicEnabled(initialData.pharmacy_config?.chronic_enabled ?? true);
        setChronicUnlimited(initialData.pharmacy_config?.chronic_ceiling == null);
        setChronicCeiling(initialData.pharmacy_config?.chronic_ceiling != null ? String(initialData.pharmacy_config.chronic_ceiling) : "");
        setChronicCoverage(initialData.pharmacy_config?.chronic_coverage_percent != null ? String(initialData.pharmacy_config.chronic_coverage_percent) : "");
        setChronicFrequency(initialData.pharmacy_config?.chronic_frequency_months != null ? String(initialData.pharmacy_config.chronic_frequency_months) : "");
        setChronicPrescriptionLimit(initialData.pharmacy_config?.chronic_prescription_limit != null ? String(initialData.pharmacy_config.chronic_prescription_limit) : "");
        setChemicalEnabled(initialData.pharmacy_config?.chemical_enabled ?? false);
        setChemicalUnlimited(initialData.pharmacy_config?.chemical_ceiling == null);
        setChemicalCeiling(initialData.pharmacy_config?.chemical_ceiling != null ? String(initialData.pharmacy_config.chemical_ceiling) : "");
        setChemicalCoverage(initialData.pharmacy_config?.chemical_coverage_percent != null ? String(initialData.pharmacy_config.chemical_coverage_percent) : "");
        setChemicalFrequency(initialData.pharmacy_config?.chemical_frequency_months != null ? String(initialData.pharmacy_config.chemical_frequency_months) : "");
        setChemicalPrescriptionLimit(initialData.pharmacy_config?.chemical_prescription_limit != null ? String(initialData.pharmacy_config.chemical_prescription_limit) : "");
        setChemicalAttachmentRequired(initialData.pharmacy_config?.chemical_attachment_required ?? true);
        setMaxAttachments(String(initialData.pharmacy_config?.max_attachments ?? 2));
        setEquestrianEmergencyCeiling(String(initialData.equestrian_config?.emergency_ceiling ?? EQUESTRIAN_CATEGORY_CEILINGS[EQUESTRIAN_CATEGORIES.EMERGENCY]));
        setEquestrianInpatientSurgeryCeiling(String(initialData.equestrian_config?.inpatient_surgery_ceiling ?? EQUESTRIAN_CATEGORY_CEILINGS[EQUESTRIAN_CATEGORIES.INPATIENT_SURGERY]));
      } else {
        setCompanyId(companies[0]?.id || "");
        setServiceTypeId(serviceTypes[0]?.id || "");
        setIsUnlimitedCeiling(false);
        setCeilingAmount("500");
        setCoveragePercent("100");
        setFrequencyMonths("12");
        setIsActive(true);
        setDefaultPrescriptionLimit("");
        setRoutineEnabled(true);
        setRoutineUnlimited(true);
        setRoutineCeiling("");
        setRoutineCoverage("");
        setRoutineFrequency("");
        setRoutinePrescriptionLimit("");
        setChronicEnabled(true);
        setChronicUnlimited(true);
        setChronicCeiling("");
        setChronicCoverage("");
        setChronicFrequency("");
        setChronicPrescriptionLimit("");
        setChemicalEnabled(false);
        setChemicalUnlimited(true);
        setChemicalCeiling("");
        setChemicalCoverage("");
        setChemicalFrequency("");
        setChemicalPrescriptionLimit("");
        setChemicalAttachmentRequired(true);
        setMaxAttachments("2");
        setEquestrianEmergencyCeiling("3000");
        setEquestrianInpatientSurgeryCeiling("7000");
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
    const ceiling = isEquestrianPolicy
      ? equestrianTotalCeiling
      : isUnlimitedCeiling ? null : Number(ceilingAmount) || 0;
    const frequency = frequencyMonths ? Number(frequencyMonths) : null;
    
    const res = await upsertServicePolicy({
      id: initialData?.id,
      company_id: companyId,
      service_type_id: serviceTypeId,
      ceiling_amount: isMedicinePolicy ? null : ceiling,
      coverage_percent: coveragePercent === "" ? 100 : Number(coveragePercent),
      frequency_months: frequency,
      is_active: isActive,
      pharmacy_config: isMedicinePolicy ? {
        default_prescription_limit: defaultPrescriptionLimit === "" ? null : Number(defaultPrescriptionLimit),
        routine_enabled: routineEnabled,
        routine_ceiling: routineUnlimited ? null : Number(routineCeiling),
        routine_coverage_percent: routineCoverage === "" ? null : Number(routineCoverage),
        routine_frequency_months: routineFrequency === "" ? null : Number(routineFrequency),
        routine_prescription_limit: routinePrescriptionLimit === "" ? null : Number(routinePrescriptionLimit),
        chronic_enabled: chronicEnabled,
        chronic_ceiling: chronicUnlimited ? null : Number(chronicCeiling),
        chronic_coverage_percent: chronicCoverage === "" ? null : Number(chronicCoverage),
        chronic_frequency_months: chronicFrequency === "" ? null : Number(chronicFrequency),
        chronic_prescription_limit: chronicPrescriptionLimit === "" ? null : Number(chronicPrescriptionLimit),
        chemical_enabled: chemicalEnabled,
        chemical_ceiling: chemicalUnlimited ? null : Number(chemicalCeiling),
        chemical_coverage_percent: chemicalCoverage === "" ? null : Number(chemicalCoverage),
        chemical_frequency_months: chemicalFrequency === "" ? null : Number(chemicalFrequency),
        chemical_prescription_limit: chemicalPrescriptionLimit === "" ? null : Number(chemicalPrescriptionLimit),
        chemical_attachment_required: chemicalAttachmentRequired,
        max_attachments: Number(maxAttachments) || 2,
      } : undefined,
      equestrian_config: isEquestrianPolicy ? {
        emergency_ceiling: Number(equestrianEmergencyCeiling),
        inpatient_surgery_ceiling: Number(equestrianInpatientSurgeryCeiling),
      } : undefined,
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
      
      <div className="relative max-h-[98vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-right">
        <div className="mb-2 flex items-start justify-between border-b border-slate-100 pb-1.5 dark:border-slate-800">
          <h3 className="text-lg font-black text-slate-900 dark:text-white">
            {initialData ? "تعديل سياسة الخدمة" : "إضافة سياسة جديدة"}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
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

          <div className="space-y-1">
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
          </div>

          {isEquestrianPolicy ? (
            <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-800 dark:bg-teal-950/20">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black text-teal-900 dark:text-teal-200">سقوف خدمة الفروسية</h4>
                  <p className="text-[10px] text-teal-700 dark:text-teal-400">يُطبّق كل سقف بصورة مستقلة عند اختيار نوع الخدمة أثناء الخصم.</p>
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-bold text-slate-500">الإجمالي</p>
                  <p className="text-base font-black text-slate-900 dark:text-white">{equestrianTotalCeiling.toLocaleString("ar-LY")} د.ل</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1 rounded-md border border-sky-200 bg-white p-2 dark:border-sky-900 dark:bg-slate-900">
                  <label className="text-[10px] font-bold text-slate-500">سقف الطوارئ (د.ل)</label>
                  <Input type="number" min="0" step="0.01" value={equestrianEmergencyCeiling} onChange={(event) => setEquestrianEmergencyCeiling(event.target.value)} className="h-9" />
                </div>
                <div className="space-y-1 rounded-md border border-emerald-200 bg-white p-2 dark:border-emerald-900 dark:bg-slate-900">
                  <label className="text-[10px] font-bold text-slate-500">سقف الإيواء والعمليات (د.ل)</label>
                  <Input type="number" min="0" step="0.01" value={equestrianInpatientSurgeryCeiling} onChange={(event) => setEquestrianInpatientSurgeryCeiling(event.target.value)} className="h-9" />
                </div>
              </div>
            </div>
          ) : !isMedicinePolicy && (
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
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
            {isMedicinePolicy && <p className="mb-1.5 text-xs font-black text-slate-700 dark:text-slate-300">القيم الافتراضية للتغطية والدورة وعدد الوصفات</p>}
            <div className={`grid gap-2 ${isMedicinePolicy ? "sm:grid-cols-3" : "grid-cols-2"}`}>
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-slate-500">نسبة التغطية (%)</label>
              <Input className="h-9"
                type="number"
                min="0"
                max="100"
                value={coveragePercent}
                onChange={(e) => setCoveragePercent(e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-black uppercase text-slate-500">فترة الاستحقاق (أشهر)</label>
              <Input className="h-9" type="number" min="1" max={isMedicinePolicy ? "12" : undefined} step="1" value={frequencyMonths} onChange={(e) => setFrequencyMonths(e.target.value)} placeholder="مثال: 12" />
            </div>
            {isMedicinePolicy && (
              <div className="space-y-1">
                <label className="text-[11px] font-black uppercase text-slate-500">عدد الوصفات الافتراضي</label>
                <Input className="h-9" type="number" min="1" max="4" step="1" value={defaultPrescriptionLimit} onChange={(event) => setDefaultPrescriptionLimit(event.target.value)} placeholder="مفتوح" />
              </div>
            )}
            </div>
          </div>

          {isMedicinePolicy && (
            <div className="space-y-1.5 rounded-lg border border-teal-200 bg-teal-50/60 p-2.5 dark:border-teal-800 dark:bg-teal-950/20">
              <div>
                <h4 className="text-sm font-black text-teal-900 dark:text-teal-200">تصنيفات سياسة الأدوية</h4>
                <p className="text-[10px] text-teal-700 dark:text-teal-400">السقف مستقل، والحقول الفارغة ترث القيم الافتراضية أعلاه.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { label: "أدوية روتينية", checked: routineEnabled, setChecked: setRoutineEnabled, ceiling: routineCeiling, setCeiling: setRoutineCeiling, unlimited: routineUnlimited, setUnlimited: setRoutineUnlimited, coverage: routineCoverage, setCoverage: setRoutineCoverage, frequency: routineFrequency, setFrequency: setRoutineFrequency, prescriptionLimit: routinePrescriptionLimit, setPrescriptionLimit: setRoutinePrescriptionLimit },
                  { label: "أدوية مزمنة", checked: chronicEnabled, setChecked: setChronicEnabled, ceiling: chronicCeiling, setCeiling: setChronicCeiling, unlimited: chronicUnlimited, setUnlimited: setChronicUnlimited, coverage: chronicCoverage, setCoverage: setChronicCoverage, frequency: chronicFrequency, setFrequency: setChronicFrequency, prescriptionLimit: chronicPrescriptionLimit, setPrescriptionLimit: setChronicPrescriptionLimit },
                  { label: "أدوية كيميائية", checked: chemicalEnabled, setChecked: setChemicalEnabled, ceiling: chemicalCeiling, setCeiling: setChemicalCeiling, unlimited: chemicalUnlimited, setUnlimited: setChemicalUnlimited, coverage: chemicalCoverage, setCoverage: setChemicalCoverage, frequency: chemicalFrequency, setFrequency: setChemicalFrequency, prescriptionLimit: chemicalPrescriptionLimit, setPrescriptionLimit: setChemicalPrescriptionLimit },
                ].map((option) => (
                  <div key={option.label} className="space-y-1.5 rounded-md border border-teal-100 bg-white p-2 dark:border-teal-900 dark:bg-slate-900">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
                      <input type="checkbox" checked={option.checked} onChange={(event) => option.setChecked(event.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-600" />
                      {option.label}
                    </label>
                    {option.checked && (
                      <>
                        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                          <Input className="h-8" type="number" min="0" step="0.01" disabled={option.unlimited} value={option.ceiling} onChange={(event) => option.setCeiling(event.target.value)} placeholder="السقف (د.ل)" />
                          <label className="flex cursor-pointer items-center gap-1 text-[10px] font-bold text-slate-500">
                            <input type="checkbox" checked={option.unlimited} onChange={(event) => option.setUnlimited(event.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-600" />
                            مفتوح
                          </label>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <div>
                            <label className="text-[9px] font-bold text-slate-500">التغطية %</label>
                            <Input className="h-8 px-1.5 text-xs" type="number" min="0" max="100" step="0.01" value={option.coverage} onChange={(event) => option.setCoverage(event.target.value)} placeholder={`${coveragePercent}%`} />
                          </div>
                          <div>
                            <label className="text-[9px] font-bold text-slate-500">الأشهر</label>
                            <Input className="h-8 px-1.5 text-xs" type="number" min="1" max="12" step="1" value={option.frequency} onChange={(event) => option.setFrequency(event.target.value)} placeholder={frequencyMonths || "-"} />
                          </div>
                          <div>
                            <label className="text-[9px] font-bold text-slate-500">الوصفات</label>
                            <Input className="h-8 px-1.5 text-xs" type="number" min="1" max="4" step="1" value={option.prescriptionLimit} onChange={(event) => option.setPrescriptionLimit(event.target.value)} placeholder={defaultPrescriptionLimit || "مفتوح"} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {chemicalEnabled && (
                <div className="grid grid-cols-2 items-end gap-3 border-t border-teal-200 pt-1.5 dark:border-teal-800">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
                    <input type="checkbox" checked={chemicalAttachmentRequired} onChange={(event) => setChemicalAttachmentRequired(event.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-600" />
                    الوصفة مطلوبة للكيميائي
                  </label>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500">أقصى عدد للمرفقات</label>
                    <Input className="h-8" type="number" min="1" max="5" value={maxAttachments} onChange={(event) => setMaxAttachments(event.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm font-bold cursor-pointer bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-slate-300 text-teal-600 focus:ring-teal-600 w-4 h-4"
            />
            السياسة مفعلة (Is Active)
          </label>

          <div className="flex gap-3 pt-1">
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
