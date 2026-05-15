"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, Phone, CreditCard, Eye, EyeOff, Timer } from "lucide-react";
import { normalizeCardInput } from "@/lib/card-number";

type Step = "credentials" | "otp";

export default function BeneficiaryLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [cardNumber, setCardNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpLength, setOtpLength] = useState(6);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [error, setError] = useState("");
  const [errorPulse, setErrorPulse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // عداد الوقت
  useEffect(() => {
    if (step === "otp" && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [step, timeLeft]);

  const triggerErrorFeedback = useCallback((message: string) => {
    setError(message);
    setErrorPulse(true);
    window.setTimeout(() => setErrorPulse(false), 450);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(120);
    }
  }, []);

  // ── الخطوة 1: طلب الـ OTP ──────────────────────────────
  const handleCredentialsSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmedCard = normalizeCardInput(cardNumber);
    const trimmedPhone = phoneNumber.trim();
    if (!trimmedCard || !trimmedPhone) return;

    setLoading(true);
    try {
      const res = await fetch("/api/beneficiary/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_number: trimmedCard, phone_number: trimmedPhone }),
      });
      const data = await res.json();

      if (!res.ok) {
        triggerErrorFeedback(data.error ?? "حدث خطأ");
        return;
      }

      if (data.status === "otp_sent") {
        const length = data.length || 6;
        setOtpLength(length);
        setOtp(Array(length).fill(""));
        setTimeLeft(data.expiresIn || 300);
        setStep("otp");
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
      }
    } finally {
      setLoading(false);
    }
  }, [cardNumber, phoneNumber, triggerErrorFeedback]);

  // ── الخطوة 2: إدخال OTP ───────────────────────────────────────────
  const handleOtpChange = useCallback(async (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError("");

    if (value && index < otpLength - 1) {
      otpRefs.current[index + 1]?.focus();
    }

    if (value && index === otpLength - 1) {
      const fullOtp = [...newOtp.slice(0, otpLength - 1), value].join("");
      if (fullOtp.length === otpLength) await submitOtp(fullOtp);
    }
  }, [otp, otpLength]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOtpKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }, [otp]);

  const submitOtp = useCallback(async (fullOtp: string) => {
    if (timeLeft <= 0) {
      triggerErrorFeedback("انتهت صلاحية الرمز. يرجى الطلب مجدداً");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const trimmedCard = normalizeCardInput(cardNumber);
      const res = await fetch("/api/beneficiary/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_number: trimmedCard, phone_number: phoneNumber.trim(), code: fullOtp }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        router.push("/beneficiary/dashboard");
        return;
      }

      triggerErrorFeedback(data.error ?? "رمز التفعيل خاطئ");
      setOtp(Array(otpLength).fill(""));
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }, [cardNumber, phoneNumber, otpLength, timeLeft, router, triggerErrorFeedback]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="WAHA Health Care" width={64} height={64} className="object-contain" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">WAHA Health Care</p>
            <h1 className="mt-0.5 text-xl font-black text-slate-900 dark:text-white">بوابة المستفيد</h1>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
          {step === "credentials" ? (
            <form onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="card_number" className="block text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  رقم البطاقة
                </label>
                <div className="relative">
                  <CreditCard className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="card_number"
                    name="card_number"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoFocus
                    value={cardNumber}
                    onChange={(e) => { setCardNumber(e.target.value); setError(""); }}
                    placeholder="رقم البطاقة المستلمة"
                    className="h-14 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-12 pl-4 text-center text-lg font-bold tracking-widest text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:border-primary focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="phone_number" className="block text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  رقم الهاتف (لربط الحساب)
                </label>
                <div className="relative">
                  <Phone className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="phone_number"
                    name="phone_number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phoneNumber}
                    onChange={(e) => { setPhoneNumber(e.target.value); setError(""); }}
                    placeholder="مثال: 091xxxxxxx"
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
                disabled={loading || !phoneNumber.trim() || !cardNumber.trim()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-black text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {loading ? "جارٍ الإرسال…" : "تسجيل / إرسال OTP"}
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-center text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  رمز التفعيل (OTP)
                </p>
                <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
                  أدخل الرمز المرسل إلى {phoneNumber}
                </p>
              </div>

              <div className="flex justify-center gap-2.5" dir="ltr">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    id={`otp-${i}`}
                    name={`otp-${i}`}
                    aria-label={`OTP Digit ${i + 1}`}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type={showOtp ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    disabled={loading || timeLeft <= 0}
                    className="h-14 w-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-center text-2xl font-black text-slate-900 dark:text-white focus:border-primary focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition-colors"
                  />
                ))}
              </div>

              <div className="flex items-center justify-between px-1">
                <button type="button" onClick={() => setShowOtp(!showOtp)} className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  {showOtp ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showOtp ? "إخفاء" : "إظهار"}
                </button>

                <div className={`flex items-center gap-1.5 text-xs font-bold ${timeLeft < 30 ? "text-red-500 animate-pulse" : "text-slate-400"}`}>
                  <Timer className="h-3.5 w-3.5" />
                  <span>{formatTime(timeLeft)}</span>
                </div>
              </div>

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

              {timeLeft <= 0 ? (
                <button
                  type="button"
                  onClick={handleCredentialsSubmit}
                  className="w-full text-center text-sm font-black text-primary hover:underline transition-colors"
                >
                  إعادة إرسال الرمز
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setStep("credentials"); setOtp(Array(otpLength).fill("")); setError(""); }}
                  className="w-full text-center text-sm font-bold text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                >
                  ← تغيير البيانات
                </button>
              )}
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
