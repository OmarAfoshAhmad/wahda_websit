"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { resetManagerPassword } from "@/app/actions/manager";
import { Button } from "@/components/ui";

interface ManagerResetPasswordButtonProps {
  id: string;
  name: string;
}

export function ManagerResetPasswordButton({ id, name }: ManagerResetPasswordButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tempPassword?: string; error?: string } | null>(null);

  const handleReset = () => {
    startTransition(async () => {
      const res = await resetManagerPassword(id);
      setResult(res);
    });
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-50 px-2.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
      >
        <KeyRound className="h-3.5 w-3.5" />
        تصفير
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="mb-2 text-lg font-black text-slate-900 dark:text-white">
              تصفير كلمة المرور
            </h3>

            {!result?.tempPassword ? (
              <>
                <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
                  هل أنت متأكد من رغبتك في تصفير كلمة مرور حساب <strong>{name}</strong>؟ سيتم تعيينها إلى <span dir="ltr" className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">123456</span> مؤقتاً.
                </p>

                {result?.error && (
                  <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                    {result.error}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsOpen(false);
                      setResult(null);
                    }}
                    disabled={pending}
                  >
                    إلغاء
                  </Button>
                  <Button
                    onClick={handleReset}
                    disabled={pending}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    {pending ? "جارٍ التصفير..." : "تأكيد التصفير"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-900/50 dark:bg-emerald-900/20">
                  <p className="mb-2 text-sm text-emerald-800 dark:text-emerald-300">
                    تم تصفير كلمة المرور بنجاح.
                  </p>
                  <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    كلمة المرور المؤقتة: <span dir="ltr" className="font-mono bg-white dark:bg-emerald-900 px-2 py-1 rounded border border-emerald-200 dark:border-emerald-800 text-lg">{result.tempPassword}</span>
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={() => {
                      setIsOpen(false);
                      setResult(null);
                    }}
                  >
                    إغلاق
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
