"use client";

import React, { useState } from "react";
import { Pencil, X, Loader2, RotateCcw } from "lucide-react";
import { Button, Input, Card } from "./ui";
import { updateFacility } from "@/app/actions/facility";

interface Props {
  facility: {
    id: string;
    name: string;
    username: string;
    facility_type_override?: "HOSPITAL" | "PHARMACY" | null;
  };
}

export function FacilityEditModal({ facility }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(facility.name);
  const [username, setUsername] = useState(facility.username);
  const [facilityType, setFacilityType] = useState<"AUTO" | "HOSPITAL" | "PHARMACY">(
    facility.facility_type_override ?? "AUTO"
  );
  const [resetPassword, setResetPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await updateFacility({
        id: facility.id,
        name,
        username,
        facility_type: facilityType,
        resetPassword,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        if (result.tempPassword) {
          setGeneratedPassword(result.tempPassword);
        } else {
          setTimeout(() => {
            setOpen(false);
            setSuccess(false);
            setResetPassword(false);
            setGeneratedPassword(null);
          }, 800);
        }
      }
    } catch {
      setError("خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setError(null);
          setSuccess(false);
          setName(facility.name);
          setUsername(facility.username);
          setFacilityType(facility.facility_type_override ?? "AUTO");
          setResetPassword(false);
          setGeneratedPassword(null);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary dark:hover:text-blue-400"
        title="تعديل المرفق"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:px-4" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">تعديل المرفق</h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">اسم المرفق</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  placeholder="اسم المرفق الصحي"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">اسم المستخدم</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  dir="ltr"
                  placeholder="hospital_name"
                />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-300">نوع المرفق</label>
                <select
                  value={facilityType}
                  onChange={(e) => setFacilityType(e.target.value as "AUTO" | "HOSPITAL" | "PHARMACY")}
                  className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <option value="AUTO">تلقائي (استنتاج من الاسم)</option>
                  <option value="HOSPITAL">مشفى</option>
                  <option value="PHARMACY">صيدلية</option>
                </select>
              </div>

              <div className="flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                <input
                  id="reset-pw"
                  type="checkbox"
                  checked={resetPassword}
                  onChange={(e) => setResetPassword(e.target.checked)}
                  className="h-4 w-4 accent-amber-600 dark:accent-amber-500"
                />
                <label htmlFor="reset-pw" className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-400 cursor-pointer">
                  <RotateCcw className="h-3.5 w-3.5" />
                  إعادة تعيين كلمة المرور (ستُعاد إلى 123456)
                </label>
              </div>

              {error && (
                <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm font-bold text-red-700 dark:text-red-400">
                  {error}
                </div>
              )}
              {success && !generatedPassword && (
                <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  ✓ تم الحفظ بنجاح
                </div>
              )}
              {generatedPassword && (
                <div className="rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-sm font-bold text-blue-700 dark:text-blue-400">
                  كلمة المرور المؤقتة: <span dir="ltr" className="font-black">{generatedPassword}</span>
                  <br />
                  <span className="text-xs text-blue-500 dark:text-blue-400">انسخها الآن — لن تظهر مرة أخرى</span>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
                <Button type="submit" disabled={loading} className="w-full sm:flex-1">
                  {loading ? <Loader2 className="ml-1.5 h-4 w-4 animate-spin" /> : null}
                  {loading ? "جارٍ الحفظ..." : "حفظ التغييرات"}
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
