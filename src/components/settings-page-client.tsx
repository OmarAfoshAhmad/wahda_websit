"use client";

import React, { useActionState, useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, CheckCircle2, Eye, EyeOff, Wallet, MessageSquare } from "lucide-react";
import { voluntaryChangePassword } from "@/app/actions/auth";
import { updateInitialBalance, updateOtpSettings } from "@/app/actions/system-settings";
import { Button, Input, Card } from "@/components/ui";
import { formatCurrency } from "@/lib/money";

type SettingsPageClientProps = {
  initialBalance: number;
  otpSettings: { provider: string; apiKey: string; senderId: string; apiUrl: string; otpLength: number; otpExpiry: number; facilityName: string };
  canManageInitialBalance: boolean;
};

export function SettingsPageClient({ initialBalance, otpSettings, canManageInitialBalance }: SettingsPageClientProps) {
  const [passwordState, passwordAction, isPasswordPending] = useActionState(voluntaryChangePassword, undefined);
  const [balanceState, balanceAction, isBalancePending] = useActionState(updateInitialBalance, undefined);
  const [otpState, otpAction, isOtpPending] = useActionState(updateOtpSettings, undefined);

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const currentBalance = typeof balanceState?.value === "number" ? balanceState.value : initialBalance;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center">
          <div className="mb-4 flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/5">
              <KeyRound className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-base font-black text-slate-900 dark:text-white">{otpSettings.facilityName}</p>
            </div>
          </div>
          <h2 className="section-title text-2xl font-black text-slate-950 dark:text-white">الإعدادات</h2>
          <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">إدارة كلمة المرور والإعدادات العامة للنظام.</p>
        </div>

        {canManageInitialBalance ? (
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" />
              <h3 className="text-lg font-black text-slate-900 dark:text-white">الرصيد الابتدائي للمستفيد الجديد</h3>
            </div>

            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              القيمة الحالية: <span className="font-black text-slate-900 dark:text-white">{formatCurrency(currentBalance)} د.ل</span>
            </p>
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              تنبيه: أي تغيير هنا يطبق على السجلات الجديدة فقط، ولا يغير أرصدة المستفيدين المضافين سابقاً.
            </p>

            <form action={balanceAction} className="space-y-4">
              {balanceState?.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">{balanceState.error}</div>
              ) : null}

              {balanceState?.success ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-400">{balanceState.success}</div>
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

        {canManageInitialBalance ? (
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-black text-slate-900 dark:text-white">إعدادات مزود خدمة الرسائل (OTP)</h3>
            </div>

            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              تتيح لك هذه الواجهة تغيير مزود خدمة الـ OTP وإعداداته دون الحاجة لتعديل الكود البرمجي.
            </p>

            <form action={otpAction} className="space-y-4">
              {otpState?.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">{otpState.error}</div>
              ) : null}

              {otpState?.success ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-400">{otpState.success}</div>
              ) : null}

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">اسم المنشأة / التطبيق</label>
                <Input
                  name="facilityName"
                  type="text"
                  defaultValue={otpSettings.facilityName}
                  placeholder="أدخل اسم المنشأة الذي سيظهر في الرسائل والموقع"
                  className="h-12 text-sm"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">مزود الخدمة (Provider)</label>
                <select name="provider" defaultValue={otpSettings.provider} className="flex h-12 w-full rounded-md border border-slate-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:placeholder:text-slate-400 dark:focus-visible:ring-primary">
                  <option value="MOCK">محاكاة (للتجربة)</option>
                  <option value="ALMADAR">المدار (Almadar)</option>
                  <option value="LIBYANA">ليبيانا (Libyana)</option>
                  <option value="TWILIO">Twilio</option>
                  <option value="CUSTOM">مخصص (Custom API)</option>
                  <option value="RESALA">Resala.ly (رسالة.لي)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">رابط الـ API (إن وجد)</label>
                <Input
                  name="apiUrl"
                  type="url"
                  defaultValue={otpSettings.apiUrl}
                  placeholder="https://api.provider.com/sms"
                  className="h-12 text-sm text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">مفتاح الـ API (API Key)</label>
                <Input
                  name="apiKey"
                  type="password"
                  defaultValue={otpSettings.apiKey}
                  placeholder="أدخل مفتاح الربط الخاص بالشركة"
                  className="h-12 text-sm text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">اسم المرسل (Sender ID)</label>
                <Input
                  name="senderId"
                  type="text"
                  defaultValue={otpSettings.senderId}
                  placeholder="WAHA"
                  className="h-12 text-sm text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">عدد خانات الـ OTP</label>
                <select name="otpLength" defaultValue={otpSettings.otpLength.toString()} className="flex h-12 w-full rounded-md border border-slate-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:placeholder:text-slate-400 dark:focus-visible:ring-primary">
                  <option value="4">4 أرقام</option>
                  <option value="6">6 أرقام</option>
                  <option value="8">8 أرقام</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-[0.18em] text-slate-400">مدة صلاحية الـ OTP (بالدقائق)</label>
                <Input
                  name="otpExpiry"
                  type="number"
                  defaultValue={otpSettings.otpExpiry}
                  min="1"
                  max="60"
                  className="h-12 text-sm text-left"
                />
              </div>

              <Button type="submit" disabled={isOtpPending} className="h-12">
                {isOtpPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جارٍ الحفظ...
                  </span>
                ) : (
                  "حفظ إعدادات مزود الرسائل"
                )}
              </Button>
            </form>
          </Card>
        ) : null}

        <Card className="p-6">
          {passwordState?.success ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-bold text-slate-800 dark:text-slate-100">{passwordState.success}</p>
              <Link href="/dashboard" className="mt-2 text-sm font-semibold text-primary hover:underline">
                العودة إلى الرئيسية
              </Link>
            </div>
          ) : (
            <form action={passwordAction} className="space-y-5">
              {passwordState?.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">{passwordState.error}</div>
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
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" tabIndex={-1}>
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
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" tabIndex={-1}>
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
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" tabIndex={-1}>
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
                <Link href="/dashboard" className="text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline">
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
