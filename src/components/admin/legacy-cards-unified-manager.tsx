"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  Search, 
  Trash2, 
  ShieldCheck, 
  ShieldAlert, 
  BadgeAlert, 
  BadgeCheck, 
  Activity, 
  ChevronRight, 
  ChevronLeft,
  X,
  CreditCard,
  Edit3,
  AlertTriangle
} from "lucide-react";
import { Card, Badge, Input, Button } from "@/components/ui";
import { LegacyCardInlineToggleButton } from "./legacy-card-inline-toggle-button";
import { BeneficiaryDeleteButton } from "@/components/beneficiary-delete-button";
import { LegacyNoPaymentPurgeButton } from "./legacy-no-payment-purge-button";
import { LegacyWithBatchStabilizeButton } from "./legacy-with-batch-stabilize-button";
import { bulkUpdateBeneficiaryBatch } from "@/app/actions/beneficiary/bulk";

function getCardSortKey(cardNumber: string) {
  const normalized = (cardNumber || "").toUpperCase().trim();
  const match = normalized.match(/^([A-Z]+\d*)(0*)(\d+)([A-Z]*\d*)$/i);
  if (match) {
    const prefix = match[1];
    const numVal = parseInt(match[3], 10);
    const suffix = match[4];
    return { prefix, numVal, suffix, original: normalized };
  }
  const digitsOnly = normalized.replace(/\D/g, "");
  const numVal = digitsOnly ? parseInt(digitsOnly, 10) : 0;
  return { prefix: normalized, numVal, suffix: "", original: normalized };
}

type LegacyCardRow = {
  id: string;
  name: string;
  card_number: string;
  status: string;
  is_legacy_card?: boolean;
  total_balance?: number;
  remaining_balance?: number;

  manual_transactions_count: number;
  import_transactions_count: number;
  total_transactions_count: number;
  batch_number?: string | null;
  city?: string | null;
};

interface Props {
  legacyWithBatchRows: LegacyCardRow[];
  legacyNoPaymentRows: LegacyCardRow[];
  missingCardsRows?: LegacyCardRow[];
}

