"use client";

import React, { useActionState } from "react";
import { voluntaryChangePassword } from "@/app/actions/auth";
import { Button, Input, Card } from "@/components/ui";
import { KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
  const [state, action, isPending] = useActionState(voluntaryChangePassword, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-4 flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/5">
              <KeyRound className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-base font-black text-slate-900">Waha Healthy Care</p>
            </div>
          </div>
          <h2 className="section-title text-2xl font-black text-slate-950">تغيير كلمة المرور</h2>
          <p className="mt-2 text-sm font-medium text-slate-500">
            أدخل كلمة مرورك الحالية ثم اختر كلمة مرور جديدة.
          </p>
        </div>

        <Card className="p-6">
          {state?.success ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-bold text-slate-800">{state.success}</p>
              <Link
                href="/dashboard"
                className="mt-2 text-sm font-semibold text-primary hover:underline"
              >
                العودة إلى الرئيسية
              </Link>
            </div>
          ) : (
            <form action={action} className="space-y-5">
              {state?.error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.error}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  كلمة المرور الحالية
                </label>
                <Input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  placeholder="أدخل كلمة مرورك الحالية"
                  className="h-12 text-sm"
                  required
                />
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
                  placeholder="أعد كتابة كلمة المرور الجديدة"
                  className="h-12 text-sm"
                  required
                />
              </div>

              <Button type="submit" disabled={isPending} className="h-12 w-full">
                {isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جارٍ الحفظ...
                  </span>
                ) : (
                  "حفظ كلمة المرور"
                )}
              </Button>

              <div className="text-center">
                <Link
                  href="/dashboard"
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600 hover:underline"
                >
                  إلغاء والعودة
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
