"use client";

import React, { useState } from "react";
import { Plus, Pencil, X, Loader2 } from "lucide-react";
import { Button, Input, Card } from "@/components/ui";
import { createCompany, updateCompany } from "@/app/actions/company";

interface Props {
  company?: {
    id: string;
    name: string;
    code: string;
    card_pattern: string | null;
    logo?: string | null;
    dental_ceiling?: any;
    dental_coverage?: any;
    general_ceiling?: any;
    general_coverage?: any;
    medicine_ceiling?: any;
    medicine_coverage?: any;
  };
}

const isValidImageUrl = (url?: string | null) => {
  if (!url) return false;
  const clean = url.trim().toLowerCase();
  return clean.startsWith("data:image/") || clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("/");
};

export function CompanyForm({ company }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    name: company?.name ?? "",
    code: company?.code ?? "",
    card_pattern: company?.card_pattern ?? "",
    logo: company?.logo ?? "",
    dental_ceiling: company?.dental_ceiling !== undefined && company?.dental_ceiling !== null ? String(Number(company.dental_ceiling)) : "3000",
    dental_coverage: company?.dental_coverage !== undefined && company?.dental_coverage !== null ? String(Number(company.dental_coverage)) : "100",
    general_ceiling: company?.general_ceiling !== undefined && company?.general_ceiling !== null ? String(Number(company.general_ceiling)) : "",
    general_coverage: company?.general_coverage !== undefined && company?.general_coverage !== null ? String(Number(company.general_coverage)) : "0",
    medicine_ceiling: company?.medicine_ceiling !== undefined && company?.medicine_ceiling !== null ? String(Number(company.medicine_ceiling)) : "",
    medicine_coverage: company?.medicine_coverage !== undefined && company?.medicine_coverage !== null ? String(Number(company.medicine_coverage)) : "0",
  });

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 120;
        const MAX_HEIGHT = 120;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        setFormData({ ...formData, logo: canvas.toDataURL("image/png") });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = {
        name: formData.name,
        code: formData.code,
        card_pattern: formData.card_pattern || undefined,
        logo: formData.logo || undefined,
        dental_ceiling: formData.dental_ceiling === "" ? null : Number(formData.dental_ceiling),
        dental_coverage: Number(formData.dental_coverage),
        general_ceiling: formData.general_ceiling === "" ? null : Number(formData.general_ceiling),
        general_coverage: Number(formData.general_coverage),
        medicine_ceiling: formData.medicine_ceiling === "" ? null : Number(formData.medicine_ceiling),
        medicine_coverage: Number(formData.medicine_coverage),
      };

      const result = company 
        ? await updateCompany(company.id, payload)
        : await createCompany(payload);

      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
           if (!company) setFormData({ name: "", code: "", card_pattern: "", logo: "", dental_ceiling: "3000", dental_coverage: "100", general_ceiling: "", general_coverage: "0", medicine_ceiling: "", medicine_coverage: "0" });
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
      {company ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary dark:hover:text-blue-400"
          title="تعديل الشركة"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          إضافة شركة جديدة
        </Button>
      )}

      {open && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <Card className="w-full max-w-md p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                {company ? "تعديل بيانات الشركة" : "إضافة شركة تأمين جديدة"}
              </h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">اسم الشركة</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="مثال: مصرف الوحدة، شركة المدار..."
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">كود الشركة (Code)</label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  required
                  dir="ltr"
                  placeholder="مثال: WAB, MDAR"
                  disabled={!!company}
                />
                <p className="mt-1 text-xs text-slate-400">كود فريد للتعريف بالنظام (لا يمكن تغييره لاحقاً)</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">نمط أرقام البطاقات (Regex)</label>
                <Input
                  value={formData.card_pattern}
                  onChange={(e) => setFormData({ ...formData, card_pattern: e.target.value })}
                  dir="ltr"
                  placeholder="مثال: WAB-.*"
                />
                <p className="mt-1 text-xs text-slate-400">يستخدم للتحقق التلقائي عند الإدخال (مثال: WAB-.* لشركة الوحدة)</p>
              </div>

              {/* قسم التغطية والأسقف المالية */}
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 border-b pb-2">سقف وتغطية الخدمات</h3>
                
                {/* الأسنان */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-400">سقف الأسنان (DENTAL)</label>
                    <Input
                      type="number"
                      value={formData.dental_ceiling}
                      onChange={(e) => setFormData({ ...formData, dental_ceiling: e.target.value })}
                      placeholder="مفتوح"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-400">نسبة تغطية الأسنان (%)</label>
                    <Input
                      type="number"
                      value={formData.dental_coverage}
                      onChange={(e) => setFormData({ ...formData, dental_coverage: e.target.value })}
                      placeholder="100"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">شعار الشركة (اختياري)</label>
                <div className="flex items-center gap-4">
                  {formData.logo && isValidImageUrl(formData.logo) ? (
                    <div className="relative h-12 w-12 shrink-0 rounded-md border border-slate-200 bg-white p-1">
                      <img src={formData.logo} alt="Logo" className="h-full w-full object-contain" />
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, logo: "" })}
                        className="absolute -right-2 -top-2 rounded-full bg-red-100 p-1 text-red-600 hover:bg-red-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                      <span className="text-xs text-slate-400">شعار</span>
                    </div>
                  )}
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="flex-1 cursor-pointer"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                  ✓ تم حفظ البيانات بنجاح
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
                <Button type="submit" disabled={loading} className="w-full sm:flex-1">
                  {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                  {company ? "تحديث البيانات" : "إنشاء الشركة"}
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
