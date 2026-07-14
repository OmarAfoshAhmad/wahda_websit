"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Suspense } from "react";
import { normalizeCardInput } from "@/lib/card-number";

function SetupPinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cardNumber = searchParams.get("card") ?? "";

  const [pin, setPin] = useState(["", "", "", "", "", ""]);
  const [confirmPin, setConfirmPin] = useState(["", "", "", "", "", ""]);
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = useCallback((
    index: number,
    value: string,
    arr: string[],
    setArr: (v: string[]) => void,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    onComplete?: (full: string) => void
  ) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...arr];
    next[index] = value;
    setArr(next);
    setError("");
    if (value && index < 5) refs.current[index + 1]?.focus();
    if (value && index === 5) {
      const full = [...next.slice(0, 5), value].join("");
      if (full.length === 6) onComplete?.(full);
    }
  }, []);

  const handleKeyDown = useCallback((
    index: number,
    e: React.KeyboardEvent,
    arr: string[],
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => {
    if (e.key === "Backspace" && !arr[index] && index > 0) refs.current[index - 1]?.focus();
  }, []);

  const handleFirstComplete = useCallback((full: string) => {
    setStep("confirm");
    setTimeout(() => confirmRefs.current[0]?.focus(), 100);
    void full;
  }, []);

  const handleConfirmComplete = useCallback(async (fullConfirm: string) => {
    const firstFull = pin.join("");
    if (firstFull !== fullConfirm) {
      setError("رمز PIN غير متطابق. حاول مرة أخرى");
      setPin(["", "", "", "", "", ""]);
      setConfirmPin(["", "", "", "", "", ""]);
      setStep("enter");
      setTimeout(() => pinRefs.current[0]?.focus(), 50);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/beneficiary/setup-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_number: normalizeCardInput(cardNumber), pin: firstFull, confirm_pin: fullConfirm }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        router.push("/beneficiary/dashboard");
        return;
      }
      setError(data.error ?? "حدث خطأ");
      setPin(["", "", "", "", "", ""]);
      setConfirmPin(["", "", "", "", "", ""]);
      setStep("enter");
      setTimeout(() => pinRefs.current[0]?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }, [pin, cardNumber, router]);

  return (
    <div className="space-y-5">
      {/* المؤشر */}
      <div className="flex items-center justify-center gap-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${step === "enter" ? "bg-primary text-white" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"}`}>
          {step === "enter" ? "1" : <ShieldCheck className="h-4 w-4" />}
        </div>
        <div className="h-px w-8 bg-slate-200 dark:bg-slate-700" />
        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${step === "confirm" ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"}`}>
          2
        </div>
      </div>

      {step === "enter" ? (
        <>
          <p className="text-center text-sm text-slate-600 dark:text-slate-400">اختر رمز PIN من 6 أرقام</p>
          <div className="flex justify-center gap-2.5" dir="ltr">
            {pin.map((d, i) => (
              <input
                key={i}
                ref={(el) => { pinRefs.current[i] = el; }}
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                maxLength={1}
                value={d}
                autoFocus={i === 0}
                onChange={(e) => handleChange(i, e.target.value, pin, setPin, pinRefs, handleFirstComplete)}
                onKeyDown={(e) => handleKeyDown(i, e, pin, pinRefs)}
                className="h-14 w-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-center text-2xl font-black text-slate-900 dark:text-white focus:border-primary focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            ))}
          </div>
          <button type="button" onClick={() => setShowPin(!showPin)} className="flex items-center gap-1.5 mx-auto text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPin ? "إخفاء الأرقام" : "إظهار الأرقام"}
          </button>
        </>
      ) : (
        <>
          <p className="text-center text-sm text-slate-600 dark:text-slate-400">أعد إدخال الرمز للتأكيد</p>
          <div className="flex justify-center gap-2.5" dir="ltr">
            {confirmPin.map((d, i) => (
              <input
                key={i}
                ref={(el) => { confirmRefs.current[i] = el; }}
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleChange(i, e.target.value, confirmPin, setConfirmPin, confirmRefs, handleConfirmComplete)}
                onKeyDown={(e) => handleKeyDown(i, e, confirmPin, confirmRefs)}
                disabled={loading}
                className="h-14 w-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-center text-2xl font-black text-slate-900 dark:text-white focus:border-primary focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition-colors"
              />
            ))}
          </div>
          <button type="button" onClick={() => setShowPin(!showPin)} className="flex items-center gap-1.5 mx-auto text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPin ? "إخفاء الأرقام" : "إظهار الأرقام"}
          </button>
        </>
      )}

      {loading && <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3">
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
          <p className="text-sm font-bold text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

export default function SetupPinPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="الواحة" width={64} height={64} className="object-contain" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Waha Health Care</p>
            <h1 className="mt-0.5 text-xl font-black text-slate-900 dark:text-white">إنشاء رمز الدخول</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">سيُستخدم هذا الرمز في كل مرة تدخل فيها</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
          <Suspense>
            <SetupPinForm />
          </Suspense>
        </div>

        <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
          لا تشارك رمز PIN مع أحد
        </p>
      </div>
    </div>
  );
}
