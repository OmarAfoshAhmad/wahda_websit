"use client";

import React, { useEffect, useState, useRef } from "react";
import { Search, CreditCard, AlertCircle, CheckCircle2, Loader2, DollarSign } from "lucide-react";
import { Button, Input, Card, Badge, cn } from "./ui";
import { getBeneficiaryByCard, searchBeneficiaries } from "@/app/actions/beneficiary";
import { deductBalance } from "@/app/actions/deduction";

interface Beneficiary {
  id: string;
  card_number: string;
  name: string;
  total_balance: number;
  remaining_balance: number;
  status: string;
}

interface BeneficiarySuggestion {
  id: string;
  card_number: string;
  name: string;
  remaining_balance: number;
  status: string;
}

export function DeductForm() {
  const [searchInput, setSearchInput] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<BeneficiarySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [deducting, setDeducting] = useState(false);
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form fields
  const [amount, setAmount] = useState<string>("");
  const [type, setType] = useState<"MEDICINE" | "SUPPLIES">("MEDICINE");
  const [showConfirm, setShowConfirm] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestionLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      const result = await searchBeneficiaries(q);
      if (cancelled) return;
      setSuggestionLoading(false);
      if (result.error) {
        setSuggestions([]);
        return;
      }
      setSuggestions(result.items);
      setShowSuggestions(true);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput]);

  const handleSelectSuggestion = (item: BeneficiarySuggestion) => {
    setCardNumber(item.card_number);
    setSearchInput(`${item.name} - ${item.card_number}`);
    setShowSuggestions(false);
    setError(null);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const normalizedCard = cardNumber.trim() || searchInput.trim();
    if (!normalizedCard) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    setBeneficiary(null);
    setShowConfirm(false);

    const result = await getBeneficiaryByCard(normalizedCard);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else if (result.beneficiary) {
      setCardNumber(result.beneficiary.card_number);
      setSearchInput(`${result.beneficiary.name} - ${result.beneficiary.card_number}`);
      setBeneficiary({
        id: result.beneficiary.id,
        card_number: result.beneficiary.card_number,
        name: result.beneficiary.name,
        total_balance: Number(result.beneficiary.total_balance),
        remaining_balance: Number(result.beneficiary.remaining_balance),
        status: result.beneficiary.status,
      });
      // Auto focus amount field
      setTimeout(() => amountRef.current?.focus(), 100);
    }
  };

  const handleDeduct = async () => {
    if (!beneficiary || !amount) return;
    
    setDeducting(true);
    setError(null);
    
    const result = await deductBalance({
      card_number: beneficiary.card_number,
      amount: parseFloat(amount),
      type,
    });

    setDeducting(false);
    setShowConfirm(false);

    if ("error" in result) {
      setError(result.error as string);
    } else {
      setSuccess("تمت عملية الخصم بنجاح");
      setBeneficiary({
        ...beneficiary,
        remaining_balance: result.newBalance,
        status: result.newBalance <= 0 ? "FINISHED" : "ACTIVE"
      });
      setAmount("");
      // Clear after success
      setTimeout(() => {
        setSuccess(null);
      }, 5000);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-2">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1" ref={searchBoxRef}>
            <Input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setCardNumber(e.target.value);
                setError(null);
                setShowSuggestions(true);
              }}
              onFocus={() => searchInput.trim().length >= 2 && setShowSuggestions(true)}
              placeholder="أدخل رقم البطاقة أو اسم المستفيد"
              className="h-10 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
              disabled={loading || deducting}
              autoFocus
            />

            {showSuggestions && (suggestionLoading || suggestions.length > 0) && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {suggestionLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري البحث...
                  </div>
                ) : (
                  suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-right hover:bg-slate-50 last:border-b-0"
                      onClick={() => handleSelectSuggestion(item)}
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.card_number}</p>
                      </div>
                      <span className="text-xs font-bold text-slate-500">{item.remaining_balance.toLocaleString("ar-LY")} د.ل</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <Button 
            type="submit" 
            className="h-10 px-5 sm:min-w-32.5"
            disabled={loading || deducting || !(cardNumber.trim() || searchInput.trim())}
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            <span className="mr-2">بحث</span>
          </Button>
        </form>
      </Card>

      {error && (
        <div className="flex items-center rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          <AlertCircle className="ml-2 h-4 w-4" />
          <p className="font-medium text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
          <CheckCircle2 className="ml-2 h-4 w-4" />
          <p className="font-medium text-sm">{success}</p>
        </div>
      )}

      {beneficiary && (
        <Card className="p-4 sm:p-4.5">
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-black/6 pb-3">
            <div>
              <h2 className="text-lg font-black text-slate-900 sm:text-xl">{beneficiary.name}</h2>
              <p className="text-xs font-medium text-slate-500">البطاقة: {beneficiary.card_number}</p>
            </div>
            <Badge variant={beneficiary.status === "ACTIVE" ? "success" : "danger"}>
              {beneficiary.status === "ACTIVE" ? "نشط" : "مكتمل"}
            </Badge>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400">إجمالي الرصيد</p>
              <p className="text-base font-black text-slate-700">{beneficiary.total_balance} د.ل</p>
            </div>
            <div className={cn("rounded-md p-3", beneficiary.remaining_balance < 50 ? "border border-amber-200 bg-amber-50" : "border border-slate-200 bg-slate-50")}>
              <p className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400">المتبقي</p>
              <p className={cn("text-xl font-black", beneficiary.remaining_balance < 50 ? "text-amber-600" : "text-primary")}>
                {beneficiary.remaining_balance} د.ل
              </p>
              {beneficiary.remaining_balance < 50 && beneficiary.remaining_balance > 0 && (
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">الرصيد أوشك على النفاد</p>
              )}
            </div>
          </div>

          {beneficiary.status === "ACTIVE" && beneficiary.remaining_balance > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">قيمة الخصم</label>
                  <div className="relative">
                    <DollarSign className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      ref={amountRef}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="h-10 pr-9 text-sm font-black"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">النوع</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-black/8 bg-white/75 px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    value={type}
                    onChange={(e) => setType(e.target.value as "MEDICINE" | "SUPPLIES")}
                  >
                    <option value="MEDICINE">ادوية صرف عام</option>
                    <option value="SUPPLIES">كشف عام</option>
                  </select>
                </div>
              </div>

              {!showConfirm ? (
                <Button 
                  className="h-10 w-full text-sm" 
                  onClick={() => amount && setShowConfirm(true)}
                  disabled={!amount || parseFloat(amount) <= 0}
                >
                  <CreditCard className="h-4 w-4" />
                  <span className="mr-2">مراجعة الخصم</span>
                </Button>
              ) : (
                <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-900">
                  <div className="text-center">
                    <p className="text-xs text-slate-500">أنت على وشك خصم</p>
                    <p className="text-xl font-black text-slate-950">{amount} د.ل</p>
                    <p className="mt-1 text-[11px] text-slate-500">{type === "MEDICINE" ? "ادوية صرف عام" : "كشف عام"} • {beneficiary.name}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button 
                      variant="outline" 
                      className="h-10 flex-1"
                      onClick={() => setShowConfirm(false)}
                      disabled={deducting}
                    >
                      إلغاء
                    </Button>
                    <Button 
                      className="h-10 flex-1"
                      onClick={handleDeduct}
                      disabled={deducting}
                    >
                      {deducting ? <Loader2 className="h-5 w-5 animate-spin" /> : "تأكيد التنفيذ"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center">
              <AlertCircle className="mx-auto mb-2 h-8 w-8 text-slate-400" />
              <p className="font-black text-slate-700">لا يوجد رصيد متبقٍ لهذا المستفيد.</p>
              <p className="mt-1 text-sm text-slate-500">تم إيقاف الخصم لأن حالة السجل مكتملة.</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
