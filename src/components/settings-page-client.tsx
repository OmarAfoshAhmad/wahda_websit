"use client";

import React, { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, CheckCircle2, Eye, EyeOff, Wallet } from "lucide-react";
import { voluntaryChangePassword } from "@/app/actions/auth";
import { updateInitialBalance } from "@/app/actions/system-settings";
import { Button, Input, Card } from "@/components/ui";

type SettingsPageClientProps = {
  initialBalance: number;
  canManageInitialBalance: boolean;
};

export function SettingsPageClient({ initialBalance, canManageInitialBalance }: SettingsPageClientProps) {
  const [passwordState, passwordAction, isPasswordPending] = useActionState(voluntaryChangePassword, undefined);
  const [balanceState, balanceAction, isBalancePending] = useActionState(updateInitialBalance, undefined);

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [currentBalance, setCurrentBalance] = useState(initialBalance);

  useEffect(() => {
    if (typeof balanceState?.value === "number") {
      setCurrentBalance(balanceState.value);
    }
  }, [balanceState]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center">
          <div className="mb-4 flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/5">
              <KeyRound className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-base font-black text-slate-900">Waha Health Care</p>
            </div>
          </div>
          <h2 className="section-title text-2xl font-black text-slate-950">الإعدادات</h2>
          <p className="mt-2 text-sm font-medium text-slate-500">إدارة كلمة المرور والإعدادات العامة للنظام.</p>
        </div>

        {canManageInitialBalance ? (
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" />
              <h3 className="text-lg font-black text-slate-900">الرصيد الابتدائي للمستفيد الجديد</h3>
            </div>

            <p className="mb-4 text-sm text-slate-600">
              القيمة الحالية: <span className="font-black text-slate-900">{currentBalance.toLocaleString("ar-LY")} د.ل</span>
            </p>
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              تنبيه: أي تغيير هنا يطبق على السجلات الجديدة فقط، ولا يغير أرصدة المستفيدين المضافين سابقاً.
            </p>

            <form action={balanceAction} className="space-y-4">
              {balanceState?.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{balanceState.error}</div>
              ) : null}

              {balanceState?.success ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{balanceState.success}</div>
              ) : null}

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">الرصيد الجديد</label>
                <Input
                  name="initialBalance"
                  type="number"
                  defaultValue={currentBalance}
                  min={1}
                  max={1000000}
                  step={1}
                  className="h-12 text-sm"
                  required
                />
              </div>

              <Button type="submit" disabled={isBalancePending} className="h-12">
                {isBalancePending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جارٍ الحفظ...
                  </span>
                ) : (
                  "حفظ الرصيد الابتدائي"
                )}
              </Button>
            </form>
          </Card>
        ) : null}

        <Card className="p-6">
          {passwordState?.success ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-bold text-slate-800">{passwordState.success}</p>
              <Link href="/dashboard" className="mt-2 text-sm font-semibold text-primary hover:underline">
                العودة إلى الرئيسية
              </Link>
            </div>
          ) : (
            <form action={passwordAction} className="space-y-5">
              {passwordState?.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{passwordState.error}</div>
              ) : null}

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">كلمة المرور الحالية</label>
                <div className="relative">
                  <Input
                    name="currentPassword"
                    type={showCurrent ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="أدخل كلمة مرورك الحالية"
                    className="h-12 pl-12 text-sm"
                    required
                  />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabIndex={-1}>
                    {showCurrent ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">كلمة المرور الجديدة</label>
                <div className="relative">
                  <Input
                    name="newPassword"
                    type={showNew ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="8 أحرف على الأقل مع حرف كبير ورقم"
                    className="h-12 pl-12 text-sm"
                    required
                    minLength={8}
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabIndex={-1}>
                    {showNew ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">تأكيد كلمة المرور</label>
                <div className="relative">
                  <Input
                    name="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="أعد كتابة كلمة المرور الجديدة"
                    className="h-12 pl-12 text-sm"
                    required
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabIndex={-1}>
                    {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <Button type="submit" disabled={isPasswordPending} className="h-12 w-full">
                {isPasswordPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جارٍ الحفظ...
                  </span>
                ) : (
                  "حفظ كلمة المرور"
                )}
              </Button>

              <div className="text-center">
                <Link href="/dashboard" className="text-xs font-semibold text-slate-400 hover:text-slate-600 hover:underline">
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
