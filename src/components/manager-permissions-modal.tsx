"use client";

import { useState, useTransition } from "react";
import { Settings2, X } from "lucide-react";
import { updateManagerPermissions } from "@/app/actions/manager";
import { Button } from "@/components/ui";
import type { ManagerPermissions } from "@/lib/auth";

const PERMISSION_LABELS: Record<keyof ManagerPermissions, string> = {
  import_beneficiaries: "استيراد مستفيدين",
  add_beneficiary: "إضافة مستفيد جديد",
  edit_beneficiary: "تعديل بيانات المستفيدين",
  delete_beneficiary: "حذف المستفيدين (نهائياً أو مؤقتاً)",
  add_facility: "إضافة مرفق جديد",
  edit_facility: "تعديل بيانات المرافق",
  delete_facility: "حذف المرافق من النظام",
  cancel_transactions: "إلغاء الحركات المالية",
  correct_transactions: "إعادة خصم الرصيد / تصحيح حركات",
  manage_recycle_bin: "إدارة سلة المحذوفات",
  export_data: "تصدير التقارير والبيانات (Excel/PDF)",
  print_cards: "طباعة الكروت والبطاقات",
  view_audit_log: "عرض سجل المراقبة (Audit Log)",
  view_reports: "عرض التقارير الإحصائية (المفصلة)",
  view_facilities: "عرض المرافق الصحية",
  view_beneficiaries: "عرض قائمة المستفيدين",
  deduct_balance: "إمكانية خصم الرصيد (نقطة بيع)",
  delete_transaction: "حذف الحركات المالية (نهائياً أو مؤقتاً)",
  cash_claim: "إمكانية الكاش العائلي",
};

interface Props {
  managerId: string;
  managerName: string;
  permissions: ManagerPermissions;
}

export function ManagerPermissionsModal({ managerId, managerName, permissions }: Props) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ManagerPermissions>({ ...permissions });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggle = (key: keyof ManagerPermissions) => {
    setCurrent((prev) => ({ ...prev, [key]: !prev[key] }));
    setSuccess(false);
    setError(null);
  };

  const handleSave = () => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await updateManagerPermissions(managerId, current);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => setOpen(false), 700);
      }
    });
  };

  return (
    <>
      <button
        onClick={() => {
          setCurrent({ ...permissions });
          setError(null);
          setSuccess(false);
          setOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-primary"
        title="ضبط الصلاحيات"
      >
        <Settings2 className="h-3.5 w-3.5" />
        مدير الصلاحيات
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] shadow-2xl overflow-hidden">
            {/* رأس الـ modal */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-5 bg-slate-50/50 dark:bg-slate-800/30">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">صلاحيات المدير</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">{managerName}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-600 transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* قائمة الصلاحيات — مع تمرير في حال كثرت */}
            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-1.5 custom-scrollbar">
              {(Object.keys(PERMISSION_LABELS) as Array<keyof ManagerPermissions>).map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-transparent dark:border-slate-800/40 px-4 py-3 bg-slate-50/50 dark:bg-slate-800/20 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 transition-all group"
                  onClick={() => toggle(key)}
                >
                  <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white cursor-pointer select-none">
                    {PERMISSION_LABELS[key]}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={current[key]}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-all duration-300 focus:outline-none ${current[key]
                      ? "bg-blue-600 dark:bg-blue-500"
                      : "bg-slate-300 dark:bg-slate-700"
                      }`}
                  >
                    <span
                      className={`absolute h-4.5 w-4.5 rounded-full bg-white shadow-md transition-transform duration-300 right-1 ${current[key] ? "-translate-x-5.5" : "translate-x-0"
                        }`}
                    />
                  </button>
                </div>
              ))}
            </div>

            {/* رسائل */}
            {error && (
              <div className="mx-5 mb-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
            {success && (
              <div className="mx-5 mb-3 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                تم حفظ الصلاحيات ✓
              </div>
            )}

            {/* زرار الحفظ */}
            <div className="flex gap-2 border-t border-slate-100 dark:border-slate-800 px-5 py-4">
              <Button onClick={handleSave} disabled={isPending} className="flex-1">
                {isPending ? "جارٍ الحفظ..." : "حفظ الصلاحيات"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                className="flex-1"
              >
                إلغاء
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
