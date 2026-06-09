"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, X, CheckCircle2 } from "lucide-react";
import { resetManagerPassword } from "@/app/actions/manager";

interface Props {
  id: string;
  name: string;
}

export function ManagerResetPasswordButton({ id, name }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleReset = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await resetManagerPassword(id);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(result.tempPassword || "123456");
      router.refresh();
    }
  };

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null); setSuccess(null); }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-600 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/60"
        title="إعادة تعيين كلمة المرور إلى 123456"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => { if (e.target === e.currentTarget && !success) setOpen(false); }}
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">إعادة تعيين كلمة المرور</h2>
              {!success && (
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {!success ? (
              <>
                <p className="mb-1.5 text-sm text-slate-600 dark:text-slate-400">هل أنت متأكد من إعادة تعيين كلمة مرور الحساب:</p>
                <p className="mb-4 font-black text-slate-900 dark:text-white">{name}</p>
                <p className="mb-5 text-xs text-slate-500 dark:text-slate-500">
                  سيتم تعيين كلمة المرور إلى <strong>123456</strong> وسيطالب النظام المستخدم بتغييرها فور تسجيل الدخول.
                </p>

                {error && (
                  <div className="mb-4 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm font-bold text-red-700 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setOpen(false)}
                    disabled={loading}
                    className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={loading}
                    className="flex-1 rounded-md bg-amber-600 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                  >
                    {loading ? "جارٍ الإعادة..." : "إعادة التعيين"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 flex flex-col items-center justify-center py-4">
                  <CheckCircle2 className="mb-3 h-12 w-12 text-emerald-500" />
                  <p className="mb-2 text-center text-sm font-bold text-slate-900 dark:text-white">
                    تمت إعادة تعيين كلمة المرور بنجاح!
                  </p>
                  <div className="mt-2 rounded-lg bg-slate-100 dark:bg-slate-800 px-6 py-3 text-center">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">كلمة المرور المؤقتة الجديدة:</p>
                    <p className="text-xl font-black tracking-widest text-slate-900 dark:text-white" dir="ltr">
                      {success}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  إغلاق
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
