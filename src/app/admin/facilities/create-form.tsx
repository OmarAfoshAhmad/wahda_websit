"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { createFacility } from "@/app/actions/facility";

export function CreateFacilityForm() {
  const [state, action, pending] = useActionState(createFacility, null);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state && typeof state === "object" && "success" in state && state.success) {
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={action} className="space-y-3">
      {state?.error && (
        <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-bold text-red-700 dark:text-red-400">
          {state.error}
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
          {isAdmin ? "اسم المشرف" : "اسم المرفق"}
        </label>
        <input
          name="name"
          type="text"
          required
          placeholder={isAdmin ? "مثال: مشرف المنطقة الشمالية" : "مثال: مستشفى المركز الطبي"}
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">اسم المستخدم</label>
        <input
          name="username"
          type="text"
          required
          placeholder={isAdmin ? "مثال: admin_north" : "مثال: hospital_central"}
          dir="ltr"
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط</p>
      </div>

      {/* hidden input يحمل قيمة is_admin */}
      <input type="hidden" name="is_admin" value={String(isAdmin)} />

      {/* تبديل نوع الحساب */}
      <button
        type="button"
        onClick={() => setIsAdmin((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm font-bold transition-colors ${
          isAdmin
            ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400"
            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50"
        }`}
      >
        <Shield className={`h-4 w-4 shrink-0 ${isAdmin ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`} />
        <span>{isAdmin ? "حساب مشرف (سيملك صلاحيات كاملة)" : "حساب مرفق صحي عادي"}</span>
        <span className={`mr-auto h-4 w-4 rounded-sm border-2 flex items-center justify-center shrink-0 ${isAdmin ? "border-amber-500 bg-amber-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>
          {isAdmin && <svg viewBox="0 0 10 8" fill="none" className="h-2.5 w-2.5"><path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </span>
      </button>

      <div className="rounded-md border border-blue-100 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-xs text-blue-700 dark:text-blue-400">
        سيتم توليد كلمة مرور مؤقتة عشوائية تلقائياً، وسيُطلب من المستخدم تغييرها عند أول تسجيل دخول.
      </div>
      {state && typeof state === "object" && "success" in state && state.success && "tempPassword" in state ? (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-400">
          تم إنشاء الحساب بنجاح — كلمة المرور المؤقتة: <span className="font-black" dir="ltr">{String(state.tempPassword)}</span>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={`w-full rounded-md px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60 ${
          isAdmin ? "bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600" : "bg-primary hover:bg-primary-dark"
        }`}
      >
        {pending ? "جاري الإنشاء..." : isAdmin ? "إنشاء حساب مشرف" : "إنشاء الحساب"}
      </button>
    </form>
  );
}
