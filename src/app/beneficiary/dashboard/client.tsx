"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CalendarDays, Pill, LogOut, CheckCheck, MessageCircle, Volume2, VolumeX } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { formatCurrency } from "@/lib/money";
import { formatDateTripoli, formatDateTimeTripoli } from "@/lib/datetime";
import { PharmacySection, type PharmacyData } from "./pharmacy-section";

type Notification = {
  id: string;
  title: string;
  message: string;
  amount: number | null;
  is_read: boolean;
  created_at: string;
};

type Tx = {
  id: string;
  amount: number;
  type: string;
  created_at: string;
  facility_name: string;
};

type DashboardData = {
  id: string;
  name: string;
  card_number: string;
  birth_date: string | null;
  total_balance: number;
  remaining_balance: number;
  status: string;
  transactions: Tx[];
  notifications: Notification[];
  pharmacy: PharmacyData;
};

const CATEGORY_LABELS: Record<PharmacyData["usage"][number]["category"], string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدوية مزمنة", CHEMICAL: "أدوية الأورام" };

const TYPE_LABELS: Record<string, string> = {
  MEDICINE: "دواء",
  SUPPLIES: "مستلزمات",
  CANCELLATION: "إلغاء",
  IMPORT: "رصيد مستخدم",
};

export function BeneficiaryDashboardClient({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [notifOpen, setNotifOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    // قراءة التفضيل من localStorage — الافتراضي true
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("notif-sound");
    return stored === null ? true : stored === "true";
  });

  const unreadCount = useMemo(() => data.notifications.filter((n) => !n.is_read).length, [data.notifications]);
  // مجاميع الصيدلية فقط؛ قيم السقف العام (الأسنان وغيرها) لا تُعرض هنا.
  const pharmacyUsed = data.pharmacy.usage[0]?.consumedOverall ?? 0;
  const pharmacyCeiling = data.pharmacy.usage[0]?.overallCeiling ?? null;

  function playNotificationTone() {
    try {
      const win = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextCtor = globalThis.AudioContext ?? win.webkitAudioContext;
      if (!AudioContextCtor) return;
      const audioContext = new AudioContextCtor();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(988, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.07, audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.22);
    } catch {
      // تجاهل الأجهزة التي لا تدعم الصوت البرمجي
    }
  }

  useEffect(() => {
    const es = new EventSource("/api/beneficiary/notifications/stream");
    es.onmessage = (event) => {
      const payload = JSON.parse(event.data) as {
        id: string;
        title: string;
        message: string;
        amount?: number;
        remaining_balance?: number;
        created_at: string;
        transaction?: {
          id: string;
          amount: number;
          type: string;
          created_at: string;
          facility_name: string;
        };
      };

      setData((prev) => ({
        ...prev,
        remaining_balance: payload.remaining_balance ?? prev.remaining_balance,
        transactions: payload.transaction
          ? [payload.transaction, ...prev.transactions.filter((tx) => tx.id !== payload.transaction!.id)].slice(0, 30)
          : prev.transactions,
        notifications: [
          {
            id: payload.id,
            title: payload.title,
            message: payload.message,
            amount: payload.amount ?? null,
            is_read: false,
            created_at: payload.created_at,
          },
          ...prev.notifications,
        ].slice(0, 20),
      }));

      setToast(payload.message);
      window.setTimeout(() => setToast(null), 4500);

      if (soundEnabled) {
        playNotificationTone();
      }
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([80, 40, 80]);
      }
    };

    return () => es.close();
  }, [soundEnabled]);

  async function markAllRead() {
    if (markingRead) return;
    setMarkingRead(true);
    try {
      await fetch("/api/beneficiary/notifications", { method: "PATCH" });
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => ({ ...n, is_read: true })),
      }));
    } finally {
      setMarkingRead(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/beneficiary/logout", { method: "POST" });
    window.location.href = "/beneficiary/login";
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-4 pb-8 pt-5">
      {/* Top Bar */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">بوابة المستفيد</p>
          <h1 className="text-lg font-black text-slate-900 dark:text-white">مرحباً {data.name.split(" ")[0]}</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundEnabled((v) => {
              const next = !v;
              localStorage.setItem("notif-sound", String(next));
              return next;
            })}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${soundEnabled ? "border-primary/30 bg-primary-light dark:border-primary/30 dark:bg-primary/20 text-primary dark:text-teal-300" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"}`}
            aria-label={soundEnabled ? "إيقاف صوت الإشعارات" : "تشغيل صوت الإشعارات"}
            title={soundEnabled ? "الصوت مفعل" : "الصوت متوقف"}
          >
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>

          <div className="h-11 w-11 [&_button]:h-full [&_button]:w-full [&_button]:rounded-xl [&_button]:border-slate-200 [&_button]:dark:border-slate-700 [&_button]:bg-white [&_button]:dark:bg-slate-800 [&_button]:text-slate-700 [&_button]:dark:text-slate-300">
            <ThemeSwitcher />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((v) => !v)}
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              aria-label="الإشعارات"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -left-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute left-0 z-30 mt-2 w-80 max-w-[85vw] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-black text-slate-800 dark:text-white">الإشعارات</p>
                  <button
                    type="button"
                    onClick={markAllRead}
                    disabled={markingRead || unreadCount === 0}
                    className="inline-flex items-center gap-1 text-xs font-bold text-primary dark:text-teal-300 disabled:opacity-50"
                  >
                    <CheckCheck className="h-4 w-4" />
                    تحديد الكل كمقروء
                  </button>
                </div>

                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {data.notifications.length === 0 ? (
                    <p className="py-5 text-center text-xs text-slate-400 dark:text-slate-500">لا توجد إشعارات</p>
                  ) : (
                    data.notifications.map((n) => (
                      <div key={n.id} className={`rounded-xl border p-2.5 ${n.is_read ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300" : "border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 text-slate-800 dark:text-slate-200"}`}>
                        <p className="text-xs font-black">{n.title}</p>
                        <p className="mt-0.5 text-xs opacity-90">{n.message}</p>
                        <p className="mt-1 text-[11px] opacity-70">{formatDateTimeTripoli(n.created_at, "en-GB")}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            aria-label="تسجيل الخروج"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Pharmacy Card: مجاميع الصيدلية فقط */}
      <div className="rounded-2xl bg-linear-to-br from-teal-600 to-teal-800 p-5 text-white shadow-md">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-bold tracking-wider text-teal-50"><Pill className="h-4 w-4" /> استهلاك الصيدلية</p>
          <p className="font-mono text-xs font-bold text-teal-50" dir="ltr">{data.card_number}</p>
        </div>
        <p className="text-4xl font-black leading-none">{formatCurrency(pharmacyUsed)}</p>
        <p className="mt-1 text-sm text-teal-50">دينار ليبي</p>

        {pharmacyCeiling !== null && (
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-white/10 p-2 text-center">
            <div className="rounded-lg bg-white/10 py-2">
              <p className="text-[11px] font-bold text-teal-50">المتبقي</p>
              <p className="text-base font-black">{formatCurrency(Math.max(0, pharmacyCeiling - pharmacyUsed))}</p>
            </div>
            <div className="rounded-lg bg-white/10 py-2">
              <p className="text-[11px] font-bold text-teal-50">سقف الصيدلية</p>
              <p className="text-base font-black">{formatCurrency(pharmacyCeiling)}</p>
            </div>
          </div>
        )}

        {data.pharmacy.usage.length > 0 && (
          <ul className="mt-2 divide-y divide-white/10 rounded-xl bg-white/10 px-3">
            {data.pharmacy.usage.map((usage) => (
              <li key={usage.category} className="flex items-center justify-between gap-2 py-2.5">
                <span className="text-sm font-bold">{CATEGORY_LABELS[usage.category]} <span className="text-xs font-normal text-teal-50">· تغطية {usage.coveragePercent}%</span></span>
                <span className="text-sm font-black tabular-nums">{usage.remaining === null ? "بلا سقف" : `متبقي ${formatCurrency(usage.remaining)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* User meta */}
      {data.birth_date && <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        {data.birth_date && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <CalendarDays className="h-4 w-4" />
            تاريخ الميلاد: {formatDateTripoli(data.birth_date, "en-GB")}
          </p>
        )}
      </div>}

      <Link href="/beneficiary/pharmacy" className="mt-4 flex min-h-20 items-center justify-between gap-3 rounded-2xl bg-primary px-5 py-4 text-white shadow-md">
        <span className="text-2xl font-black">اطلب دواء</span>
        <MessageCircle className="h-8 w-8 shrink-0" aria-hidden />
      </Link>

      <PharmacySection data={data.pharmacy} />

      {/* Transactions */}
      <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-100 dark:border-slate-800 px-4 py-3">
          <h2 className="text-sm font-black text-slate-800 dark:text-white">آخر الحركات</h2>
        </div>

        {data.transactions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">لا توجد حركات حالياً</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.transactions.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{TYPE_LABELS[tx.type] ?? tx.type}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{tx.facility_name}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{formatDateTripoli(tx.created_at, "en-GB")}</p>
                </div>
                <span className="text-base font-black text-red-600 dark:text-red-400">-{formatCurrency(tx.amount)} د.ل</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed inset-x-4 bottom-4 z-40 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 p-3 shadow-lg">
          <p className="text-sm font-black text-emerald-700 dark:text-emerald-400">تم خصم جديد</p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{toast}</p>
        </div>
      )}
    </div>
  );
}
