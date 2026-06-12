"use client";

/**
 * BeneficiaryCard
 * ===============
 * مكوّن عرض بيانات المستفيد — يقرأ البيانات من DeductContext فقط.
 * يعرض الاسم، رقم البطاقة، الأرصدة، والحالة. لا يحتوي على أي منطق.
 */

import React from "react";
import { AlertCircle, Shield, Loader2 } from "lucide-react";
import { Card, Badge, cn } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { useDeductContext } from "./DeductContext";
import { DeductionAction } from "./DeductionAction";

export function BeneficiaryCard() {
  const { beneficiary, resetSearchState, policyInfo, policyLoading, type } = useDeductContext();

  if (!beneficiary) return null;

  const isWahda = beneficiary.company?.code === "WAB" || beneficiary.company?.code === "WAAD" || beneficiary.company?.name?.includes("الوحدة");
  const isNonTpa = isWahda && (type === "GENERAL" || type === "MEDICINE" || type === "SUPPLIES");

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
  
  // نحدد ما إذا كان الحساب "مفتوحاً" بناءً على السياسة المكتشفة للخدمة الحالية
  // لمصرف الوحدة: الأسنان مفتوح، لكن الكشف العام محدود بـ 600
  const showUnlimited = policyInfo?.isTpa && (policyInfo.ceiling === null || policyInfo.ceiling === 0);

  return (
    <Card className="p-4">
      {/* ─── رأس البطاقة: الاسم والحالة ─── */}
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">{beneficiary.name}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">البطاقة: {beneficiary.card_number}</p>
            {beneficiary.company && !isNonTpa && (
              <Badge variant="info" className="text-[10px] py-0 px-2 h-5 flex items-center gap-1 border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {beneficiary.company.logo ? (
                  <img src={beneficiary.company.logo} alt="Company Logo" className="h-3 w-3 object-contain" />
                ) : (
                  <Shield className="h-3 w-3 text-primary dark:text-blue-400" />
                )}
                {beneficiary.company.name}
              </Badge>
            )}
            {isOperationalOldCard && (
              <Badge variant="warning" className="text-[10px] py-0 px-2 h-5">بطاقة قديمة</Badge>
            )}
            <Badge variant={statusVariant} className="text-[10px] py-0 px-2 h-5">
              {statusLabel}
            </Badge>
          </div>
        </div>
        <button
          type="button"
          onClick={resetSearchState}
          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          تغيير المستفيد
        </button>
      </div>

      {/* ─── السقف - المتبقي ─── */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">
            {!policyLoading && showUnlimited ? "سقف مفتوح" : (policyInfo?.isTpa ? "السقف" : "الرصيد الكلي")}
          </p>
          <p className="text-lg font-black text-slate-700 dark:text-slate-200">
            {policyLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            ) : showUnlimited ? "∞"
              : policyInfo?.isTpa
                ? `${formatCurrency(policyInfo.ceiling || 0)} د.ل`
                : `${formatCurrency(beneficiary.total_balance)} د.ل`
            }
          </p>
        </div>
        {(() => {
          // حساب المتبقي الحقيقي:
          // - سقف مفتوح TPA: يعرض المستهلك
          // - سقف محدود TPA: يعرض السقف - المستهلك
          // - مستفيد عادي: remaining_balance من السجل
          const tpaRemaining = policyInfo?.isTpa && !showUnlimited
            ? Math.max(0, (policyInfo.ceiling || 0) - (policyInfo.consumed || 0))
            : null;
          const displayRemaining = policyInfo?.isTpa
            ? (showUnlimited ? null : tpaRemaining!)
            : beneficiary.remaining_balance;
          const isLow = !policyLoading && !showUnlimited && (displayRemaining ?? 0) < 50;
          return (
            <div className={cn(
              "rounded-md p-3",
              isLow
                ? "border border-amber-200 bg-amber-50"
                : "border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
            )}>
              <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-400">
                {!policyLoading && showUnlimited ? "الرصيد المستهلك" : (policyInfo?.isTpa ? "المتبقي" : "الرصيد المتبقي")}
              </p>
              <p className={cn(
                "text-xl font-black",
                isLow ? "text-amber-600" : "text-primary dark:text-blue-400"
              )}>
                {policyLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                ) : showUnlimited
                  ? `${formatCurrency(policyInfo?.consumed || 0)} د.ل`
                  : `${formatCurrency(displayRemaining ?? 0)} د.ل`
                }
              </p>
            </div>
          );
        })()}
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

      {/* تم نقل DeductionAction إلى المكون الأب لدعم التوزيع الأفقي */}
      {beneficiary.status !== "ACTIVE" || beneficiary.remaining_balance <= 0 ? (
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
      ) : null}
    </Card>
  );
}
