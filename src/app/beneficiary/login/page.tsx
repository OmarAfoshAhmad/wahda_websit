"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, CreditCard, Eye, EyeOff } from "lucide-react";
import { normalizeCardInput } from "@/lib/card-number";

type Step = "card" | "pin";

export default function BeneficiaryLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("card");
  const [cardNumber, setCardNumber] = useState("");
  const [pin, setPin] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [errorPulse, setErrorPulse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cardRef = useRef<HTMLInputElement>(null);

  const triggerErrorFeedback = useCallback((message: string) => {
    setError(message);
    setErrorPulse(true);
    window.setTimeout(() => setErrorPulse(false), 450);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(120);
    }
  }, []);

  // ── الخطوة 1: التحقق من رقم البطاقة ──────────────────────────────
  const handleCardSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = normalizeCardInput(cardNumber);
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await fetch("/api/beneficiary/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_number: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        triggerErrorFeedback(data.error ?? "حدث خطأ");
        return;
      }

      if (data.status === "needs_setup") {
        router.push(`/beneficiary/setup-pin?card=${encodeURIComponent(trimmed)}`);
        return;
      }

      // needs_pin → انتقل لخطوة PIN
      setStep("pin");
      setTimeout(() => pinRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  }, [cardNumber, router, triggerErrorFeedback]);

  // ── الخطوة 2: إدخال PIN ───────────────────────────────────────────
  const handlePinChange = useCallback(async (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    setError("");

    if (value && index < 5) {
      pinRefs.current[index + 1]?.focus();
    }

    // إذا امتلأت الـ 6 خانات → أرسل تلقائياً
    if (value && index === 5) {
      const fullPin = [...newPin.slice(0, 5), value].join("");
      if (fullPin.length === 6) await submitPin(fullPin);
    }
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePinKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  }, [pin]);

  const submitPin = useCallback(async (fullPin: string) => {
    setLoading(true);
    setError("");
    const normalizedCard = normalizeCardInput(cardNumber);
    try {
      const res = await fetch("/api/beneficiary/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_number: normalizedCard, pin: fullPin }),
      });
      const data = await res.json();

      if (data.status === "ok") {
        router.push("/beneficiary/dashboard");
        return;
      }

      triggerErrorFeedback(data.error ?? "رمز PIN خاطئ");
      setPin(["", "", "", "", "", ""]);
      setTimeout(() => pinRefs.current[0]?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }, [cardNumber, router, triggerErrorFeedback]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        {/* شعار */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="الواحة" width={64} height={64} className="object-contain" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Waha Health Care</p>
            <h1 className="mt-0.5 text-xl font-black text-slate-900 dark:text-white">بوابة المستفيد</h1>
          </div>
        </div>

        {/* بطاقة الدخول */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">

          {step === "card" ? (
            <form onSubmit={handleCardSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  رقم البطاقة
                </label>
                <div className="relative">
                  <CreditCard className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={cardRef}
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoFocus
                    value={cardNumber}
                    onChange={(e) => { setCardNumber(e.target.value); setError(""); }}
                    placeholder="أدخل رقم بطاقتك"
                    className="h-14 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-12 pl-4 text-center text-lg font-bold tracking-widest text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:border-primary focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className={`flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 ${errorPulse ? "animate-shake" : ""}`}>
                  <ShieldAlert className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                  <p className="text-sm font-bold text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !cardNumber.trim()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-black text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {loading ? "جارٍ التحقق…" : "التالي"}
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-center text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  رمز PIN
                </p>
                <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
                  أدخل الرمز السري المكوّن من 6 أرقام
                </p>
              </div>

              {/* مربعات PIN */}
              <div className="flex justify-center gap-2.5" dir="ltr">
                {pin.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { pinRefs.current[i] = el; }}
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                    disabled={loading}
                    className="h-14 w-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-center text-2xl font-black text-slate-900 dark:text-white focus:border-primary focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition-colors"
                  />
                ))}
              </div>

              <button type="button" onClick={() => setShowPin(!showPin)} className="flex items-center gap-1.5 mx-auto text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                {showPin ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPin ? "إخفاء الأرقام" : "إظهار الأرقام"}
              </button>

              {error && (
                <div className={`flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 ${errorPulse ? "animate-shake" : ""}`}>
                  <ShieldAlert className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                  <p className="text-sm font-bold text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              {loading && (
                <div className="flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}

              <button
                type="button"
                onClick={() => { setStep("card"); setPin(["", "", "", "", "", ""]); setError(""); }}
                className="w-full text-center text-sm font-bold text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                ← تغيير رقم البطاقة
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
          بوابة آمنة مخصصة للمستفيدين فقط
        </p>
      </div>
    </div>
  );
}
