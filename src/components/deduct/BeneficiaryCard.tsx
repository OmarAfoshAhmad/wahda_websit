"use client";

/**
 * BeneficiaryCard
 * ===============
 * مكوّن عرض بيانات المستفيد — يقرأ البيانات من DeductContext فقط.
 * يعرض الاسم، رقم البطاقة، الأرصدة، والحالة. لا يحتوي على أي منطق.
 */

import React from "react";
import { AlertCircle } from "lucide-react";
import { Card, Badge, cn } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { useDeductContext } from "./DeductContext";
import { DeductionAction } from "./DeductionAction";

export function BeneficiaryCard() {
  const { beneficiary, resetSearchState } = useDeductContext();

  if (!beneficiary) return null;

  const statusLabel =
    beneficiary.status === "ACTIVE"
      ? "نشط"
      : beneficiary.status === "SUSPENDED"
      ? "موقوف"
      : "مكتمل";

  const statusVariant =
    beneficiary.status === "ACTIVE"
      ? "success"
      : beneficiary.status === "SUSPENDED"
      ? "danger"
      : "danger";

  const blockedTitle =
    beneficiary.status === "SUSPENDED"
      ? "تم إيقاف الخصم لهذا المستفيد."
      : "لا يوجد رصيد متبقٍ لهذا المستفيد.";

  const blockedReason =
    beneficiary.status === "SUSPENDED"
      ? "السبب: حالة المستفيد موقوف."
      : "تم إيقاف الخصم لأن حالة السجل مكتملة.";

  const isOperationalOldCard = beneficiary.in_import_file || beneficiary.has_replacement_card;

  return (
    <Card className="p-4 sm:p-4.5">
      {/* ─── رأس البطاقة: الاسم والحالة ─── */}
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white sm:text-xl">{beneficiary.name}</h2>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">البطاقة: {beneficiary.card_number}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {beneficiary.in_import_file && (
              <span className="inline-flex items-center rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300">
                ضمن ملف الاستيراد
              </span>
            )}
            {isOperationalOldCard ? (
              <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                بطاقة قديمة
              </span>
            ) : (
              <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                بطاقة مستقرة
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetSearchState}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            اختيار مستفيد آخر
          </button>
          <Badge variant={statusVariant}>
            {statusLabel}
          </Badge>
        </div>
      </div>

      {/* ─── الأرصدة ─── */}
      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">إجمالي الرصيد</p>
          <p className="text-base font-black text-slate-700 dark:text-slate-200">{formatCurrency(beneficiary.total_balance)} د.ل</p>
        </div>
        <div className={cn(
          "rounded-md p-3",
          beneficiary.remaining_balance < 50
            ? "border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30"
            : "border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
        )}>
          <p className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المتبقي</p>
          <p className={cn(
            "text-xl font-black",
            beneficiary.remaining_balance < 50 ? "text-amber-600 dark:text-amber-400" : "text-primary dark:text-blue-400"
          )}>
            {formatCurrency(beneficiary.remaining_balance)} د.ل
          </p>
          {beneficiary.remaining_balance < 50 && beneficiary.remaining_balance > 0 && (
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-500">
              الرصيد أوشك على النفاد
            </p>
          )}
        </div>
      </div>

      {beneficiary.has_replacement_card && beneficiary.replacement_card_number && (
        <div className="mb-4 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-300">
          تنبيه: هذا المستفيد يستخدم بطاقة قديمة، والبطاقة الأحدث المقابلة هي: {beneficiary.replacement_card_number}
        </div>
      )}

      {beneficiary.in_import_file && !beneficiary.has_replacement_card && (
        <div className="mb-4 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-300">
          تنبيه: هذه البطاقة من البطاقات القديمة التشغيلية حتى يتم إصدار البطاقات الجديدة.
        </div>
      )}

      {/* ─── نموذج الخصم أو رسالة المكتمل ─── */}
      {beneficiary.status === "ACTIVE" && beneficiary.remaining_balance > 0 ? (
        <DeductionAction />
      ) : (
        <div className={cn(
          "rounded-md border p-4 text-center",
          beneficiary.status === "SUSPENDED"
            ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
        )}>
          <AlertCircle className={cn(
            "mx-auto mb-2 h-8 w-8",
            beneficiary.status === "SUSPENDED"
              ? "text-red-500 dark:text-red-400"
              : "text-slate-400 dark:text-slate-500"
          )} />
          <p className={cn(
            "font-black",
            beneficiary.status === "SUSPENDED"
              ? "text-red-700 dark:text-red-300"
              : "text-slate-700 dark:text-slate-200"
          )}>{blockedTitle}</p>
          <p className={cn(
            "mt-1 text-sm",
            beneficiary.status === "SUSPENDED"
              ? "text-red-600 dark:text-red-400"
              : "text-slate-500 dark:text-slate-400"
          )}>{blockedReason}</p>
        </div>
      )}
    </Card>
  );
}
