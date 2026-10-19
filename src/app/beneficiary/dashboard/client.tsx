"use client";

import Link from "next/link";
import { CalendarDays, Pill, LogOut, MessageCircle } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { formatCurrency } from "@/lib/money";
import { formatDateTripoli } from "@/lib/datetime";
import { PharmacySection, type PharmacyData } from "./pharmacy-section";

type DashboardData = {
  id: string;
  name: string;
  card_number: string;
  birth_date: string | null;
  total_balance: number;
  remaining_balance: number;
  status: string;
  pharmacy: PharmacyData;
};

const CATEGORY_LABELS: Record<PharmacyData["usage"][number]["category"], string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدوية مزمنة", CHEMICAL: "أدوية الأورام" };

export function BeneficiaryDashboardClient({ initialData }: { initialData: DashboardData }) {
  const data = initialData;
  // البوابة للصيدلية فقط: مجاميع الصيدلية، لا قيم السقف العام ولا حركات الخدمات الأخرى.
  const pharmacyUsed = data.pharmacy.usage[0]?.consumedOverall ?? 0;
  const pharmacyCeiling = data.pharmacy.usage[0]?.overallCeiling ?? null;

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
          <div className="h-11 w-11 [&_button]:h-full [&_button]:w-full [&_button]:rounded-xl [&_button]:border-slate-200 [&_button]:dark:border-slate-700 [&_button]:bg-white [&_button]:dark:bg-slate-800 [&_button]:text-slate-700 [&_button]:dark:text-slate-300">
            <ThemeSwitcher />
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

    </div>
  );
}
