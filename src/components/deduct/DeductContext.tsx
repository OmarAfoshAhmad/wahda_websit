"use client";

/**
 * DeductContext
 * =============
 * يوفر حالة عملية الخصم المشتركة بين مكونات: SearchEngine، BeneficiaryCard، DeductionAction.
 * يعزل منطق البحث والعمل عن التصميم تماماً.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { getBeneficiaryByCard, searchBeneficiaries } from "@/app/actions/beneficiary";
import { deductBalance } from "@/app/actions/deduction";
import { useToast } from "@/components/toast";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Beneficiary {
  id: string;
  card_number: string;
  name: string;
  total_balance: number;
  remaining_balance: number;
  status: string;
}

export interface BeneficiarySuggestion {
  id: string;
  card_number: string;
  name: string;
  remaining_balance: number;
  status: string;
}

export type DeductType = "MEDICINE" | "SUPPLIES";

// ─── Context Shape ────────────────────────────────────────────────────────────

interface DeductContextValue {
  // Search
  searchInput: string;
  setSearchInput: (v: string) => void;
  cardNumber: string;
  setCardNumber: (v: string) => void;
  suggestions: BeneficiarySuggestion[];
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  suggestionLoading: boolean;
  loading: boolean;
  searchBoxRef: React.RefObject<HTMLDivElement | null>;
  handleSearch: (e?: React.FormEvent, explicitCard?: string) => Promise<void>;
  handleSelectSuggestion: (item: BeneficiarySuggestion) => void;

  // Recent
  recentBeneficiaries: BeneficiarySuggestion[];
  setRecentBeneficiaries: React.Dispatch<React.SetStateAction<BeneficiarySuggestion[]>>;
  handlePickRecent: (item: BeneficiarySuggestion) => void;

  // Beneficiary
  beneficiary: Beneficiary | null;
  setBeneficiary: React.Dispatch<React.SetStateAction<Beneficiary | null>>;

  // Deduction
  amount: string;
  setAmount: (v: string) => void;
  type: DeductType;
  setType: (v: DeductType) => void;
  showConfirm: boolean;
  setShowConfirm: (v: boolean) => void;
  deducting: boolean;
  handleDeduct: () => Promise<void>;

  // Feedback
  error: string | null;
  setError: (v: string | null) => void;
  success: string | null;

  // Reset
  resetSearchState: () => void;
}

const DeductContext = createContext<DeductContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDeductContext() {
  const ctx = useContext(DeductContext);
  if (!ctx) throw new Error("useDeductContext must be used inside DeductProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const RECENT_KEY = "wahda_recent_beneficiaries";

export function DeductProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<BeneficiarySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<DeductType>("SUPPLIES");
  const [showConfirm, setShowConfirm] = useState(false);
  const [deducting, setDeducting] = useState(false);
  const [recentBeneficiaries, setRecentBeneficiaries] = useState<BeneficiarySuggestion[]>([]);
  const [recentHydrated, setRecentHydrated] = useState(false);

  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);

  // Load recent beneficiaries after mount to keep SSR/client markup identical.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) {
        setRecentHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw) as BeneficiarySuggestion[];
      setRecentBeneficiaries(Array.isArray(parsed) ? parsed.slice(0, 5) : []);
    } catch {
      setRecentBeneficiaries([]);
    } finally {
      setRecentHydrated(true);
    }
  }, []);

  // Persist recent beneficiaries to localStorage
  useEffect(() => {
    if (!recentHydrated) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentBeneficiaries.slice(0, 5))); }
    catch { /* quota exceeded */ }
  }, [recentBeneficiaries, recentHydrated]);

  const saveRecentBeneficiary = useCallback((item: BeneficiarySuggestion) => {
    setRecentBeneficiaries((prev) =>
      [item, ...prev.filter((x) => x.id !== item.id)].slice(0, 5)
    );
  }, []);

  // Ctrl+K keyboard shortcut & outside-click handler
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
        if (input) { input.focus(); input.select(); }
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Debounced autocomplete suggestions
  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      try {
        const result = await searchBeneficiaries(q);
        if (cancelled) return;
        setSuggestionLoading(false);
        if (result.error || !Array.isArray(result.items)) { setSuggestions([]); return; }
        setSuggestions(result.items);
        setShowSuggestions(true);
      } catch { if (!cancelled) { setSuggestions([]); setSuggestionLoading(false); } }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchInput]);

  const resetSearchState = useCallback(() => {
    setSearchInput(""); setCardNumber(""); setSuggestions([]);
    setShowSuggestions(false); setBeneficiary(null);
    setAmount(""); setType("SUPPLIES"); setShowConfirm(false);
    setError(null); setSuccess(null);
  }, []);

  const handleSelectSuggestion = useCallback((item: BeneficiarySuggestion) => {
    setCardNumber(item.card_number);
    setSearchInput(`${item.name} - ${item.card_number}`);
    setShowSuggestions(false);
    setError(null);
  }, []);

  const handleSearch = useCallback(async (e?: React.FormEvent, explicitCard?: string) => {
    e?.preventDefault();
    const normalizedCard = explicitCard?.trim() || cardNumber.trim() || searchInput.trim();
    if (!normalizedCard) return;
    setLoading(true); setError(null); setSuccess(null);
    setBeneficiary(null); setShowConfirm(false);
    let result;
    try { result = await getBeneficiaryByCard(normalizedCard); }
    catch { setLoading(false); setError("خطأ في الاتصال. حاول مرة أخرى."); return; }
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else if (result.beneficiary) {
      const b = result.beneficiary;
      setCardNumber(b.card_number);
      setSearchInput(`${b.name} - ${b.card_number}`);
      const mapped: Beneficiary = {
        id: b.id, card_number: b.card_number, name: b.name,
        total_balance: Number(b.total_balance),
        remaining_balance: Number(b.remaining_balance),
        status: b.status,
      };
      setBeneficiary(mapped);
      saveRecentBeneficiary({ id: b.id, card_number: b.card_number, name: b.name, remaining_balance: Number(b.remaining_balance), status: b.status });
      setTimeout(() => amountRef.current?.focus(), 100);
    }
  }, [cardNumber, searchInput, saveRecentBeneficiary]);

  const handlePickRecent = useCallback((item: BeneficiarySuggestion) => {
    handleSelectSuggestion(item);
    void handleSearch(undefined, item.card_number);
  }, [handleSelectSuggestion, handleSearch]);

  const handleDeduct = useCallback(async () => {
    if (!beneficiary || !amount) return;
    setDeducting(true); setError(null);
    let result;
    try {
      result = await deductBalance({ card_number: beneficiary.card_number, amount: parseFloat(amount), type });
    } catch { setDeducting(false); setShowConfirm(false); setError("خطأ في الاتصال. حاول مرة أخرى."); return; }
    setDeducting(false); setShowConfirm(false);
    if ("error" in result) {
      setError(result.error as string);
      toast.error(result.error as string);
    } else {
      setSuccess("تمت عملية الخصم بنجاح");
      toast.success(`تم خصم ${parseFloat(amount).toLocaleString("ar-LY")} د.ل بنجاح`);
      setBeneficiary({ ...beneficiary, remaining_balance: result.newBalance, status: result.newBalance <= 0 ? "FINISHED" : "ACTIVE" });
      setAmount("");
      setTimeout(() => setSuccess(null), 5000);
    }
  }, [beneficiary, amount, type, toast]);

  return (
    <DeductContext.Provider value={{
      searchInput, setSearchInput, cardNumber, setCardNumber,
      suggestions, showSuggestions, setShowSuggestions, suggestionLoading,
      loading, searchBoxRef, handleSearch, handleSelectSuggestion,
      recentBeneficiaries, setRecentBeneficiaries, handlePickRecent,
      beneficiary, setBeneficiary,
      amount, setAmount, type, setType, showConfirm, setShowConfirm,
      deducting, handleDeduct,
      error, setError, success,
      resetSearchState,
    }}>
      {children}
    </DeductContext.Provider>
  );
}
