"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { searchCompanyBeneficiaries, getOpticsBeneficiaryDetail } from "@/app/actions/optics";
import { deductBalance } from "@/app/actions/deduction";
import { useToast } from "@/components/toast";

export interface OpticsBeneficiary {
  id: string;
  card_number: string;
  name: string;
  remaining_balance: number | null;
  total_balance: number | null;
  status: string;
  hasCustomCeiling?: boolean;
  company?: { id: string; name: string; code: string; logo?: string | null; optics_settings?: any } | null;
}

export interface OpticsSuggestion {
  id: string;
  card_number: string;
  name: string;
  status: string;
  remaining_balance: number | null;
  total_balance: number | null;
  hasCustomCeiling?: boolean;
}

interface OpticsDeductContextValue {
  companyId: string;
  companyName: string;
  annualCeiling: number | null;
  copayPercentage: number;

  // Search
  searchInput: string;
  setSearchInput: (v: string) => void;
  cardNumber: string;
  setCardNumber: (v: string) => void;
  suggestions: OpticsSuggestion[];
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  suggestionLoading: boolean;
  loading: boolean;
  searchBoxRef: React.RefObject<HTMLDivElement | null>;
  handleSearch: (e?: React.FormEvent, explicitCard?: string, explicitId?: string) => Promise<void>;
  handleSelectSuggestion: (item: OpticsSuggestion) => void;
  selectedBeneficiaryId: string | null;
  setSelectedBeneficiaryId: (id: string | null) => void;

  // Recent
  recentBeneficiaries: OpticsSuggestion[];
  setRecentBeneficiaries: React.Dispatch<React.SetStateAction<OpticsSuggestion[]>>;
  handlePickRecent: (item: OpticsSuggestion) => void;

  // Beneficiary details
  beneficiary: OpticsBeneficiary | null;
  setBeneficiary: React.Dispatch<React.SetStateAction<OpticsBeneficiary | null>>;
  yearlyConsumed: number;
  setYearlyConsumed: (v: number) => void;
  remainingCeiling: number | null;

  // Deduction
  amount: string;
  setAmount: (v: string) => void;
  showConfirm: boolean;
  setShowConfirm: (v: boolean) => void;
  deducting: boolean;
  handleDeduct: () => Promise<void>;

  // Feedback & Reset
  error: string | null;
  setError: (v: string | null) => void;
  success: string | null;
  resetSearchState: () => void;
}

const OpticsDeductContext = createContext<OpticsDeductContextValue | null>(null);

export function useOpticsDeductContext() {
  const ctx = useContext(OpticsDeductContext);
  if (!ctx) throw new Error("useOpticsDeductContext must be used inside OpticsDeductProvider");
  return ctx;
}

