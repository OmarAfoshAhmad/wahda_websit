"use client";

import React, { useActionState } from "react";
import { changePassword } from "@/app/actions/auth";
import { Button, Input, Card } from "@/components/ui";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";

export default function ChangePasswordPage() {
  const [state, action, isPending] = useActionState(changePassword, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-4 flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-50">
              <KeyRound className="h-8 w-8 text-amber-600" />
            </div>
            <div>
              <p className="text-base font-black text-slate-900">Waha Healthy Care</p>
            </div>
          </div>
          <h2 className="section-title text-2xl font-black text-slate-950">تغيير كلمة المرور</h2>
          <p className="mt-2 text-sm font-medium text-slate-500">
            يجب عليك تغيير كلمة المرور الافتراضية قبل المتابعة.
          </p>
        </div>

        <Card className="p-6">
          <form action={action} className="space-y-5">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-bold">⚠ إجراء أمني مطلوب</p>
              <p className="mt-0.5 text-xs">تم تفعيل حسابك بكلمة مرور افتراضية. يجب تغييرها الآن لحماية بياناتك.</p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                كلمة المرور الجديدة
              </label>
              <Input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                placeholder="6 أحرف على الأقل"
                className="h-12 text-sm"
                required
                minLength={6}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                تأكيد كلمة المرور
              </label>
              <Input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="أعد كتابة كلمة المرور"
                className="h-12 text-sm"
                required
                minLength={6}
              />
            </div>

            {state?.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-center text-sm font-bold text-red-600">{state.error}</p>
              </div>
            )}

            <Button type="submit" className="h-12 w-full text-base" disabled={isPending}>
              {isPending ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : null}
              {isPending ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}
            </Button>
          </form>
        </Card>

        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
          <div className="mb-1 flex items-center justify-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="font-bold text-slate-700">بعد التغيير ستنتقل تلقائياً للوحة التحكم</span>
          </div>
        </div>
      </div>
    </div>
  );
}
