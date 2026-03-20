"use client";

import React, { useActionState } from "react";
import { authenticate } from "@/app/actions/auth";
import { Button, Input, Card } from "@/components/ui";
import { Loader2, Lock, ShieldCheck, User } from "lucide-react";

export default function LoginPage() {
  const [state, action, isPending] = useActionState(authenticate, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-4 flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Waha Healthy Care" width={72} height={72} className="object-contain" />
            <div>
              <p className="text-base font-black text-slate-900">Waha Healthy Care</p>
            </div>
          </div>
          <h2 className="section-title text-2xl font-black text-slate-950">تسجيل الدخول</h2>
          <p className="mt-2 text-sm font-medium text-slate-500">الرجاء إدخال بيانات الدخول للوصول إلى النظام.</p>
        </div>

        <Card className="p-6">
          <form action={action} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="mr-1 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                  اسم المستخدم
                </label>
                <div className="relative group">
                  <User className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary" />
                  <Input
                    name="username"
                    autoComplete="username"
                    placeholder="اكتب اسم المستخدم"
                    className="h-12 pr-12 text-sm"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="mr-1 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                  كلمة المرور
                </label>
                <div className="relative group">
                  <Lock className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary" />
                  <Input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-12 pr-12 text-sm"
                    required
                  />
                </div>
              </div>
            </div>

            {state?.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="animate-shake text-center text-sm font-bold text-red-600">
                  {state.error}
                </p>
              </div>
            )}

            <Button type="submit" className="h-12 w-full text-base" disabled={isPending}>
              {isPending ? <Loader2 className="ml-2 h-6 w-6 animate-spin" /> : null}
              {isPending ? "جارٍ التحقق" : "دخول إلى المنصة"}
            </Button>
          </form>
        </Card>

        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
          <div className="mb-1 flex items-center justify-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="font-bold text-slate-700">وصول خاص بالمرافق الصحية</span>
          </div>
          يرجى استخدام بيانات الاعتماد المعتمدة من إدارة النظام.
        </div>
      </div>
    </div>
  );
}
