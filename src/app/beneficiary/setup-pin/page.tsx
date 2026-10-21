"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

const EMPTY = ["", "", "", "", "", ""];

/** إنشاء كلمة مرور الأسرة (6 أرقام) بعد الدخول برمز التحقق: أول مرة أو عند نسيانها. */
export default function SetupPasswordPage() {
  const router = useRouter();
  const [first, setFirst] = useState(EMPTY);
  const [confirm, setConfirm] = useState(EMPTY);
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const firstRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);

  const restart = (message: string) => {
    setError(message);
    setFirst(EMPTY);
    setConfirm(EMPTY);
    setStep("enter");
    setTimeout(() => firstRefs.current[0]?.focus(), 50);
  };

  const save = async (password: string, confirmation: string) => {
    if (password !== confirmation) return restart("كلمتا المرور غير متطابقتين. حاول مرة أخرى");
    setLoading(true);
    try {
      const res = await fetch("/api/beneficiary/setup-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm_password: confirmation }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "ok") {
        try { localStorage.setItem("beneficiary-has-password", "1"); } catch { /* غير متاح */ }
        router.push("/beneficiary/choose");
        return;
      }
      restart(data.error ?? "تعذر حفظ كلمة المرور");
    } finally {
      setLoading(false);
    }
  };

  const change = (index: number, value: string, isConfirm: boolean) => {
    if (!/^\d?$/.test(value)) return;
    const digits = [...(isConfirm ? confirm : first)];
    digits[index] = value;
    (isConfirm ? setConfirm : setFirst)(digits);
    setError("");
    const refs = isConfirm ? confirmRefs : firstRefs;
    if (value && index < 5) refs.current[index + 1]?.focus();
    if (value && index === 5) {
      if (!isConfirm) {
        setStep("confirm");
        setTimeout(() => confirmRefs.current[0]?.focus(), 50);
      } else {
        void save(first.join(""), digits.join(""));
      }
    }
  };

  const boxes = (isConfirm: boolean) => {
    const digits = isConfirm ? confirm : first;
    const refs = isConfirm ? confirmRefs : firstRefs;
    return (
      <div className="flex justify-center gap-2.5" dir="ltr">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => { refs.current[index] = el; }}
            aria-label={`${isConfirm ? "تأكيد " : ""}الرقم ${index + 1}`}
            type={show ? "text" : "password"}
            inputMode="numeric"
            maxLength={1}
            value={digit}
            autoFocus={!isConfirm && index === 0}
            disabled={loading}
            onChange={(event) => change(index, event.target.value, isConfirm)}
            onKeyDown={(event) => { if (event.key === "Backspace" && !digit && index > 0) refs.current[index - 1]?.focus(); }}
            className="h-14 w-11 rounded-xl border border-slate-300 bg-slate-50 text-center text-2xl font-black text-slate-900 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h1 className="mt-2 text-xl font-black text-slate-900 dark:text-white">كلمة مرور الأسرة</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            6 أرقام يدخل بها أي فرد من أسرتك مع الرقم الوظيفي، بدون انتظار رسالة.
          </p>
        </div>

        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-center text-base font-bold text-slate-700 dark:text-slate-200">
            {step === "enter" ? "اكتب كلمة المرور الجديدة" : "اكتبها مرة أخرى للتأكيد"}
          </p>
          {boxes(step === "confirm")}
          <button type="button" onClick={() => setShow(!show)} className="mx-auto flex items-center gap-1.5 text-sm text-slate-500">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {show ? "إخفاء الأرقام" : "إظهار الأرقام"}
          </button>
          {loading && <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
          {error && (
            <p role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>
        <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">شاركها مع أفراد أسرتك فقط. إن نسيتها يصل رمز التحقق إلى هاتف صاحب البطاقة.</p>
      </div>
    </div>
  );
}
