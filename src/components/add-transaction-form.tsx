"use client";

import { useActionState, useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { addTransactionFromForm } from "@/app/actions/transaction";
import { searchBeneficiaries } from "@/app/actions/beneficiary";
import { Button, Card, Input } from "@/components/ui";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { formatCurrency } from "@/lib/money";
import { Loader2, X } from "lucide-react";

type FacilityOption = {
  id: string;
  name: string;
};

type BeneficiarySuggestion = {
  id: string;
  name: string;
  card_number: string;
  remaining_balance: number;
  status: string;
};

// ── Searchable Facility Select ────────────────────────────────────────────────

function FacilitySelect({
  facilities,
  defaultFacilityId,
  disabled,
}: {
  facilities: FacilityOption[];
  defaultFacilityId: string;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(defaultFacilityId);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = search.trim().length === 0
    ? facilities
    : facilities.filter((f) => f.name.toLowerCase().includes(search.trim().toLowerCase()));

  const selectedName = facilities.find((f) => f.id === selectedId)?.name ?? "";

  // إغلاق القائمة عند النقر خارجها
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (disabled) {
    return (
      <>
        <input type="hidden" name="facility_id" value={selectedId} />
        <div className="flex h-10 w-full items-center rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed opacity-70">
          {selectedName}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">اختيار المرفق متاح للمشرف فقط.</p>
      </>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name="facility_id" value={selectedId} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        <span className="truncate">{selectedName || "اختر مرفقاً..."}</span>
        <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في المرافق..."
              className="h-8 text-xs"
              autoFocus
            />
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">لا توجد نتائج</li>
            ) : (
              filtered.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${f.id === selectedId ? "font-bold text-primary" : "text-slate-900 dark:text-slate-100"}`}
                    onClick={() => { setSelectedId(f.id); setOpen(false); setSearch(""); }}
                  >
                    {f.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Beneficiary Search Input ──────────────────────────────────────────────────

function BeneficiarySearchInput({
  onSelectionChange,
}: {
  onSelectionChange: (beneficiary: BeneficiarySuggestion | null) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [suggestions, setSuggestions] = useState<BeneficiarySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setSuggestions([]); setShowDropdown(false); return; }
    setLoading(true);
    const result = await searchBeneficiaries(q);
    setSuggestions(result.items ?? []);
    setShowDropdown(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(inputValue), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputValue, search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (item: BeneficiarySuggestion) => {
    setInputValue(`${item.name} — ${item.card_number}`);
    setCardNumber(item.card_number);
    onSelectionChange(item);
    setShowDropdown(false);
    setSuggestions([]);
  };

  const handleClear = () => {
    setInputValue("");
    setCardNumber("");
    onSelectionChange(null);
    setSuggestions([]);
    setShowDropdown(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* الحقل المخفي الذي يُرسل قيمة رقم البطاقة للـ action */}
      <input type="hidden" name="card_number" value={cardNumber} />

      <div className="relative">
        <Input
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            // إذا حذف المستخدم يدوياً → أعد التحديد
            setCardNumber(e.target.value);
            onSelectionChange(null);
            setShowDropdown(true);
          }}
          placeholder="ابحث بالاسم أو رقم البطاقة..."
          dir="auto"
          autoComplete="off"
          className="pl-10"
          required
        />
        {!loading && inputValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {loading && (
          <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
        )}
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
          {suggestions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-3 py-2 text-right hover:bg-slate-50 dark:hover:bg-slate-800 last:border-b-0"
              onClick={() => handleSelect(item)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{item.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">{item.card_number}</p>
              </div>
              <span className="shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400">
                {formatCurrency(item.remaining_balance)} د.ل
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Form ─────────────────────────────────────────────────────────────────

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
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<BeneficiarySuggestion | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [todayLocal] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  );

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state, router]);

  const amountValue = Number(amountInput);
  const hasValidAmount = Number.isFinite(amountValue) && amountValue > 0;
  const remainingBefore = selectedBeneficiary ? Number(selectedBeneficiary.remaining_balance) : null;
  const remainingAfter =
    remainingBefore !== null && hasValidAmount
      ? Math.round((remainingBefore - amountValue + Number.EPSILON) * 100) / 100
      : null;
  const isBalanceEnded =
    selectedBeneficiary !== null
      && (selectedBeneficiary.status === "FINISHED" || selectedBeneficiary.remaining_balance <= 0);
  const amountExceedsBalance =
    remainingBefore !== null && hasValidAmount && amountValue > remainingBefore;

  const handleOpenConfirm = () => {
    setLocalError(null);

    if (!selectedBeneficiary) {
      setLocalError("يرجى اختيار مستفيد من نتائج البحث أولاً");
      return;
    }
    if (isBalanceEnded) {
      setLocalError("لا يمكن إضافة حركة: رصيد المستفيد منتهي أو حالته مكتمل");
      return;
    }
    if (!hasValidAmount) {
      setLocalError("يرجى إدخال قيمة خصم صحيحة أكبر من صفر");
      return;
    }
    if (amountExceedsBalance) {
      setLocalError("قيمة الخصم أكبر من الرصيد المتاح");
      return;
    }

    setConfirmOpen(true);
  };

  const handleConfirmSubmit = () => {
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  };

  return (
    <Card className="max-w-2xl p-5 sm:p-6">
      <form ref={formRef} action={action} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">المرفق</label>
          <FacilitySelect
            facilities={facilities}
            defaultFacilityId={defaultFacilityId}
            disabled={!canChooseFacility}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">رقم البطاقة</label>
          <BeneficiarySearchInput onSelectionChange={setSelectedBeneficiary} />
          {selectedBeneficiary && (
            <div className="mt-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-sm">
              <p className="font-bold text-slate-900 dark:text-slate-100">{selectedBeneficiary.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">{selectedBeneficiary.card_number}</p>
              <p className="mt-1 text-xs font-bold text-slate-700 dark:text-slate-300">
                الرصيد الحالي: {formatCurrency(Number(selectedBeneficiary.remaining_balance))} د.ل
              </p>
              {isBalanceEnded && (
                <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">
                  هذا الحساب رصيده منتهي، لا يمكن إضافة حركة جديدة.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">قيمة الخصم</label>
            <Input
              name="amount"
              type="number"
              required
              min="0.01"
              step="0.01"
              placeholder="0.00"
              dir="ltr"
              value={amountInput}
              onChange={(e) => {
                setAmountInput(e.target.value);
                setLocalError(null);
              }}
            />
            {amountExceedsBalance && (
              <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">القيمة أكبر من الرصيد المتاح.</p>
            )}
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
          <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">تاريخ الحركة</label>
          <input
            name="transaction_date"
            type="date"
            defaultValue={todayLocal}
            max={todayLocal}
            required
            className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">يتم حفظ الحركة بهذا التاريخ للحفاظ على التسلسل الزمني الصحيح.</p>
        </div>

        {(localError || state?.error) && (
          <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-bold text-red-700 dark:text-red-400">
            {localError ?? state?.error}
          </div>
        )}

        {state?.success && (
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-400">
            {state.success}
            {typeof state.newBalance === "number" ? ` - الرصيد المتبقي: ${formatCurrency(state.newBalance)} د.ل` : ""}
          </div>
        )}

        <Button
          type="button"
          className="h-10 w-full sm:w-auto"
          disabled={
            pending
            || !selectedBeneficiary
            || isBalanceEnded
            || !hasValidAmount
            || amountExceedsBalance
          }
          onClick={handleOpenConfirm}
        >
          {pending ? "جارٍ إضافة الحركة اليدوية..." : "إضافة حركة يدوية"}
        </Button>
      </form>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmSubmit}
        title="تأكيد إضافة الحركة"
        description={`قبل الخصم: ${formatCurrency(remainingBefore ?? 0)} د.ل | المخصوم: ${formatCurrency(hasValidAmount ? amountValue : 0)} د.ل | بعد الخصم: ${formatCurrency(remainingAfter ?? 0)} د.ل`}
        confirmLabel="نعم، تأكيد الإضافة"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={pending}
      />
    </Card>
  );
}
