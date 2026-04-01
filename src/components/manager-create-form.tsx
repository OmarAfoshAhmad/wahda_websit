"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { createManager } from "@/app/actions/manager";
import { Button, Input } from "@/components/ui";

export function ManagerCreateForm() {
  const [state, action, pending] = useActionState(createManager, null);
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
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">اسم المدير</label>
        <Input
          name="name"
          required
          placeholder="مثال: مدير العمليات"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">اسم المستخدم</label>
        <Input
          name="username"
          required
          placeholder="مثال: manager_ops"
          dir="ltr"
        />
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">نوع الحساب</label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50/50 dark:has-[:checked]:bg-blue-900/10">
            <input type="radio" name="is_admin" value="false" defaultChecked className="h-4 w-4 text-blue-600" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">مدير صلاحيات</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-50/50 dark:has-[:checked]:bg-violet-900/10">
            <input type="radio" name="is_admin" value="true" className="h-4 w-4 text-violet-600" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">مشرف عام</span>
          </label>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
        <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-xs text-amber-700 dark:text-amber-400">
          المشرف العام يملك كافة الصلاحيات، بينما المدير يتم تحديد صلاحياته بدقة بعد الإنشاء.
        </p>
      </div>

      <div className="rounded-md border border-blue-100 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-400">
        كلمة المرور المؤقتة: <strong dir="ltr">123456</strong> — المدير مُلزم بتغييرها عند أول دخول
      </div>

      {state && typeof state === "object" && "success" in state && state.success && "tempPassword" in state ? (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-400">
          تم إنشاء الحساب — كلمة المرور المؤقتة:{" "}
          <span className="font-black" dir="ltr">{String(state.tempPassword)}</span>
        </div>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "جارٍ الإنشاء..." : "إنشاء حساب مدير"}
      </Button>
    </form>
  );
}
