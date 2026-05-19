"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Trash2, Loader2, CheckSquare, Square, CheckCircle, Edit3, X, CreditCard } from "lucide-react";
import { deleteTruthRegistryRowsAction, deleteFilteredTruthRegistryAction, bulkUpdateTruthRegistryBatchAction } from "@/app/actions/truth-registry";

type RegistryRow = {
  id: string;
  card_number: string;
  card_number_upper: string;
  beneficiary_name: string | null;
  birth_date: Date | string | null;
  city: string;
  batch_number: string | null;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  updated_at: Date | string | null;
  batches_count: number;
  batches_list: string | null;
};

interface TruthRegistryTableProps {
  rows: RegistryRow[];
  totalCount: number;
  filters: {
    query: string;
    city: string;
    batch: string;
    multi: boolean;
    not_in_system: boolean;
    in_system_not_in_registry?: boolean;
    legacy_has_batch?: boolean;
    legacy_no_batch?: boolean;
  };
}

export function TruthRegistryTable({ rows, totalCount, filters }: TruthRegistryTableProps) {
  const router = useRouter();
  const { success, error } = useToast();
  
  // معرفات العناصر المحددة
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAllDatabaseSelected, setIsAllDatabaseSelected] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // حالات تحديث الدفعات
  const [batchInput, setBatchInput] = useState("");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  const [editingRow, setEditingRow] = useState<RegistryRow | null>(null);
  const [editBatchInput, setEditBatchInput] = useState("");
  const [isInlineUpdating, setIsInlineUpdating] = useState(false);

  const handleBulkBatchUpdate = async () => {
    if (selectedIds.size === 0 || !batchInput.trim()) return;

    setIsBulkUpdating(true);
    try {
      const res = await bulkUpdateTruthRegistryBatchAction({
        ids: Array.from(selectedIds),
        batchNumber: batchInput.trim()
      });

      if (res.error) {
        error(res.error);
      } else {
        success(`تم بنجاح تعيين رقم الدفعة ${batchInput.trim()} لـ ${res.updatedCount} سجل.`);
        setSelectedIds(new Set());
        setBatchInput("");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ أثناء التحديث الجماعي");
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleInlineBatchUpdate = async () => {
    if (!editingRow || !editBatchInput.trim()) return;

    setIsInlineUpdating(true);
    try {
      const res = await bulkUpdateTruthRegistryBatchAction({
        ids: [editingRow.id],
        batchNumber: editBatchInput.trim()
      });

      if (res.error) {
        error(res.error);
      } else {
        success(`تم تحديث الدفعة بنجاح.`);
        setEditingRow(null);
        setEditBatchInput("");
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ أثناء تحديث الدفعة");
    } finally {
      setIsInlineUpdating(false);
    }
  };

  const toggleSelectAll = () => {
    setIsAllDatabaseSelected(false);
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((row) => row.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setIsAllDatabaseSelected(false);
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0 && !isAllDatabaseSelected) return;

    let confirmMsg = "";
    if (isAllDatabaseSelected) {
      confirmMsg = `⚠️ تنبيه أمني شديد! هل أنت متأكد تماماً من رغبتك في حذف كافة الـ ${totalCount.toLocaleString("ar-LY")} سجل المطابقة للتصفية في قاعدة البيانات؟\n\nتنبيه: هذا الإجراء سيقوم بمسح كافة هذه السجلات نهائياً ولا يمكن التراجع عنه!`;
    } else {
      confirmMsg = `هل أنت متأكد من رغبتك في حذف ${selectedIds.size} سجل من جدول الحقيقة؟\n\nتنبيه: سيتم أيضاً مواءمة السجلات الموحدة المتبقية لهذه البطاقات تلقائياً.`;
    }

    if (!window.confirm(confirmMsg)) return;

    setIsDeleting(true);
    try {
      let res;
      if (isAllDatabaseSelected) {
        res = await deleteFilteredTruthRegistryAction(filters);
      } else {
        res = await deleteTruthRegistryRowsAction(Array.from(selectedIds));
      }

      if (res.error) {
        error(res.error);
      } else {
        // نستخدم النوع المناسب أو الحجم المحدد بناءً على نوع الحذف
        const countDeleted = (isAllDatabaseSelected && "deletedCount" in res) 
          ? (res.deletedCount ?? totalCount) 
          : selectedIds.size;
          
        success(`تم حذف ${countDeleted.toLocaleString()} سجل بنجاح من جدول الحقيقة!`);
        setSelectedIds(new Set());
        setIsAllDatabaseSelected(false);
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ غير متوقع أثناء محاولة حذف السجلات");
    } finally {
      setIsDeleting(false);
    }
  };

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < rows.length;

  const displayCount = isAllDatabaseSelected ? totalCount : selectedIds.size;

  return (
    <div className="relative">
      
      {/* شريط الإجراءات الطافي المميز عند التحديد */}
      <div 
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-800 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex flex-wrap items-center gap-6 backdrop-blur-md transition-all duration-300 ease-out ${
          selectedIds.size > 0 || isAllDatabaseSelected
            ? "translate-y-0 opacity-100 scale-100" 
            : "translate-y-12 opacity-0 scale-90 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[11px] font-black animate-pulse">
            {displayCount}
          </span>
          <span className="text-xs font-bold text-slate-300">سجل تم تحديده</span>
        </div>

        <div className="h-4 w-px bg-slate-800 hidden sm:block" />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set());
              setIsAllDatabaseSelected(false);
            }}
            className="text-xs text-slate-400 hover:text-white transition-colors font-medium px-2 py-1 rounded-lg hover:bg-slate-800/40"
          >
            إلغاء التحديد
          </button>
          
          <Button
            type="button"
            onClick={handleDeleteSelected}
            disabled={isDeleting}
            className="h-9 px-4 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-2 shadow-lg shadow-rose-950/20 animate-in fade-in"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                جاري الحذف...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                حذف المحدد مهما بلغ عدده
              </>
            )}
          </Button>

          {/* تعيين رقم الدفعة للمحددين */}
          {!isAllDatabaseSelected && (
            <>
              <div className="h-4 w-px bg-slate-800 hidden sm:block" />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={batchInput}
                  onChange={(e) => setBatchInput(e.target.value)}
                  placeholder="رقم الدفعة الجديد..."
                  className="h-9 w-32 text-xs bg-slate-800 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent rounded-xl px-3"
                  disabled={isBulkUpdating}
                />
                <Button
                  type="button"
                  disabled={isBulkUpdating || !batchInput.trim()}
                  onClick={handleBulkBatchUpdate}
                  className="h-9 px-3 rounded-xl text-xs font-black bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 shadow-lg shadow-blue-950/20"
                >
                  {isBulkUpdating ? "جاري الحفظ..." : "تطبيق الدفعة"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* بنر تحديد الكل عبر قاعدة البيانات */}
      {allSelected && totalCount > rows.length && !isAllDatabaseSelected && (
        <div className="bg-blue-500/10 dark:bg-blue-500/5 border-b border-blue-500/20 px-4 py-3 text-center flex flex-col sm:flex-row items-center justify-center gap-3 transition-all duration-300">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
            تم تحديد جميع الـ {rows.length} سجل في هذه الصفحة.
          </p>
          <button
            type="button"
            onClick={() => setIsAllDatabaseSelected(true)}
            className="text-xs font-black text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 bg-blue-500/15 dark:bg-blue-500/10 px-3 py-1 rounded-full transition-colors"
          >
            تحديد كافة الـ {totalCount.toLocaleString("ar-LY")} سجل المطابقة للتصفية الحالية
          </button>
        </div>
      )}

      {isAllDatabaseSelected && (
        <div className="bg-blue-500/15 dark:bg-blue-500/10 border-b border-blue-500/30 px-4 py-3 text-center flex items-center justify-center gap-2 transition-all duration-300">
          <CheckCircle className="h-4 w-4 text-blue-500" />
          <p className="text-xs font-black text-blue-700 dark:text-blue-300">
            تم تحديد كافة الـ {totalCount.toLocaleString("ar-LY")} سجل المطابقة للتصفية الحالية في قاعدة البيانات بنجاح.
          </p>
        </div>
      )}

      {filters.in_system_not_in_registry && (
        <div className="bg-amber-500/10 dark:bg-amber-500/5 border-b border-amber-500/20 px-4 py-3 text-right flex items-start gap-2.5">
          <span className="text-amber-500 text-base shrink-0 mt-0.5">⚠️</span>
          <div>
            <p className="text-xs font-bold text-amber-800 dark:text-amber-400">
              ملاحظة بخصوص مستفيدي المنظومة غير المدرجين بجدول الحقيقة:
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-1">
              هذه السجلات تمثل مستفيدين مسجلين حالياً في المنظومة ولكن لا يوجد لهم أي تطابق في جدول الحقيقة (البطاقات الرسمية).
              يمكنك الآن حذفهم (حذف مبدئي) مباشرة من هذه الشاشة، أو عبر شاشة "البطاقات القديمة" في "إدارة المشاكل".
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-280 text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/40">
            <tr className="text-right">
              {/* عمود الاختيار الكلي */}
              <th className="px-3 py-3 w-12 text-center">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  disabled={false}
                  className="inline-flex items-center justify-center h-5 w-5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500"
                >
                  {allSelected || isAllDatabaseSelected ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : someSelected ? (
                    <div className="h-2 w-2 rounded-sm bg-primary" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              </th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">رقم البطاقة</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">الاسم</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">الميلاد</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">المدينة</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">الدفعة</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400 text-center">عدد الدفعات</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">كل الدفعات</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">الملف</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">الصف</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">آخر تحديث</th>
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400 text-left">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-12 text-center text-slate-400 dark:text-slate-500 font-bold">
                  لا توجد نتائج مطابقة.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelected = selectedIds.has(row.id) || isAllDatabaseSelected;
                return (
                  <tr 
                    key={row.id} 
                    className={`border-t border-slate-100 dark:border-slate-800 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-900/10 ${
                      isSelected ? "bg-blue-50/20 dark:bg-blue-950/10" : ""
                    }`}
                  >
                    {/* اختيار صف واحد */}
                    <td className="px-3 py-2 w-12 text-center">
                      <button
                        type="button"
                        onClick={() => toggleSelectRow(row.id)}
                        disabled={false}
                        className={`inline-flex items-center justify-center h-5 w-5 rounded-md transition-colors ${
                          isSelected ? "text-primary" : "text-slate-400 hover:text-slate-600"
                        }`}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-bold font-mono tracking-tight text-slate-900 dark:text-slate-100">
                      {row.card_number}
                    </td>
                    <td className="px-3 py-2 text-slate-900 dark:text-slate-200 font-medium">
                      {row.beneficiary_name ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 font-mono text-xs">
                      {row.birth_date ? new Date(row.birth_date).toLocaleDateString("en-CA") : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                        {row.city}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">
                      {row.batch_number ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-center font-black text-blue-600 dark:text-blue-400">
                      {row.batches_count}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 max-w-44 truncate" title={row.batches_list ?? ""}>
                      {row.batches_list ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 max-w-44 truncate" title={row.source_file ?? ""}>
                      {row.source_file ?? "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.source_row ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 font-mono">
                      {row.updated_at ? new Date(row.updated_at).toLocaleString("en-GB") : "-"}
                    </td>
                    <td className="px-3 py-2 text-left">
                      {true && (
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
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── مودال تعديل الدفعة الفردي ────────────────────── */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4 animate-in zoom-in-95 duration-200" dir="rtl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                تعديل رقم دفعة السجل بجدول الحقيقة
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
                المستفيد: <strong className="text-slate-800 dark:text-slate-200">{editingRow.beneficiary_name || "—"}</strong>
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
