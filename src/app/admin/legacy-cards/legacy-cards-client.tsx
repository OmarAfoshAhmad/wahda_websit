"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/core";
import { Loader2, Trash2, CheckCircle2, ShieldAlert } from "lucide-react";
import { deleteLegacyCardAction, deleteAllUnusedLegacyCardsAction } from "@/app/actions/legacy-cards";
import { useRouter } from "next/navigation";

interface LegacyData {
  withNewCards: any[];
  withoutNewCards: any[];
}

export default function LegacyCardsClient({ initialData }: { initialData: LegacyData }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isDeletingAllWith, setIsDeletingAllWith] = useState(false);

  const handleDelete = async (id: string, listType: 'with' | 'without') => {
    if (!confirm("هل أنت متأكد من حذف هذه البطاقة القديمة؟ لا يمكن التراجع عن هذا الإجراء.")) return;
    
    setLoadingId(id);
    try {
      const res = await deleteLegacyCardAction(id);
      if (res.success) {
        if (listType === 'with') {
          setData(prev => ({ ...prev, withNewCards: prev.withNewCards.filter(c => c.legacy_id !== id) }));
        } else {
          setData(prev => ({ ...prev, withoutNewCards: prev.withoutNewCards.filter(c => c.legacy_id !== id) }));
        }
        router.refresh();
      } else {
        alert("حدث خطأ أثناء الحذف: " + res.error);
      }
    } finally {
      setLoadingId(null);
    }
  };

  const handleDeleteAllWithNewCards = async () => {
    if (!confirm("هل أنت متأكد من حذف جميع البطاقات القديمة التي صدرت لها بطاقات حديثة؟ سيتم حذف " + data.withNewCards.length + " سجلاً.")) return;
    
    setIsDeletingAllWith(true);
    try {
      const ids = data.withNewCards.map(c => c.legacy_id);
      const res = await deleteAllUnusedLegacyCardsAction(ids);
      if (res.success) {
        setData(prev => ({ ...prev, withNewCards: [] }));
        router.refresh();
      } else {
        alert("حدث خطأ أثناء الحذف الجماعي: " + res.error);
      }
    } finally {
      setIsDeletingAllWith(false);
    }
  };

  const handleDeleteAllUnused = async () => {
    if (!confirm("هل أنت متأكد من حذف جميع البطاقات القديمة التي لم يصدر لأصحابها شيء جديد؟ سيتم حذف " + data.withoutNewCards.length + " سجلاً.")) return;
    
    setIsDeletingAll(true);
    try {
      const ids = data.withoutNewCards.map(c => c.legacy_id);
      const res = await deleteAllUnusedLegacyCardsAction(ids);
      if (res.success) {
        setData(prev => ({ ...prev, withoutNewCards: [] }));
        router.refresh();
      } else {
        alert("حدث خطأ أثناء الحذف الجماعي: " + res.error);
      }
    } finally {
      setIsDeletingAll(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("ar-EG", { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-8">
      {/* القسم الأول: صدر لهم جديد */}
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm border-emerald-100 shadow-sm dark:border-emerald-900/30">
        <div className="flex flex-col space-y-1.5 p-6 bg-emerald-50/50 pb-4 dark:bg-emerald-900/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-500" />
              <h3 className="font-semibold leading-none tracking-tight text-emerald-900 dark:text-emerald-50">بطاقات قديمة صدرت لها بطاقات حديثة</h3>
            </div>
            {data.withNewCards.length > 0 && (
              <Button 
                variant="destructive" 
                size="sm"
                disabled={isDeletingAllWith}
                onClick={handleDeleteAllWithNewCards}
                className="h-8 text-xs"
              >
                {isDeletingAllWith ? <Loader2 className="ml-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="ml-1.5 h-3.5 w-3.5" />}
                حذف الكل ({data.withNewCards.length})
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground text-emerald-700/70 dark:text-emerald-400/70 mt-1.5">
            هؤلاء المستفيدون يمتلكون بطاقة قديمة، والنظام اكتشف أنه قد تم إصدار بطاقة جديدة لهم في تاريخ أحدث (بأصفار أو من خلال دفعات).
            يمكنك حذف سجلاتهم القديمة لكي تتبقى لهم البطاقات الحديثة فقط منعاً للتكرار.
          </p>
        </div>
        <div className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">البطاقة القديمة</th>
                  <th className="px-4 py-3 font-medium">البطاقة الحديثة</th>
                  <th className="px-4 py-3 font-medium">طريقة الإصدار</th>
                  <th className="px-4 py-3 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.withNewCards.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">لا توجد سجلات مطابقة</td>
                  </tr>
                ) : (
                  data.withNewCards.map((item) => (
                    <tr key={item.legacy_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-200">{item.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs text-rose-600 dark:text-rose-400">{item.legacy_card}</span>
                          <span className="text-[10px] text-slate-400">{formatDate(item.legacy_date)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">{item.new_card}</span>
                          <span className="text-[10px] text-slate-400">{formatDate(item.new_date)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {item.new_batch ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-900/30 dark:text-blue-400 dark:ring-blue-400/20">
                            دفعة {item.new_batch}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-1 text-[10px] font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10 dark:bg-purple-900/30 dark:text-purple-400 dark:ring-purple-400/20">
                            فردي
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button 
                          variant="destructive" 
                          size="sm"
                          disabled={loadingId === item.legacy_id}
                          onClick={() => handleDelete(item.legacy_id, 'with')}
                          className="h-8 text-xs"
                        >
                          {loadingId === item.legacy_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Trash2 className="ml-1.5 h-3.5 w-3.5" /> حذف القديمة</>}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* القسم الثاني: لم يصدر لهم جديد */}
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm border-rose-100 shadow-sm dark:border-rose-900/30">
        <div className="flex flex-col space-y-1.5 p-6 bg-rose-50/50 pb-4 dark:bg-rose-900/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-500" />
              <h3 className="font-semibold leading-none tracking-tight text-rose-900 dark:text-rose-50">بطاقات قديمة لم يصدر لها شيء</h3>
            </div>
            {data.withoutNewCards.length > 0 && (
              <Button 
                variant="destructive" 
                size="sm"
                disabled={isDeletingAll}
                onClick={handleDeleteAllUnused}
                className="h-8 text-xs"
              >
                {isDeletingAll ? <Loader2 className="ml-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="ml-1.5 h-3.5 w-3.5" />}
                حذف الكل ({data.withoutNewCards.length})
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground text-rose-700/70 dark:text-rose-400/70">
            هؤلاء المستفيدون موسومون بـ "بطاقة قديمة" ولكن لا توجد لهم أي بطاقات حديثة في المنظومة. يمكنك حذفهم لتنظيف قاعدة البيانات.
          </p>
        </div>
        <div className="p-0">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm text-right relative">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400 sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">البطاقة القديمة</th>
                  <th className="px-4 py-3 font-medium">تاريخ الدخول للمنظومة</th>
                  <th className="px-4 py-3 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.withoutNewCards.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">لا توجد سجلات مطابقة</td>
                  </tr>
                ) : (
                  data.withoutNewCards.map((item) => (
                    <tr key={item.legacy_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-200">{item.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-rose-600 dark:text-rose-400">{item.legacy_card}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDate(item.legacy_date)}</td>
                      <td className="px-4 py-3">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          disabled={loadingId === item.legacy_id || isDeletingAll}
                          onClick={() => handleDelete(item.legacy_id, 'without')}
                          className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                        >
                          {loadingId === item.legacy_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
