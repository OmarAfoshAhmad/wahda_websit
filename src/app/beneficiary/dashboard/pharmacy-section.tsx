"use client";

import { useState } from "react";
import { ChevronDown, LockKeyhole, Pill } from "lucide-react";
import { formatCurrency } from "@/lib/money";
import { formatDateTripoli } from "@/lib/datetime";
import type { ChronicDrugStatus, PharmacyCategoryUsage } from "@/lib/pharmacy/summary";

type Category = PharmacyCategoryUsage["category"];

export type PharmacyData = {
  usage: PharmacyCategoryUsage[];
  chronicIntervalDays: number;
  chronicDrugs: ChronicDrugStatus[];
  dispenses: Array<{
    id: string;
    category: Category;
    gross_total: number;
    company_total: number;
    patient_total: number;
    created_at: string;
    facility_name: string;
    items: Array<{ sequence: number; price: number; drug_name: string | null }>;
  }>;
};

const CATEGORY_LABELS: Record<Category, string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدوية مزمنة", CHEMICAL: "أدوية الأورام" };

/** قسم الصيدلية في بوابة المستفيد: المتبقي من السقوف، الأدوية المزمنة ومواعيدها، وسجل كل ما صُرف. */
export function PharmacySection({ data }: { data: PharmacyData }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (data.usage.length === 0 && data.dispenses.length === 0 && data.chronicDrugs.length === 0) return null;

  return (
    <section aria-labelledby="pharmacy-title" className="mt-4 space-y-3">
      <h2 id="pharmacy-title" className="flex items-center gap-2 text-base font-black text-slate-800 dark:text-white">
        <Pill className="h-4 w-4 text-primary dark:text-blue-400" aria-hidden /> الصيدلية
      </h2>

      {data.usage.length > 0 && (
        <div className="grid gap-2">
          {data.usage.map((usage) => {
            const ceiling = usage.categoryCeiling ?? usage.overallCeiling;
            const used = ceiling === null ? 0 : Math.min(100, Math.round(((ceiling - (usage.remaining ?? ceiling)) / ceiling) * 100));
            return (
              <div key={usage.category} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-black text-slate-800 dark:text-slate-200">{CATEGORY_LABELS[usage.category]}</p>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">التغطية {usage.coveragePercent}%</p>
                </div>
                {usage.remaining === null ? (
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">بلا سقف محدد</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">المتبقي <strong className="tabular-nums text-slate-900 dark:text-white">{formatCurrency(usage.remaining)} د.ل</strong>{ceiling !== null && <> من {formatCurrency(ceiling)}</>}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100} aria-label={`المستهلك من سقف ${CATEGORY_LABELS[usage.category]}`}>
                      <div className="h-full rounded-full bg-primary dark:bg-blue-400" style={{ width: `${used}%` }} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data.chronicDrugs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <h3 className="text-sm font-black text-slate-800 dark:text-white">أدويتي المزمنة</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">يُصرف كل دواء مرة كل {data.chronicIntervalDays} يومًا من أي صيدلية.</p>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.chronicDrugs.map((drug) => (
              <li key={drug.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200" dir="auto">{drug.drug_name}</p>
                  {drug.notes && <p className="text-xs text-slate-500 dark:text-slate-400" dir="auto">{drug.notes}</p>}
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {drug.last_dispensed_at ? `آخر صرف ${formatDateTripoli(drug.last_dispensed_at, "en-GB")} · ${drug.last_facility_name}` : "لم يُصرف بعد"}
                  </p>
                </div>
                {drug.eligible ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">متاح الآن</span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                    <LockKeyhole className="h-3 w-3" aria-hidden /> من {formatDateTripoli(drug.next_eligible_at!, "en-GB")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-black text-slate-800 dark:text-white">ما صُرف لي</h3>
        </div>
        {data.dispenses.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">لم يُصرف لك شيء من الصيدليات بعد</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.dispenses.map((dispense) => {
              const open = openId === dispense.id;
              return (
                <li key={dispense.id}>
                  <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : dispense.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{CATEGORY_LABELS[dispense.category]} · {dispense.items.length} بند</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{dispense.facility_name} · {formatDateTripoli(dispense.created_at, "en-GB")}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-sm font-black tabular-nums text-slate-800 dark:text-slate-200">{formatCurrency(dispense.gross_total)} د.ل</span>
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-1 px-4 pb-3 text-sm">
                      {dispense.items.map((item) => (
                        <p key={item.sequence} className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
                          <span className="truncate" dir="auto">{item.drug_name ?? `البند ${item.sequence}`}</span>
                          <span className="tabular-nums">{formatCurrency(item.price)} د.ل</span>
                        </p>
                      ))}
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 text-center dark:bg-slate-800">
                        <p className="text-xs text-slate-500 dark:text-slate-400">على الشركة<br /><strong className="text-sm tabular-nums text-slate-800 dark:text-slate-200">{formatCurrency(dispense.company_total)} د.ل</strong></p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">دفعتَ<br /><strong className="text-sm tabular-nums text-slate-800 dark:text-slate-200">{formatCurrency(dispense.patient_total)} د.ل</strong></p>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
