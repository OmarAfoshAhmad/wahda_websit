"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Search, Loader2, CheckCircle2, AlertCircle, Building2, CreditCard, CalendarDays } from "lucide-react";
import { Button, Input , DateInput} from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { searchCompanyBeneficiaries, getDentalBeneficiaryDetail } from "@/app/actions/dental";
import { deductBalance } from "@/app/actions/deduction";
import { useToast } from "@/components/toast";
import { useRouter } from "next/navigation";

interface FacilityOption {
  id: string;
  name: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  facilities: FacilityOption[];
  defaultFacilityId: string;
  canChooseFacility: boolean;
  copayPercentage: number;
  annualCeiling: number | null;
  dentalSettings: any;
}

export function DentalAddTransactionModal({
  isOpen,
  onClose,
  companyId,
  companyName,
  facilities,
  defaultFacilityId,
  canChooseFacility,
  copayPercentage,
  annualCeiling,
  dentalSettings,
}: Props) {
  const toast = useToast();
  const router = useRouter();

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  // Selected Beneficiary details
  const [beneficiary, setBeneficiary] = useState<any | null>(null);
  const [yearlyConsumed, setYearlyConsumed] = useState(0);

  const [facilitySearch, setFacilitySearch] = useState("");
  const [showFacilityDropdown, setShowFacilityDropdown] = useState(false);
  const facilityDropdownRef = useRef<HTMLDivElement>(null);
  const facilityInputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Form inputs
  const [amount, setAmount] = useState("");
  const [subCategory, setSubCategory] = useState("DENTAL");
  const [selectedFacilityId, setSelectedFacilityId] = useState(defaultFacilityId);
  const [transactionDate, setTransactionDate] = useState(() => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  });

  const [maxDate] = useState(() => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  });

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Reset modal state
  const resetForm = useCallback(() => {
    setSearchInput("");
    setSuggestions([]);
    setShowSuggestions(false);
    setBeneficiary(null);
    setYearlyConsumed(0);
    setAmount("");
    setSubCategory("DENTAL");
    setSelectedFacilityId(defaultFacilityId);
    setShowConfirm(false);
    setError(null);
    setSuccess(null);
    const defaultFac = facilities.find((f) => f.id === defaultFacilityId);
    setFacilitySearch(defaultFac ? defaultFac.name : "");
    setShowFacilityDropdown(false);
  }, [defaultFacilityId, facilities]);

  // Reset when closed/opened
  useEffect(() => {
    if (!isOpen) {
      resetForm();
    } else {
      const defaultFac = facilities.find((f) => f.id === defaultFacilityId);
      setFacilitySearch(defaultFac ? defaultFac.name : "");
    }
  }, [isOpen, resetForm, defaultFacilityId, facilities]);

  // Synchronize facilitySearch text with selectedFacilityId when dropdown closes or on load
  useEffect(() => {
    if (!showFacilityDropdown) {
      const activeFac = facilities.find((f) => f.id === selectedFacilityId);
      if (activeFac) {
        setFacilitySearch(activeFac.name);
      }
    }
  }, [showFacilityDropdown, selectedFacilityId, facilities]);

  // Click outside to close suggestions dropdown & facility dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
      if (
        facilityDropdownRef.current && !facilityDropdownRef.current.contains(e.target as Node) &&
        facilityInputRef.current && !facilityInputRef.current.contains(e.target as Node)
      ) {
        setShowFacilityDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Debounced search autocomplete
  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2 || beneficiary) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      try {
        const res = await searchCompanyBeneficiaries(q, companyId);
        if (cancelled) return;
        setSuggestionLoading(false);
        if (res.error || !Array.isArray(res.items)) {
          setSuggestions([]);
          return;
        }
        setSuggestions(res.items);
        setShowSuggestions(true);
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setSuggestionLoading(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput, companyId, beneficiary]);

  const loadBeneficiaryDetails = async (benId: string) => {
    setSearching(true);
    setError(null);
    setSuccess(null);
    setShowConfirm(false);

    try {
      const res = await getDentalBeneficiaryDetail(benId, companyId);
      setSearching(false);

      if (res.error || !res.beneficiary) {
        setError(res.error ?? "تعذر جلب تفاصيل المستفيد");
      } else {
        const b = res.beneficiary;
        setSearchInput(`${b.name} - ${b.card_number}`);
        setBeneficiary(b);
        setYearlyConsumed(res.yearlyConsumed ?? 0);
        setShowSuggestions(false);
      }
    } catch {
      setSearching(false);
      setError("حدث خطأ في الاتصال. حاول مرة أخرى.");
    }
  };

  const handleSelectSuggestion = (item: any) => {
    void loadBeneficiaryDetails(item.id);
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = searchInput.trim();
    if (!candidate) return;

    setSearching(true);
    setError(null);
    setSuccess(null);
    setBeneficiary(null);
    setShowConfirm(false);

    try {
      const searchResults = await searchCompanyBeneficiaries(candidate, companyId);
      if (searchResults.error || !searchResults.items || searchResults.items.length === 0) {
        setSearching(false);
        setError("المستفيد غير موجود في هذه الشركة");
        return;
      }

      // Exact match or first match
      const matched = searchResults.items.find(
        (x) => x.card_number.toUpperCase() === candidate.toUpperCase()
      ) || searchResults.items[0];

      await loadBeneficiaryDetails(matched.id);
    } catch {
      setSearching(false);
      setError("حدث خطأ في الاتصال. حاول مرة أخرى.");
    }
  };

  // Financial calculations
  const amountNum = parseFloat(amount) || 0;
  const hasAmount = amountNum > 0;

  const settings = dentalSettings || null;
  const hasCustomPolicies = !!(
    settings?.ortho?.enabled ||
    settings?.implant?.enabled ||
    settings?.prosthetics?.enabled
  );

  let categoryCoverage = 100 - copayPercentage; // default coverage
  if (subCategory === "DENTAL_ORTHO" && settings?.ortho?.enabled) {
    categoryCoverage = Number(settings.ortho.coverage);
  } else if (subCategory === "DENTAL_IMPLANT" && settings?.implant?.enabled) {
    categoryCoverage = Number(settings.implant.coverage);
  } else if (subCategory === "DENTAL_PROSTHETICS" && settings?.prosthetics?.enabled) {
    categoryCoverage = Number(settings.prosthetics.coverage);
  }

  const effectiveCopayPercentage = 100 - categoryCoverage;
  const copayFactor = effectiveCopayPercentage / 100;
  const originalCompanyShare = amountNum * (1 - copayFactor);
  const originalPatientShare = amountNum * copayFactor;

  const remainingCeiling = annualCeiling !== null ? Math.max(0, annualCeiling - yearlyConsumed) : null;
  const remaining = remainingCeiling !== null ? remainingCeiling : Infinity;

  const actualCompanyShare = annualCeiling === null
    ? originalCompanyShare
    : Math.min(originalCompanyShare, remaining);
  const actualPatientShare = amountNum - actualCompanyShare;

  const isCeilingExhausted = annualCeiling !== null && remaining <= 0;
  const isPartial = annualCeiling !== null && originalCompanyShare > remaining && remaining > 0;

  const handleSubmit = async () => {
    if (!beneficiary || !amount) return;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    if (!transactionDate) {
      setError("تاريخ الحركة مطلوب");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await deductBalance({
        beneficiary_id: beneficiary.id,
        card_number: beneficiary.card_number,
        amount: amountNum,
        type: "DENTAL",
        dentalSubCategory: subCategory,
        transactionDate: new Date(`${transactionDate}T12:00:00.000Z`),
        facilityId: selectedFacilityId,
        requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      });

      setSubmitting(false);
      setShowConfirm(false);

      if (res.error) {
        setError(res.error);
        toast.error(res.error);
      } else {
        setSuccess("تمت إضافة الحركة اليدوية بنجاح");
        toast.success(`تم تسجيل خصم يدوي بقيمة ${amountNum.toLocaleString("ar-LY")} د.ل بنجاح!`);
        
        router.refresh();
        setTimeout(() => {
          onClose();
        }, 2000);
      }
    } catch {
      setSubmitting(false);
      setShowConfirm(false);
      setError("حدث خطأ في الاتصال. حاول مرة أخرى.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Dialog Content */}
      <div className={`relative w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-right max-h-[90vh] ${showFacilityDropdown ? 'overflow-visible' : 'overflow-y-auto'}`}>
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
          <div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white">إضافة حركة أسنان يدوية</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{companyName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Success/Error Alerts */}
        {error && (
          <div className="mb-4 flex items-center rounded-xl border border-red-200 bg-red-50 p-3 text-red-750 dark:border-red-900/30 dark:bg-red-950/10 dark:text-red-400">
            <AlertCircle className="ml-2 h-4 w-4 shrink-0 text-red-500" />
            <p className="font-bold text-sm">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-center rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-750 dark:border-emerald-900/30 dark:bg-emerald-950/10 dark:text-emerald-400">
            <CheckCircle2 className="ml-2 h-4 w-4 shrink-0 text-emerald-500" />
            <p className="font-bold text-sm">{success}</p>
          </div>
        )}

        <div className="space-y-5">
          {/* 1. Search & Beneficiary Section */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">المستفيد</label>
            {beneficiary ? (
              /* Beneficiary Card Details */
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-black text-slate-905 dark:text-white">{beneficiary.name}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1" dir="ltr">
                      {beneficiary.card_number}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBeneficiary(null);
                      setSearchInput("");
                    }}
                    className="text-xs font-bold text-teal-600 hover:text-teal-700 hover:underline"
                  >
                    تغيير المستفيد
                  </button>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block mb-0.5">سقف الأسنان السنوي:</span>
                    <span className="font-black text-slate-800 dark:text-slate-205">
                      {annualCeiling === null ? "مفتوح" : `${formatCurrency(annualCeiling)} د.ل`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">المستهلك هذا العام:</span>
                    <span className="font-black text-teal-600">
                      {formatCurrency(yearlyConsumed)} د.ل
                    </span>
                  </div>
                  {annualCeiling !== null && (
                    <div>
                      <span className="text-slate-400 block mb-0.5">السقف المتبقي:</span>
                      <span className="font-black text-amber-600">
                        {formatCurrency(remainingCeiling ?? 0)} د.ل
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Search autocomplete input */
              <form onSubmit={handleSearchSubmit} className="flex gap-2">
                <div className="relative flex-1" ref={searchBoxRef}>
                  <Input
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value);
                      if (e.target.value.trim().length < 2) {
                        setShowSuggestions(false);
                      } else {
                        setShowSuggestions(true);
                      }
                    }}
                    onFocus={() => searchInput.trim().length >= 2 && setShowSuggestions(true)}
                    placeholder="أدخل رقم البطاقة أو اسم المستفيد للبحث وتحديده أولاً..."
                    className="pl-8 text-sm"
                    disabled={searching}
                  />
                  {searchInput && !searching && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInput("");
                        setSuggestions([]);
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {showSuggestions && (suggestionLoading || suggestions.length > 0) && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
                      {suggestionLoading ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
                          <Loader2 className="h-3 w-3 animate-spin" /> جاري البحث...
                        </div>
                      ) : (
                        suggestions.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="flex w-full items-center justify-between border-b border-slate-100 dark:border-slate-800 px-3 py-2 text-right hover:bg-slate-50 dark:hover:bg-slate-800 last:border-b-0"
                            onClick={() => handleSelectSuggestion(item)}
                          >
                            <div>
                              <p className="text-xs font-bold text-slate-900 dark:text-white">{item.name}</p>
                              <p className="text-[10px] text-slate-500">{item.card_number}</p>
                            </div>
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
                              نشط
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <Button type="submit" disabled={searching || !searchInput.trim()} className="bg-teal-600 hover:bg-teal-700 text-white font-black">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="mr-1.5 text-xs">بحث</span>
                </Button>
              </form>
            )}
          </div>

          {/* 2. Transaction Details (Inputs Grid) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
            {/* Facility Input */}
            <div className="space-y-1.5" ref={facilityDropdownRef}>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                المرفق الصحي
              </label>
              {canChooseFacility ? (
                <div className="relative">
                  <Input
                    ref={facilityInputRef}
                    type="text"
                    value={facilitySearch}
                    onChange={(e) => {
                      setFacilitySearch(e.target.value);
                      setShowFacilityDropdown(true);
                      // Recalculate position on every keystroke
                      if (facilityInputRef.current) {
                        const rect = facilityInputRef.current.getBoundingClientRect();
                        setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                      }
                    }}
                    onFocus={() => {
                      setShowFacilityDropdown(true);
                      if (facilityInputRef.current) {
                        const rect = facilityInputRef.current.getBoundingClientRect();
                        setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                      }
                    }}
                    placeholder="ابحث عن المرفق الصحي..."
                    className="h-11 text-sm font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus-visible:ring-teal-500/30"
                  />
                </div>
              ) : (
                <div className="flex h-11 w-full items-center rounded-md border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 px-3 text-sm text-slate-500 font-bold">
                  {facilities.find((f) => f.id === selectedFacilityId)?.name || "مرفق غير معروف"}
                </div>
              )}
            </div>

            {/* Date Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                تاريخ الحركة
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-600 dark:text-teal-400">
                  <CalendarDays className="h-4 w-4" />
                </div>
                <input
                  type="date" lang="en-GB"
                  className="flex h-11 w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 pr-10 pl-3 py-2 text-sm font-bold text-slate-900 focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/30"
                  value={transactionDate}
                  max={maxDate}
                  onChange={(e) => {
                    setTransactionDate(e.target.value);
                    setShowConfirm(false);
                  }}
                />
              </div>
            </div>

            {/* Amount Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                قيمة فاتورة الأسنان
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-600 dark:text-teal-400">
                  <CreditCard className="h-4 w-4" />
                </div>
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  placeholder="0.00"
                  className="h-11 pr-10 text-base font-black focus-visible:ring-teal-500/30 dark:bg-slate-900"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setShowConfirm(false);
                  }}
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-slate-400">
                  د.ل
                </div>
              </div>
            </div>

            {/* Dental Subcategory Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                تصنيف خدمة الأسنان
              </label>
              <select
                className="flex h-11 w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-bold text-slate-900 focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/30"
                value={subCategory}
                onChange={(e) => {
                  setSubCategory(e.target.value);
                  setShowConfirm(false);
                }}
              >
                <option value="DENTAL">خدمات أسنان عامة ({100 - copayPercentage}% تغطية)</option>
                {settings?.ortho?.enabled && (
                  <option value="DENTAL_ORTHO">تقويم الأسنان ({settings.ortho.coverage}% تغطية)</option>
                )}
                {settings?.implant?.enabled && (
                  <option value="DENTAL_IMPLANT">زراعة الأسنان ({settings.implant.coverage}% تغطية)</option>
                )}
                {settings?.prosthetics?.enabled && (
                  <option value="DENTAL_PROSTHETICS">تركيبات الأسنان ({settings.prosthetics.coverage}% تغطية)</option>
                )}
              </select>
            </div>
          </div>

          {/* 3. Calculations Preview */}
          {hasAmount && (
            <div className={`rounded-xl border p-4 space-y-3 transition-colors ${
              isCeilingExhausted
                ? "border-red-200 bg-red-50 dark:border-red-900/20 dark:bg-red-950/10"
                : isPartial
                ? "border-amber-200 bg-amber-50 dark:border-amber-900/20 dark:bg-amber-950/10"
                : "border-teal-100 bg-teal-50/20 dark:border-teal-900/20 dark:bg-teal-950/10"
            }`}>
              {!beneficiary ? (
                <p className="text-xs font-bold text-center text-slate-500 dark:text-slate-400 py-1">
                  💡 يرجى تحديد المستفيد لعرض حسابات التغطية وتدقيق السقف السنوي بدقة.
                </p>
              ) : isCeilingExhausted ? (
                <div className="text-center py-2">
                  <p className="font-black text-red-700 dark:text-red-400">انتهى السقف السنوي لخدمات الأسنان</p>
                  <p className="text-xs text-red-600 dark:text-red-500 mt-1">لا يمكن إجراء اقتطاع</p>
                </div>
              ) : (
                <>
                  {isPartial && (
                    <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/30 rounded px-2.5 py-1 flex items-center gap-1">
                      ⚠️ سقف الأسنان غير كافٍ لتغطية كامل حصة الشركة. سيتم تطبيق تغطية جزئية.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">على الشركة</p>
                      <p className="text-2xl font-black text-teal-700 dark:text-teal-400 leading-tight">{formatCurrency(actualCompanyShare)}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">د.ل</p>
                    </div>
                    <div className="border-r border-slate-200 dark:border-slate-800 pr-4">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">على المؤمن (كاش)</p>
                      <p className="text-2xl font-black text-amber-600 dark:text-amber-400 leading-tight">{formatCurrency(actualPatientShare)}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">د.ل</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 4. Direct Submit */}
          {hasAmount && !isCeilingExhausted && (
            <Button
              onClick={() => {
                if (!beneficiary) {
                  toast.error("يرجى تحديد المستفيد أولاً");
                  return;
                }
                handleSubmit();
              }}
              disabled={!beneficiary || submitting}
              className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-black text-sm rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : !beneficiary ? "يرجى تحديد المستفيد أولاً" : "تأكيد وإضافة الحركة"}
            </Button>
          )}
        </div>
      </div>

      {/* Fixed-position facility dropdown portal — renders outside modal overflow */}
      {showFacilityDropdown && dropdownPos && (
        <div
          ref={facilityDropdownRef}
          className="fixed z-[100] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl text-right"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          {facilities
            .filter((fac) =>
              fac.name.toLowerCase().includes(facilitySearch.toLowerCase())
            )
            .map((fac) => (
              <button
                key={fac.id}
                type="button"
                className="flex w-full items-center justify-between border-b border-slate-100 dark:border-slate-800 px-3 py-2.5 text-right hover:bg-slate-50 dark:hover:bg-slate-800 last:border-b-0 text-sm font-bold text-slate-800 dark:text-slate-100 transition-colors"
                onClick={() => {
                  setSelectedFacilityId(fac.id);
                  setFacilitySearch(fac.name);
                  setShowFacilityDropdown(false);
                  setShowConfirm(false);
                }}
              >
                <span>{fac.name}</span>
              </button>
            ))}
          {facilities.filter((fac) =>
            fac.name.toLowerCase().includes(facilitySearch.toLowerCase())
          ).length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500">
              لا توجد نتائج مطابقة
            </div>
          )}
        </div>
      )}
    </div>
  );
}