export function OpticsDeductProvider({
  children,
  companyId,
  companyName,
  annualCeiling,
  copayPercentage,
}: {
  children: React.ReactNode;
  companyId: string;
  companyName: string;
  annualCeiling: number | null;
  copayPercentage: number;
}) {
  const toast = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<OpticsSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [beneficiary, setBeneficiary] = useState<OpticsBeneficiary | null>(null);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string | null>(null);
  const [yearlyConsumed, setYearlyConsumed] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [deducting, setDeducting] = useState(false);

  const [recentBeneficiaries, setRecentBeneficiaries] = useState<OpticsSuggestion[]>([]);
  const [recentHydrated, setRecentHydrated] = useState(false);

  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);

  const RECENT_KEY = `wahda_recent_optics_${companyId}`;

  // Load recent beneficiaries from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as OpticsSuggestion[];
        setRecentBeneficiaries(Array.isArray(parsed) ? parsed.slice(0, 5) : []);
      }
    } catch {
      setRecentBeneficiaries([]);
    } finally {
      setRecentHydrated(true);
    }
  }, [RECENT_KEY]);

  // Persist recent beneficiaries
  useEffect(() => {
    if (!recentHydrated) return;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentBeneficiaries.slice(0, 5)));
    } catch {
      // ignore
    }
  }, [recentBeneficiaries, recentHydrated, RECENT_KEY]);

  const saveRecentBeneficiary = useCallback((item: OpticsSuggestion) => {
    setRecentBeneficiaries((prev) =>
      [item, ...prev.filter((x) => x.id !== item.id)].slice(0, 5)
    );
  }, []);

  // Keyboard shortcut Ctrl+K & outside click handler
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!searchBoxRef.current?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const input = searchBoxRef.current?.querySelector("input");
        if (input) {
          input.focus();
          input.select();
        }
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Debounced search autocomplete
  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2) return;
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
  }, [searchInput, companyId]);

  const resetSearchState = useCallback(() => {
    setSearchInput("");
    setCardNumber("");
    setSuggestions([]);
    setShowSuggestions(false);
    setBeneficiary(null);
    setSelectedBeneficiaryId(null);
    setAmount("");
    setShowConfirm(false);
    setError(null);
    setSuccess(null);
    setYearlyConsumed(0);
  }, []);

  const handleSelectSuggestion = useCallback((item: OpticsSuggestion) => {
    setCardNumber(item.card_number);
    setSearchInput(`${item.name} - ${item.card_number}`);
    setSelectedBeneficiaryId(item.id);
    setShowSuggestions(false);
    setError(null);
  }, []);

  const handleSearch = useCallback(async (e?: React.FormEvent, explicitCard?: string, explicitId?: string) => {
    e?.preventDefault();
    const candidate = explicitCard?.trim() || cardNumber.trim() || searchInput.trim();
    if (!candidate && !explicitId && !selectedBeneficiaryId) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setBeneficiary(null);
    setShowConfirm(false);

    try {
      let matchedId = explicitId || selectedBeneficiaryId;
      
      if (!matchedId) {
        // Find beneficiary details and current optics yearly consumed amount
        const searchResults = await searchCompanyBeneficiaries(candidate, companyId);
        if (searchResults.error || !searchResults.items || searchResults.items.length === 0) {
          setLoading(false);
          setError("المستفيد غير موجود في هذه الشركة");
          return;
        }

        // Pick the first match or exact match
        const matched = searchResults.items.find(
          (x) => x.card_number.toUpperCase() === candidate.toUpperCase()
        ) || searchResults.items[0];
        matchedId = matched.id;
      }

      const res = await getOpticsBeneficiaryDetail(matchedId, companyId);
      setLoading(false);

      if (res.error || !res.beneficiary) {
        setError(res.error ?? "تعذر جلب تفاصيل المستفيد");
      } else {
        const b = res.beneficiary;
        setCardNumber(b.card_number);
        setSearchInput(`${b.name} - ${b.card_number}`);
        setBeneficiary(b);
        setYearlyConsumed(res.yearlyConsumed ?? 0);

        saveRecentBeneficiary({
          id: b.id,
          card_number: b.card_number,
          name: b.name,
          status: b.status,
          remaining_balance: b.remaining_balance,
          total_balance: b.total_balance,
          hasCustomCeiling: b.hasCustomCeiling,
        });

        // Focus on the amount input after load
        setTimeout(() => {
          const input = document.getElementById("optics-amount-input");
          if (input) input.focus();
        }, 100);
      }
    } catch {
      setLoading(false);
      setError("حدث خطأ في الاتصال. حاول مرة أخرى.");
    }
  }, [cardNumber, searchInput, companyId, saveRecentBeneficiary]);

  const handlePickRecent = useCallback((item: OpticsSuggestion) => {
    handleSelectSuggestion(item);
    void handleSearch(undefined, item.card_number, item.id);
  }, [handleSelectSuggestion, handleSearch]);

  const handleDeduct = useCallback(async () => {
    if (!beneficiary || !amount) return;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setDeducting(true);
    setError(null);

    try {
      const res = await deductBalance({
        beneficiary_id: beneficiary.id,
        card_number: beneficiary.card_number,
        amount: amountNum,
        type: "OPTICS",
        requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      });

      setDeducting(false);
      setShowConfirm(false);

      if (res.error) {
        setError(res.error);
        toast.error(res.error);
      } else {
        setSuccess("تمت عملية الاقتطاع بنجاح");
        toast.success(`تم تسجيل خصم بقيمة ${amountNum.toLocaleString("ar-LY")} د.ل بنجاح!`);
        
        let categoryCoverage = 100 - copayPercentage; // default coverage

        const effectiveCopay = 100 - categoryCoverage;
        const copayFactor = effectiveCopay / 100;
        const originalCompanyShare = amountNum * (1 - copayFactor);
        const remaining = annualCeiling !== null ? Math.max(0, annualCeiling - yearlyConsumed) : Infinity;
        const addedCompanyShare = annualCeiling === null
          ? originalCompanyShare
          : Math.min(originalCompanyShare, remaining);
          
        setYearlyConsumed((prev) => prev + addedCompanyShare);
        setAmount("");
        setTimeout(() => setSuccess(null), 5000);
      }
    } catch {
      setDeducting(false);
      setShowConfirm(false);
      setError("حدث خطأ في الاتصال. حاول مرة أخرى.");
    }
  }, [beneficiary, amount, yearlyConsumed, annualCeiling, copayPercentage, toast]);

  const remainingCeiling = annualCeiling !== null ? Math.max(0, annualCeiling - yearlyConsumed) : null;

  return (
    <OpticsDeductContext.Provider
      value={{
        companyId,
        companyName,
        annualCeiling,
        copayPercentage,
        searchInput,
        setSearchInput,
        cardNumber,
        setCardNumber,
        suggestions,
        showSuggestions,
        setShowSuggestions,
        suggestionLoading,
        loading,
        searchBoxRef,
        handleSearch,
        handleSelectSuggestion,
        selectedBeneficiaryId,
        setSelectedBeneficiaryId,
        recentBeneficiaries,
        setRecentBeneficiaries,
        handlePickRecent,
        beneficiary,
        setBeneficiary,
        yearlyConsumed,
        setYearlyConsumed,
        remainingCeiling,
        amount,
        setAmount,
        showConfirm,
        setShowConfirm,
        deducting,
        handleDeduct,
        error,
        setError,
        success,
        resetSearchState,
      }}
    >
      {children}
    </OpticsDeductContext.Provider>
  );
}
