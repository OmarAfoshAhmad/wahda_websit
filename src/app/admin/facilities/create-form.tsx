"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createFacility } from "@/app/actions/facility";

export function CreateFacilityForm() {
  const [state, action, pending] = useActionState(createFacility, null);
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
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">اسم المرفق</label>
        <input
          name="name"
          type="text"
          required
          placeholder="مثال: مستشفى المركز الطبي"
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">اسم المستخدم</label>
        <input
          name="username"
          type="text"
          required
          placeholder="مثال: hospital_central"
          dir="ltr"
          className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط</p>
      </div>
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
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {pending ? "جاري الإنشاء..." : "إنشاء الحساب"}
      </button>
    </form>
  );
}
