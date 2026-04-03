"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addTransactionFromForm } from "@/app/actions/transaction";
import { Button, Card, Input } from "@/components/ui";

type FacilityOption = {
  id: string;
  name: string;
};

export function AddTransactionForm({
  facilities,
  defaultFacilityId,
  canChooseFacility,
}: {
  facilities: FacilityOption[];
  defaultFacilityId: string;
  canChooseFacility: boolean;
}) {
  const [state, action, pending] = useActionState(addTransactionFromForm, null);
  const router = useRouter();
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state, router]);

  return (
    <Card className="max-w-2xl p-5 sm:p-6">
      <form action={action} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">المرفق</label>
          <select
            name="facility_id"
            defaultValue={defaultFacilityId}
            disabled={!canChooseFacility}
            className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
          {!canChooseFacility && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">اختيار المرفق متاح للمشرف فقط.</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">رقم البطاقة</label>
          <Input name="card_number" required placeholder="مثال: WAB20251234" dir="ltr" autoComplete="off" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">قيمة الخصم</label>
            <Input name="amount" type="number" required min="0.01" step="0.01" placeholder="0.00" dir="ltr" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">نوع الحركة</label>
            <select
              name="type"
              required
              defaultValue="SUPPLIES"
              className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <option value="SUPPLIES">كشف عام</option>
              <option value="MEDICINE">أدوية صرف عام</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">تاريخ ووقت الحركة</label>
          <Input
            name="transaction_date"
            type="datetime-local"
            defaultValue={nowLocal}
            max={nowLocal}
            required
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">يتم حفظ الحركة بهذا التاريخ للحفاظ على التسلسل الزمني الصحيح.</p>
        </div>

        {state?.error && (
          <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-bold text-red-700 dark:text-red-400">
            {state.error}
          </div>
        )}

        {state?.success && (
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-400">
            {state.success}
            {typeof state.newBalance === "number" ? ` - الرصيد المتبقي: ${state.newBalance.toLocaleString("ar-LY")} د.ل` : ""}
          </div>
        )}

        <Button type="submit" className="h-10 w-full sm:w-auto" disabled={pending}>
          {pending ? "جارٍ إضافة الحركة اليدوية..." : "إضافة حركة يدوية"}
        </Button>
      </form>
    </Card>
  );
}
