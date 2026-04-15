"use client";

import { useState, useTransition, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { Loader2, UserPlus } from "lucide-react";
import { createBeneficiary } from "@/app/actions/beneficiary";
import { DateInput } from "@/components/date-input";

export function BeneficiaryCreateModal() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isPending]);

  const resetForm = () => {
    setName("");
    setCardNumber("");
    setBirthDate("");
    setError(null);
  };

  const onSubmit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createBeneficiary({
          name,
          card_number: cardNumber,
          ...(birthDate ? { birth_date: birthDate } : {}),
        });

        if (result.error) {
          setError(result.error);
          return;
        }

        resetForm();
        setOpen(false);
      } catch {
        setError("خطأ في الاتصال. حاول مرة أخرى.");
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        className="h-10 gap-1.5 whitespace-nowrap"
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
      >
        <UserPlus className="h-4 w-4" />
        إضافة مستفيد
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white">إضافة مستفيد جديد</h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                إغلاق
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">الاسم <span className="text-red-500">*</span></label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="اسم المستفيد"
                  className="h-10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">رقم البطاقة <span className="text-red-500">*</span></label>
                <Input
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="رقم البطاقة"
                  className="h-10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">تاريخ الميلاد</label>
                <DateInput value={birthDate} onChange={setBirthDate} className="h-10" />
              </div>

              {error && <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={isPending}>
                إلغاء
              </Button>
              <Button type="button" className="flex-1" onClick={onSubmit} disabled={isPending}>
                {isPending && <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />}
                {isPending ? "جاري الإضافة..." : "إضافة المستفيد"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
