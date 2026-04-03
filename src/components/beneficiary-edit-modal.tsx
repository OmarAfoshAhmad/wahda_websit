"use client";

import { useState, useTransition, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { Loader2 } from "lucide-react";
import { updateBeneficiary } from "@/app/actions/beneficiary";

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
}

export function BeneficiaryEditModal({ beneficiary }: BeneficiaryEditModalProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(beneficiary.name);
  const [cardNumber, setCardNumber] = useState(beneficiary.card_number);
  const [birthDate, setBirthDate] = useState(beneficiary.birth_date);
  const [status, setStatus] = useState<"ACTIVE" | "FINISHED" | "SUSPENDED">(beneficiary.status);
  const [totalBalance, setTotalBalance] = useState(beneficiary.total_balance ?? 600);
  const [remainingBalance, setRemainingBalance] = useState(beneficiary.remaining_balance ?? 600);
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
    startTransition(async () => {
      try {
        const result = await updateBeneficiary({
          id: beneficiary.id,
          name,
          card_number: cardNumber,
          birth_date: birthDate,
          status,
          total_balance: Number(totalBalance),
          remaining_balance: Number(remainingBalance),
        });

        if (result.error) {
          setError(result.error);
          return;
        }

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
        variant="outline"
        className="h-8 px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        تعديل
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">تعديل بيانات المستفيد</h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                إغلاق
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-black text-slate-500">الاسم</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500">رقم البطاقة</label>
                <Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className="h-10" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500">تاريخ الميلاد</label>
                <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="h-10" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500">الرصيد الكلي</label>
                <Input type="number" value={totalBalance} onChange={(e) => setTotalBalance(Number(e.target.value))} className="h-10 font-mono" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-black text-slate-500">الرصيد المتبقي</label>
                <Input type="number" value={remainingBalance} onChange={(e) => setRemainingBalance(Number(e.target.value))} className="h-10 font-mono bg-slate-50" />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-black text-slate-500">الحالة</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "ACTIVE" | "FINISHED" | "SUSPENDED")}
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <option value="ACTIVE">نشط</option>
                  <option value="FINISHED">مكتمل</option>
                  <option value="SUSPENDED">موقوف</option>
                </select>
              </div>

              {error && <p className="md:col-span-2 text-sm font-bold text-red-600">{error}</p>}
              <p className="md:col-span-2 text-[10px] text-slate-500 leading-tight">
                * ملاحظة: سيتم إعادة حساب الرصيد المتبقي تلقائياً بمجرد دمج البطاقات أو إجراء معاملة جديدة بناءً على الحركات المالية المسجلة.
              </p>
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
