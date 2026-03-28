"use client";

import React, { useActionState, useState } from "react";
import Link from "next/link";
import { authenticate } from "@/app/actions/auth";
import { Button, Input, Card } from "@/components/ui";
import { Loader2, Lock, ShieldCheck, User, Eye, EyeOff } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function LoginPage() {
  const [state, action, isPending] = useActionState(authenticate, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-6 bg-slate-50 dark:bg-[#0b1120] transition-colors relative">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeSwitcher />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-4 flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Waha Healthy Care" width={72} height={72} className="object-contain dark:brightness-110" />
            <div>
              <p className="text-base font-black text-slate-900 dark:text-white">Waha Health Care</p>
            </div>
          </div>
          <h2 className="section-title text-2xl font-black text-slate-950 dark:text-white">تسجيل الدخول</h2>
          <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">الرجاء إدخال بيانات الدخول للوصول إلى النظام.</p>
        </div>

        <Card className="p-6">
          <form action={action} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="mr-1 block text-xs font-black uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                  اسم المستخدم
                </label>
                <div className="relative group">
                  <User className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500 transition-colors group-focus-within:text-primary dark:group-focus-within:text-blue-400" />
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
                <label className="mr-1 block text-xs font-black uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                  كلمة المرور
                </label>
                <div className="relative group">
                  <Lock className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500 transition-colors group-focus-within:text-primary dark:group-focus-within:text-blue-400" />
                  <Input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-12 pr-12 pl-12 text-sm"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300" tabIndex={-1}>
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>

            {state?.error && (
              <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 p-3">
                <p className="animate-shake text-center text-sm font-bold text-red-600 dark:text-red-400">
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

        <Link
          href="/beneficiary/login"
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-md border border-primary/25 bg-primary-light dark:bg-primary-light/10 text-sm font-black text-primary dark:text-white transition hover:bg-primary/10 dark:hover:bg-primary/20"
        >
          تسجيل كمستفيد
        </Link>

        <div className="mt-4 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-center text-xs text-slate-500 dark:text-slate-400">
          <div className="mb-1 flex items-center justify-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary dark:text-blue-400" />
            <span className="font-bold text-slate-700 dark:text-slate-200">وصول خاص بالمرافق الصحية</span>
          </div>
          يرجى استخدام بيانات الاعتماد المعتمدة من إدارة النظام.
        </div>
      </div>
    </div>
  );
}
