"use client";

import React, { useState } from "react";
import { UserMinus, Loader2, AlertCircle } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { purgeUnusedBeneficiaries } from "@/app/actions/company";

interface Props {
  companyId: string;
  companyName: string;
  activeBeneficiariesCount: number;
}

export function PurgeBeneficiaries({ companyId, companyName, activeBeneficiariesCount }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const handlePurge = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await purgeUnusedBeneficiaries(companyId);
      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else {
        setSuccessCount(result.count ?? 0);
        setLoading(false);
        setTimeout(() => {
          setShowConfirm(false);
          setSuccessCount(null);
        }, 2000);
      }
    } catch (err) {
      setError("حدث خطأ في الاتصال");
      setLoading(false);
    }
  };

  if (activeBeneficiariesCount === 0) {
    return (
      <button
        disabled
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/40 text-slate-400 cursor-not-allowed opacity-50"
        title="لا يوجد مستفيدون مسجلون لتنظيفهم"
      >
        <UserMinus className="h-3.5 w-3.5" />
      </button>
    );
  }

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40"
        title="تنظيف المستفيدين بدون حركات"
      >
        <UserMinus className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" dir="rtl">
      <Card className="w-full max-w-md p-6 text-right">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 shrink-0">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-black text-slate-900 dark:text-white text-base">تنظيف المستفيدين (بدون حركات)</h3>
            <p className="text-sm text-slate-500 mt-0.5">شركة: {companyName}</p>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-4 leading-relaxed">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-400">
            تنبيه هام حول عملية التنظيف:
          </p>
          <ul className="list-disc list-inside text-[11px] text-amber-700 dark:text-amber-500 mt-2 space-y-1">
            <li>سيقوم النظام بفحص جميع مستفيدي هذه الشركة بالكامل.</li>
            <li>سيتم **حذف أي مستفيد نهائياً** من قاعدة البيانات **فقط إذا لم تسجل له أي حركة خصم أو استهلاك**.</li>
            <li>المستفيدون الذين لديهم معاملات مالية مسجلة لن يتم المساس بهم إطلاقاً حفاظاً على سلامة الحسابات.</li>
          </ul>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {successCount !== null && (
          <div className="mb-4 rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 px-3 py-2 text-xs font-bold text-green-700 dark:text-green-400">
            ✨ تم بنجاح حذف {successCount} مستفيدين ليس لديهم أي حركات!
          </div>
        )}

        <div className="flex gap-2">
          {successCount === null && (
            <Button
              onClick={handlePurge}
              disabled={loading}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
            >
              {loading && <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin inline" />}
              تأكيد التنظيف والحذف
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowConfirm(false)}
            disabled={loading}
            className="flex-1 text-xs"
          >
            إلغاء
          </Button>
        </div>
      </Card>
    </div>
  );
}
