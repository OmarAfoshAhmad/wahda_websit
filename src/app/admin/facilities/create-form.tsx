"use client";

import { useActionState } from "react";
import { createFacility } from "@/app/actions/facility";

export function CreateFacilityForm() {
  const [state, action, pending] = useActionState(createFacility, null);

  return (
    <form action={action} className="space-y-3">
      {state?.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {state.error}
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">اسم المرفق</label>
        <input
          name="name"
          type="text"
          required
          placeholder="مثال: مستشفى المركز الطبي"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">اسم المستخدم</label>
        <input
          name="username"
          type="text"
          required
          placeholder="مثال: hospital_central"
          dir="ltr"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p className="mt-1 text-xs text-slate-400">أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط</p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">كلمة المرور</label>
        <input
          name="password"
          type="password"
          required
          placeholder="6 أحرف على الأقل"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>
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
