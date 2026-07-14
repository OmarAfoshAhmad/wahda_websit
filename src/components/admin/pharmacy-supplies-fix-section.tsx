"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { Loader2, ShieldCheck, CheckSquare, Square, Search, ChevronDown, X } from "lucide-react";
import { convertPharmacySuppliesToMedicineAction } from "@/app/actions/balance-health-actions";
import { ConfirmationModal } from "@/components/ui";
import { useRouter } from "next/navigation";
import { formatDateTripoli } from "@/lib/datetime";

export type PharmacySupplyAnomalyRow = {
  id: string;
  beneficiary_name: string;
  card_number: string;
  facility_name: string;
  amount: number;
  created_at: Date;
};

export function PharmacySuppliesFixSection({ rows }: { rows: PharmacySupplyAnomalyRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPharmacy, setSelectedPharmacy] = useState<string>("");
  const [pharmacySearchTerm, setPharmacySearchTerm] = useState("");
  const [isPharmacyDropdownOpen, setIsPharmacyDropdownOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsPharmacyDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const uniquePharmacies = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.facility_name))).sort();
  }, [rows]);

  const filteredPharmaciesForDropdown = useMemo(() => {
    if (!pharmacySearchTerm) return uniquePharmacies;
    return uniquePharmacies.filter(p => p.toLowerCase().includes(pharmacySearchTerm.toLowerCase()));
  }, [uniquePharmacies, pharmacySearchTerm]);

  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      const matchSearch = searchTerm === "" || 
        row.beneficiary_name.includes(searchTerm) || 
        row.card_number.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchPharmacy = selectedPharmacy === "" || row.facility_name === selectedPharmacy;
      
      return matchSearch && matchPharmacy;
    });
  }, [rows, searchTerm, selectedPharmacy]);

  const toggleAll = () => {
    if (selectedIds.size === filteredRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRows.map(r => r.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const runFix = () => {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const res = await convertPharmacySuppliesToMedicineAction(Array.from(selectedIds));
      if (!res?.success) {
        setError(res?.error ?? "حدث خطأ غير متوقع");
        setConfirmOpen(false);
        return;
      }
      setSuccessMsg(`تم تحويل ${res.count} حركة بنجاح.`);
      setSelectedIds(new Set());
      setConfirmOpen(false);
      router.refresh();
    });
  };

  if (rows.length === 0) {
    return <p className="text-sm font-medium text-emerald-600">✓ لا توجد حركات مطابقة حالياً.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 justify-between items-start sm:items-center">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          حدد الحركات التي تود تحويلها إلى (أدوية صرف عام).
        </p>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={isPending || selectedIds.size === 0}
          className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-xs font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          تحويل المختار ({selectedIds.size})
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-md border border-slate-200 dark:border-slate-800">
        {/* General Search */}
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم المستفيد أو البطاقة..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pr-9 pl-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Pharmacy Dropdown */}
        <div className="relative w-full sm:w-64" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsPharmacyDropdownOpen(!isPharmacyDropdownOpen)}
            className="flex h-9 w-full items-center justify-between rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <span className="truncate">{selectedPharmacy || "تصفية بالصيدلية (الكل)"}</span>
            {selectedPharmacy ? (
              <X className="h-4 w-4 text-slate-400 hover:text-slate-600" onClick={(e) => { e.stopPropagation(); setSelectedPharmacy(""); }} />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>
          
          {isPharmacyDropdownOpen && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
              <div className="p-2 border-b border-slate-100 dark:border-slate-700">
                <input
                  type="text"
                  placeholder="ابحث عن صيدلية..."
                  value={pharmacySearchTerm}
                  onChange={(e) => setPharmacySearchTerm(e.target.value)}
                  className="h-8 w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 text-xs outline-none focus:border-primary"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <ul className="max-h-48 overflow-y-auto p-1 text-xs">
                <li
                  className={`cursor-pointer rounded px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 ${selectedPharmacy === "" ? "bg-slate-50 font-bold dark:bg-slate-700/50" : ""}`}
                  onClick={() => { setSelectedPharmacy(""); setIsPharmacyDropdownOpen(false); setPharmacySearchTerm(""); }}
                >
                  الكل
                </li>
                {filteredPharmaciesForDropdown.length === 0 ? (
                  <li className="px-2 py-1.5 text-slate-400">لا توجد نتائج</li>
                ) : (
                  filteredPharmaciesForDropdown.map((p) => (
                    <li
                      key={p}
                      className={`cursor-pointer rounded px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 ${selectedPharmacy === p ? "bg-slate-50 font-bold dark:bg-slate-700/50" : ""}`}
                      onClick={() => { setSelectedPharmacy(p); setIsPharmacyDropdownOpen(false); setPharmacySearchTerm(""); }}
                    >
                      {p}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
      {successMsg && <p className="text-xs font-bold text-emerald-600">{successMsg}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800 max-h-[500px]">
        <table className="w-full border-collapse text-sm relative">
          <thead className="sticky top-0 z-0">
            <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/90 backdrop-blur-sm">
              <th className="p-2 w-10">
                <button type="button" onClick={toggleAll} className="text-slate-500 hover:text-slate-700">
                  {selectedIds.size === filteredRows.length && filteredRows.length > 0 ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                </button>
              </th>
              <th className="p-2">المستفيد</th>
              <th className="p-2">رقم البطاقة</th>
              <th className="p-2">الصيدلية / المرفق</th>
              <th className="p-2">القيمة</th>
              <th className="p-2">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-slate-500">لا توجد حركات تطابق عملية البحث</td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id} className="border-b dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="p-2">
                    <button type="button" onClick={() => toggleOne(row.id)} className="text-slate-500 hover:text-slate-700">
                      {selectedIds.has(row.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="p-2 font-bold text-xs">{row.beneficiary_name}</td>
                  <td className="p-2 font-mono text-xs">{row.card_number}</td>
                  <td className="p-2 text-xs">{row.facility_name}</td>
                  <td className="p-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">{row.amount.toLocaleString("ar-LY")} د.ل</td>
                  <td className="p-2 text-xs">{formatDateTripoli(row.created_at, "en-GB")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        onConfirm={runFix}
        title="تأكيد تحويل الحركات"
        description={`هل أنت متأكد من تحويل عدد ${selectedIds.size} حركة من كشف عام إلى أدوية صرف عام؟ لن يؤثر ذلك على الرصيد، ولكنه سيغير تصنيف الحركات المختارة.`}
        confirmLabel="نعم، حول الآن"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={error}
      />
    </div>
  );
}