export function LegacyCardsUnifiedManager({ legacyWithBatchRows, legacyNoPaymentRows, missingCardsRows = [] }: Props) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "HAS_BATCH" | "NO_BATCH" | "MISSING">("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // states for batch selection and update
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBatchInput, setBulkBatchInput] = useState("");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // states for inline single edit
  const [editingRow, setEditingRow] = useState<LegacyCardRow | null>(null);
  const [editBatchInput, setEditBatchInput] = useState("");
  const [isInlineUpdating, setIsInlineUpdating] = useState(false);

  // state for specific batch filter
  const [selectedBatch, setSelectedBatch] = useState("ALL_BATCHES");

  // 1. تجميع البيانات وتوسيمها
  const allItems = useMemo(() => {
    return [
      ...legacyWithBatchRows.map(row => ({ ...row, hasBatch: true, isMissing: false })),
      ...legacyNoPaymentRows.map(row => ({ ...row, hasBatch: false, isMissing: false })),
      ...missingCardsRows.map(row => ({
        ...row,
        hasBatch: !!row.batch_number,
        isMissing: true,
      }))
    ];
  }, [legacyWithBatchRows, legacyNoPaymentRows, missingCardsRows]);

  const uniqueBatches = useMemo(() => {
    const batches = new Set<string>();
    allItems.forEach(item => {
      if (!item.isMissing && item.hasBatch && item.batch_number) {
        batches.add(item.batch_number.trim());
      }
    });
    return Array.from(batches).sort((a, b) => a.localeCompare(b, "ar"));
  }, [allItems]);

  // 2. الفلترة والبحث
  const filteredItems = useMemo(() => {
    let result = allItems;

    if (filterType === "HAS_BATCH") {
      result = result.filter(item => !item.isMissing && item.hasBatch);
      if (selectedBatch !== "ALL_BATCHES") {
        result = result.filter(item => item.batch_number === selectedBatch);
      }
    } else if (filterType === "NO_BATCH") {
      result = result.filter(item => !item.isMissing && !item.hasBatch);
    } else if (filterType === "MISSING") {
      result = result.filter(item => item.isMissing);
    } else {
      // ALL
      result = result.filter(item => !item.isMissing);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter(item => 
        item.name.toLowerCase().includes(q) ||
        item.card_number.toLowerCase().includes(q) ||
        (item.batch_number && item.batch_number.toLowerCase().includes(q)) ||
        (item.city && item.city.toLowerCase().includes(q))
      );
    }

    return [...result].sort((a, b) => {
      const aKey = getCardSortKey(a.card_number);
      const bKey = getCardSortKey(b.card_number);

      if (aKey.prefix !== bKey.prefix) {
        return aKey.prefix.localeCompare(bKey.prefix);
      }
      if (aKey.numVal !== bKey.numVal) {
        return aKey.numVal - bKey.numVal;
      }
      if (aKey.suffix !== bKey.suffix) {
        return aKey.suffix.localeCompare(bKey.suffix);
      }
      return a.card_number.localeCompare(b.card_number);
    });
  }, [allItems, filterType, selectedBatch, searchTerm]);

  // 3. التقسيم لصفحات (Pagination)
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage) || 1;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredItems.slice(start, start + itemsPerPage);
  }, [filteredItems, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleFilterChange = (type: "ALL" | "HAS_BATCH" | "NO_BATCH" | "MISSING") => {
    setFilterType(type);
    setSelectedBatch("ALL_BATCHES");
    setSelectedIds(new Set()); // Clear selections on filter type change
    setCurrentPage(1); // العودة للصفحة الأولى
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const clearSearch = () => {
    setSearchTerm("");
    setCurrentPage(1);
  };

  const handleBulkBatchUpdate = async () => {
    if (selectedIds.size === 0 || !bulkBatchInput.trim()) return;

    setIsBulkUpdating(true);
    try {
      const idsArray = Array.from(selectedIds);
      const res = await bulkUpdateBeneficiaryBatch({
        ids: idsArray,
        batchNumber: bulkBatchInput.trim()
      });

      if (res.error) {
        alert(res.error);
      } else {
        alert(`تم بنجاح تعيين رقم الدفعة ${bulkBatchInput.trim()} لـ ${res.updatedCount} مستفيد.`);
        setSelectedIds(new Set());
        setBulkBatchInput("");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء التحديث الجماعي");
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleInlineBatchUpdate = async () => {
    if (!editingRow || !editBatchInput.trim()) return;

    setIsInlineUpdating(true);
    try {
      const res = await bulkUpdateBeneficiaryBatch({
        ids: [editingRow.id],
        batchNumber: editBatchInput.trim()
      });

      if (res.error) {
        alert(res.error);
      } else {
        setEditingRow(null);
        setEditBatchInput("");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء تحديث الدفعة");
    } finally {
      setIsInlineUpdating(false);
    }
  };

  // إحصائيات سريعة للبطاقات
  const stats = useMemo(() => {
    const total = allItems.filter(item => !item.isMissing).length;
    const hasBatch = legacyWithBatchRows.length;
    const noBatch = legacyNoPaymentRows.length;
    const missing = (missingCardsRows || []).length;
    return { total, hasBatch, noBatch, missing };
  }, [allItems, legacyWithBatchRows, legacyNoPaymentRows, missingCardsRows]);

  return (
    <div className="space-y-6">
      
      {/* ── البطاقات الإحصائية ────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden p-5 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-2xl group transition-all duration-300 hover:shadow-md">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform duration-500" />
          <p className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">إجمالي البطاقات القديمة بالمنظومة</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white">{stats.total.toLocaleString("ar-LY")}</span>
            <span className="text-xs text-slate-500">بطاقة</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
            <CreditCard className="h-3 w-3 text-primary" />
            جميع البطاقات الموسومة كقديمة بالمنظومة
          </p>
        </Card>

        <Card className="relative overflow-hidden p-5 border-emerald-200 dark:border-emerald-900 bg-emerald-50/20 dark:bg-emerald-950/10 shadow-sm rounded-2xl group transition-all duration-300 hover:shadow-md">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform duration-500" />
          <p className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">صدرت لهم بطاقات جديدة (له دفعة)</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-700 dark:text-emerald-300">{stats.hasBatch.toLocaleString("ar-LY")}</span>
            <span className="text-xs text-emerald-600 dark:text-emerald-500">مستفيد</span>
          </div>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
            <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            مسجلون بجدول الحقيقة ومستحقون للتثبيت
          </p>
        </Card>

        <Card className="relative overflow-hidden p-5 border-rose-200 dark:border-rose-950/30 bg-rose-50/20 dark:bg-rose-950/10 shadow-sm rounded-2xl group transition-all duration-300 hover:shadow-md">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform duration-500" />
          <p className="text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">بدون دفعة بجدول الحقيقة (للتصفية)</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-rose-700 dark:text-rose-400">{stats.noBatch.toLocaleString("ar-LY")}</span>
            <span className="text-xs text-rose-500">بطاقة</span>
          </div>
          <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-2 flex items-center gap-1">
            <BadgeAlert className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            غير مدرجين بجدول الحقيقة (يمكن تصفيتهم)
          </p>
        </Card>

        <Card className="relative overflow-hidden p-5 border-amber-200 dark:border-amber-950/30 bg-amber-50/20 dark:bg-amber-950/10 shadow-sm rounded-2xl group transition-all duration-300 hover:shadow-md border-dashed">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform duration-500" />
          <p className="text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">المفقودين (غير مدرجين بالمنظومة)</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-700 dark:text-amber-400">{stats.missing.toLocaleString("ar-LY")}</span>
            <span className="text-xs text-amber-500">بطاقة مفقودة</span>
          </div>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            موجودة بالملف الخارجي ولكن لم تستورد بعد
          </p>
        </Card>
      </div>

      {/* ── لوحة التحكم والإجراءات الجماعية ────────────────────── */}
      <Card className="p-4 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-sm space-y-4">
        
        {/* شريط الإجراءات والبحث */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          
          {/* فلتر التبويبات التفاعلية */}
          <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
            <button
              onClick={() => handleFilterChange("ALL")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                filterType === "ALL" 
                  ? "bg-white dark:bg-slate-900 text-slate-950 dark:text-white shadow-sm" 
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              المنظومة ({stats.total})
            </button>
            <button
              onClick={() => handleFilterChange("HAS_BATCH")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                filterType === "HAS_BATCH" 
                  ? "bg-emerald-500 text-white shadow-sm" 
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <BadgeCheck className="h-3.5 w-3.5" />
              له دفعة ({stats.hasBatch})
            </button>
            <button
              onClick={() => handleFilterChange("NO_BATCH")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                filterType === "NO_BATCH" 
                  ? "bg-rose-500 text-white shadow-sm" 
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <BadgeAlert className="h-3.5 w-3.5" />
              بدون دفعة ({stats.noBatch})
            </button>
            <button
              onClick={() => handleFilterChange("MISSING")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                filterType === "MISSING" 
                  ? "bg-amber-500 text-white shadow-sm" 
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              المفقودين ({stats.missing})
            </button>
          </div>

          {/* فلترة برقم الدفعة المحددة */}
          {filterType === "HAS_BATCH" && uniqueBatches.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">تصفية حسب الدفعة:</span>
              <select
                value={selectedBatch}
                onChange={(e) => {
                  setSelectedBatch(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-9 text-xs px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="ALL_BATCHES">كافة الدفعات ({uniqueBatches.length})</option>
                {uniqueBatches.map(batch => (
                  <option key={batch} value={batch}>الدفعة {batch}</option>
                ))}
              </select>
            </div>
          )}

          {/* مربع البحث الذكي */}
          <div className="relative flex-1 max-w-md lg:mr-auto">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="ابحث بالاسم، رقم البطاقة، الدفعة أو المدينة..."
              className="pr-9 pl-8 h-9 text-xs rounded-xl border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
            />
            {searchTerm && (
              <button 
                onClick={clearSearch}
                className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* أزرار العمليات الجماعية الكبرى */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          {filterType !== "HAS_BATCH" && stats.noBatch > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-100 dark:border-rose-950/20 bg-rose-50/40 dark:bg-rose-950/10 p-2 text-xs flex-wrap">
              <span className="font-medium text-rose-800 dark:text-rose-400 flex items-center gap-1">
                <Trash2 className="h-3.5 w-3.5" />
                تصفية جماعية:
              </span>
              <span className="text-slate-500">حذف كافة الحالات التي لا تملك دفعة بجدول الحقيقة مع ترحيل حركاتهم المالية.</span>
              <LegacyNoPaymentPurgeButton candidateCount={stats.noBatch} />
            </div>
          )}
          {filterType !== "NO_BATCH" && stats.hasBatch > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-100 dark:border-emerald-950/20 bg-emerald-50/40 dark:bg-emerald-950/10 p-2 text-xs flex-wrap w-full lg:w-auto">
              <span className="font-medium text-emerald-800 dark:text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                تثبيت جماعي:
              </span>
              <span className="text-slate-500">تحويل الحالات التي تأكدت دفعاتها تلقائياً لتصبح بطاقات مستقرة.</span>
              <LegacyWithBatchStabilizeButton candidateCount={stats.hasBatch} />
            </div>
          )}
        </div>
      </Card>

      {/* ── شريط الإجراءات الجماعية للمحددين ────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-2xl animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 items-center justify-center rounded-full bg-primary text-white text-[11px] font-black px-2.5">
              {selectedIds.size}
            </span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              تم تحديد {selectedIds.size.toLocaleString("ar-LY")} مستفيد
            </span>
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Input
              value={bulkBatchInput}
              onChange={(e) => setBulkBatchInput(e.target.value)}
              placeholder="رقم الدفعة للمحددين..."
              className="h-9 text-xs rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
            />
            <Button
              type="button"
              size="sm"
              disabled={isBulkUpdating || !bulkBatchInput.trim()}
              onClick={handleBulkBatchUpdate}
              className="h-9 px-4 text-xs font-bold rounded-xl bg-primary text-white hover:bg-primary/90 shrink-0"
            >
              {isBulkUpdating ? "جاري التحديث..." : "تعيين رقم الدفعة"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              className="h-9 px-3 text-xs font-bold rounded-xl shrink-0"
            >
              إلغاء التحديد
            </Button>
          </div>
        </div>
      )}

      {/* ── جدول عرض المستفيدين ────────────────────── */}
      <Card className="overflow-hidden border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={paginatedItems.length > 0 && paginatedItems.every(item => selectedIds.has(item.id))}
                    onChange={(e) => {
                      const next = new Set(selectedIds);
                      if (e.target.checked) {
                        paginatedItems.forEach(item => next.add(item.id));
                      } else {
                        paginatedItems.forEach(item => next.delete(item.id));
                      }
                      setSelectedIds(next);
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                  />
                </th>
                <th className="p-3 font-bold">الاسم والبيانات الشخصية</th>
                <th className="p-3 font-bold">رقم البطاقة الحالي</th>
                <th className="p-3 font-bold">التحقق من جدول الحقيقة</th>
                <th className="p-3 font-bold">الحالة بالمنظومة</th>
                <th className="p-3 font-bold">الحركات المالية</th>
                <th className="p-3 font-bold text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500 dark:text-slate-400">
                    لا توجد بطاقات مطابقة لخيارات البحث والفلترة المحددة.
                  </td>
                </tr>
              ) : (
                paginatedItems.map((row) => (
                  <tr 
                    key={row.id} 
                    className={`border-b border-slate-100 dark:border-slate-800/50 transition-colors ${
                      row.isMissing 
                        ? "bg-amber-50/10 dark:bg-amber-950/5 hover:bg-amber-50/20 dark:hover:bg-amber-950/10" 
                        : "hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
                    }`}
                  >
                    {/* Checkbox column */}
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        disabled={row.isMissing}
                        checked={selectedIds.has(row.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) {
                            next.add(row.id);
                          } else {
                            next.delete(row.id);
                          }
                          setSelectedIds(next);
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>

                    {/* الاسم والبيانات */}
                    <td className="p-3 font-medium">
                      <div className="flex flex-col">
                        <span className="text-slate-900 dark:text-white font-bold">{row.name}</span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {row.isMissing ? "غير مدرج كحساب مستفيد" : `ID: ${row.id}`}
                        </span>
                      </div>
                    </td>
                    
                    {/* رقم البطاقة */}
                    <td className="p-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                      {row.card_number}
                    </td>

                    {/* التحقق من جدول الحقيقة */}
                    <td className="p-3">
                      {row.hasBatch ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30 shadow-sm">
                          <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>الدفعة {row.batch_number} • {row.city || "—"}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30 shadow-sm">
                          <BadgeAlert className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                          <span>بدون دفعة (تصفية)</span>
                        </span>
                      )}
                    </td>

                    {/* الحالة بالمنظومة */}
                    <td className="p-3">
                      {row.isMissing ? (
                        <Badge 
                          variant="danger"
                          className="text-[10px] px-2 py-0.5 font-bold bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-900/30"
                        >
                          غير موجود بالمنظومة
                        </Badge>
                      ) : (
                        <Badge 
                          variant={row.status === "ACTIVE" ? "success" : row.status === "SUSPENDED" ? "warning" : "default"}
                          className="text-[10px] px-2 py-0.5 font-bold"
                        >
                          {row.status === "ACTIVE" ? "نشط" : row.status === "SUSPENDED" ? "موقوف" : row.status}
                        </Badge>
                      )}
                    </td>

                    {/* الحركات المالية */}
                    <td className="p-3 text-slate-600 dark:text-slate-400 font-mono">
                      {row.isMissing ? (
                        <span className="text-[10px] text-slate-400 italic">لا توجد حركات (الحساب غير مسجل)</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px]">يدوية: <strong className="text-slate-800 dark:text-slate-200">{row.manual_transactions_count}</strong></span>
                            <span className="text-slate-300">|</span>
                            <span className="text-[10px]">استيراد: <strong className="text-slate-800 dark:text-slate-200">{row.import_transactions_count}</strong></span>
                          </div>
                          {row.total_transactions_count > 0 && (
                            <span className="text-[10px] font-bold text-primary flex items-center gap-0.5 mt-0.5">
                              <Activity className="h-3 w-3 shrink-0" />
                              {row.total_transactions_count} حركة (سيتم ترحيلها)
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* الإجراءات الفردية */}
                    <td className="p-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {row.isMissing ? (
                          <span className="text-[10px] text-slate-400 italic">لا توجد إجراءات متاحة</span>
                        ) : (
                          <>
                            {/* زر التثبيت / الإلغاء الفردي */}
                            <LegacyCardInlineToggleButton 
                              beneficiaryId={row.id} 
                              isLegacyCard={true} 
                            />
                            
                            {/* زر الحذف للفئة التي ليس لها دفعة */}
                            {!row.hasBatch && (
                              <BeneficiaryDeleteButton
                                id={row.id}
                                name={row.name}
                                hasTransactions={row.total_transactions_count > 0}
                              />
                            )}

                            {/* زر تعديل الدفعة يدوياً بشكل فردي */}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRow(row);
                                setEditBatchInput(row.batch_number || "");
                              }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors shadow-sm"
                              title="تعديل رقم الدفعة"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>

                            <Link
                              href={`/beneficiaries?q=${encodeURIComponent(row.card_number)}`}
                              target="_blank"
                              className="inline-flex h-7 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors shadow-sm"
                            >
                              فتح الملف
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── أزرار التنقل والترقيم السفلي ────────────────────── */}
        {filteredItems.length > itemsPerPage && (
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-4 py-3 sm:px-6 bg-slate-50/50 dark:bg-slate-900/50">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              عرض من {((currentPage - 1) * itemsPerPage + 1).toLocaleString("ar-LY")} إلى {Math.min(currentPage * itemsPerPage, filteredItems.length).toLocaleString("ar-LY")} • إجمالي {filteredItems.length.toLocaleString("ar-LY")} سجل
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="h-8 gap-0.5 text-xs rounded-xl"
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </Button>
              <span className="text-xs font-bold px-3 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 shadow-sm">
                {currentPage} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="h-8 gap-0.5 text-xs rounded-xl"
              >
                التالي
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ── مودال تعديل الدفعة الفردي ────────────────────── */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4 animate-in zoom-in-95 duration-200" dir="rtl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                تعديل رقم دفعة المستفيد
              </h3>
              <button
                onClick={() => setEditingRow(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-500">
                المستفيد: <strong className="text-slate-800 dark:text-slate-200">{editingRow.name}</strong>
              </p>
              <p className="text-slate-500">
                رقم البطاقة: <strong className="font-mono text-slate-800 dark:text-slate-200">{editingRow.card_number}</strong>
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-400">رقم الدفعة الجديد:</label>
              <Input
                value={editBatchInput}
                onChange={(e) => setEditBatchInput(e.target.value)}
                placeholder="أدخل رقم الدفعة..."
                className="h-10 text-xs rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingRow(null)}
                className="h-9 px-4 text-xs font-bold rounded-xl"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                disabled={isInlineUpdating || !editBatchInput.trim()}
                onClick={handleInlineBatchUpdate}
                className="h-9 px-4 text-xs font-bold rounded-xl bg-primary text-white hover:bg-primary/90"
              >
                {isInlineUpdating ? "جاري الحفظ..." : "حفظ التغييرات"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default LegacyCardsUnifiedManager;
