"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { createEmployee, createManager } from "@/app/actions/manager";
import { Button, Input } from "@/components/ui";

export function ManagerCreateForm() {
  const [accountType, setAccountType] = useState<"manager" | "employee">("manager");
  const [state, setState] = useState<{ error?: string; success?: boolean; tempPassword?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const action = (formData: FormData) => {
    setState(null);
    startTransition(async () => {
      const result = accountType === "employee"
        ? await createEmployee(null, formData)
        : await createManager(null, formData);
      setState(result as { error?: string; success?: boolean; tempPassword?: string });
      if (result && typeof result === "object" && "success" in result && result.success) {
        router.refresh();
      }
    });
  };

  return (
    <form action={action} className="space-y-3">
      {state?.error && (
        <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-bold text-red-700 dark:text-red-400">
          {state.error}
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">نوع الحساب</label>
        <select
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as "manager" | "employee")}
          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="manager">مدير</option>
          <option value="employee">موظف</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">اسم الحساب</label>
        <Input
          name="name"
          required
          placeholder={accountType === "employee" ? "مثال: موظف الصندوق" : "مثال: مدير العمليات"}
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

      <div className="flex items-start gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2.5">
        <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-xs text-blue-700 dark:text-blue-400">
          {accountType === "employee"
            ? "سيتم إنشاء حساب موظف بصلاحيات قراءة الحركات + صفحة الكاش فقط بشكل افتراضي."
            : "سيتم إنشاء حساب مدير بصلاحيات محدودة. يمكنك لاحقاً تعديل صلاحياته من هذه الصفحة."}
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
        {pending ? "جارٍ الإنشاء..." : accountType === "employee" ? "إنشاء حساب موظف" : "إنشاء حساب مدير"}
      </Button>
    </form>
  );
}
