"use client";

import React from "react";
import { Search, Loader2, X } from "lucide-react";
import { Button, Input, Card } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { useOpticsDeductContext } from "./OpticsDeductContext";

export function OpticsSearchEngine() {
  const {
    searchInput,
    setSearchInput,
    setCardNumber,
    setError,
    showSuggestions,
    setShowSuggestions,
    suggestions,
    suggestionLoading,
    loading,
    deducting,
    searchBoxRef,
    handleSearch,
    handleSelectSuggestion,
    recentBeneficiaries,
    setRecentBeneficiaries,
    handlePickRecent,
    beneficiary,
    resetSearchState,
    setSelectedBeneficiaryId,
  } = useOpticsDeductContext();

  return (
    <>
      {/* ─── Search Bar ─────────────────────────────────────── */}
      <Card className="p-2">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1" ref={searchBoxRef}>
            <Input
              id="optics-beneficiary-search"
              name="optics-beneficiary-search"
              aria-label="البحث عن مستفيد في خدمات البصريات"
              value={searchInput}
              onChange={(e) => {
                const v = e.target.value;
                setSearchInput(v);
                setCardNumber(v);
                setSelectedBeneficiaryId(null);
                setError(null);
                if (v.trim().length < 2) {
                  setShowSuggestions(false);
                } else {
                  setShowSuggestions(true);
                }
              }}
              onFocus={() => searchInput.trim().length >= 2 && setShowSuggestions(true)}
              placeholder="أدخل رقم البطاقة أو اسم المستفيد للبحث (Ctrl+K)..."
              className="h-10 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
              disabled={loading || deducting}
              autoFocus
            />

            {searchInput && (
              <button
                type="button"
                onClick={resetSearchState}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                title="مسح البحث"
                aria-label="مسح البحث"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* ─── Autocomplete dropdown ─── */}
            {showSuggestions && (suggestionLoading || suggestions.length > 0) && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
                {suggestionLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري البحث...
                  </div>
                ) : (
                  suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-3 py-2 text-right hover:bg-slate-50 dark:hover:bg-slate-800 last:border-b-0"
                      onClick={() => {
                        handleSelectSuggestion(item);
                        // Force search after selection
                        setTimeout(() => handleSearch(undefined, item.card_number, item.id), 50);
                      }}
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{item.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{item.card_number}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
                        نشط
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <Button
            type="submit"
            className="h-10 px-5 sm:min-w-32.5 bg-teal-600 hover:bg-teal-700 text-white font-black"
            disabled={loading || deducting || !(searchInput.trim())}
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            <span className="mr-2">بحث</span>
          </Button>
        </form>
      </Card>

      {/* ─── Recent Beneficiaries ───────────────────────────── */}
      {!beneficiary && recentBeneficiaries.length > 0 && (
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-black text-slate-500 dark:text-slate-400">آخر 5 مستفيدين تم اقتطاع بصريات لهم</p>
            <button
              type="button"
              onClick={() => setRecentBeneficiaries([])}
              className="text-xs font-bold text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
            >
              مسح السجل
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentBeneficiaries.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handlePickRecent(item)}
                className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                title={`${item.name} - ${item.card_number}`}
              >
                {item.name}
              </button>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
