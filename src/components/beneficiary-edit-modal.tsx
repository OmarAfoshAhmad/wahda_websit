"use client";

import { useState, useTransition, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { Loader2, Pencil } from "lucide-react";
import { updateBeneficiary } from "@/app/actions/beneficiary";
import { DateInput } from "@/components/date-input";

interface BeneficiaryEditModalProps {
  beneficiary: {
    id: string;
    name: string;
    card_number: string;
    birth_date: string;
    status: "ACTIVE" | "FINISHED" | "SUSPENDED";
    total_balance?: number;
    remaining_balance?: number;
  };
  iconOnly?: boolean;
}

export function BeneficiaryEditModal({ beneficiary, iconOnly = false }: BeneficiaryEditModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(beneficiary.name);
  const [cardNumber, setCardNumber] = useState(beneficiary.card_number);
  const [birthDate, setBirthDate] = useState(beneficiary.birth_date);
  const [status, setStatus] = useState<"ACTIVE" | "FINISHED" | "SUSPENDED">(beneficiary.status);
  const [remainingBalance, setRemainingBalance] = useState(String(beneficiary.remaining_balance ?? 0));
  const [error, setError] = useState<string | null>(null);

  // إغلاق بمفتاح Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isPending]);

  const onSave = () => {
    setError(null);
    const parsedRemaining = Number(remainingBalance);

    if (!Number.isFinite(parsedRemaining)) {
      setError("يرجى إدخال رقم صحيح في حقل الرصيد المتبقي");
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateBeneficiary({
          id: beneficiary.id,
          name,
          card_number: cardNumber,
          birth_date: birthDate,
          status,
          remaining_balance: parsedRemaining,
        });

        if (result.error) {
          setError(result.error);
          return;
        }

        setOpen(false);
        const params = new URLSearchParams(searchParams.toString());
        params.set("focus_beneficiary", beneficiary.id);
        router.replace(`${pathname}?${params.toString()}`);
        router.refresh();
      } catch {
        setError("خطأ في الاتصال. حاول مرة أخرى.");
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={iconOnly ? "h-8 w-8 p-0" : "h-8 px-3 text-xs"}
        onClick={() => setOpen(true)}
        title="تعديل المستفيد"
        aria-label="تعديل المستفيد"
      >
        {iconOnly ? <Pencil className="h-4 w-4" /> : "تعديل"}
      </Button>

      {open && (
        // FIX CODE-04: إضافة dark mode لجميع العناصر
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white">تعديل بيانات المستفيد</h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                إغلاق
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 space-y-0 text-right">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">الاسم</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10 text-right" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">رقم البطاقة</label>
                <Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className="h-10 text-right" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">تاريخ الميلاد</label>
                <DateInput value={birthDate} onChange={setBirthDate} className="h-10 text-right" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">الرصيد المتاح (المتبقي)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={remainingBalance}
                  onChange={(e) => setRemainingBalance(e.target.value)}
                  className="h-10 text-right"
                />
              </div>

              <div className="col-span-2">
                <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">الحالة</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "ACTIVE" | "FINISHED" | "SUSPENDED")}
                  className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 text-right"
                >
                  <option value="ACTIVE">نشط</option>
                  <option value="FINISHED">مكتمل</option>
                  <option value="SUSPENDED">موقوف</option>
                </select>
              </div>

              {error && <p className="col-span-2 text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={isPending}>
                إلغاء
              </Button>
              <Button type="button" className="flex-1" onClick={onSave} disabled={isPending}>
                {isPending && <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />}
                {isPending ? "جاري الحفظ..." : "حفظ التعديلات"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
