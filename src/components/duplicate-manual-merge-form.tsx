"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { AlertTriangle, Loader2 } from "lucide-react";
import { BeneficiaryEditModal } from "@/components/beneficiary-edit-modal";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/money";

type Member = {
  id: string;
  name: string;
  card_number: string;
  birth_date?: Date | null;
  relationship?: string | null;
  head_of_household?: string | null;
  status: string;
  transactionsCount: number;
  total_balance: number;
  remaining_balance: number;
};

/** ترجمة حالة المستفيد من الإنجليزية إلى العربية */
function translateStatus(status: string): { label: string; color: string } {
  switch (status) {
    case "ACTIVE":
      return { label: "نشط", color: "text-emerald-700 dark:text-emerald-400" };
    case "FINISHED":
      return { label: "مكتمل", color: "text-slate-500 dark:text-slate-400" };
    case "SUSPENDED":
      return { label: "موقوف", color: "text-red-600 dark:text-red-400" };
    default:
      return { label: status, color: "text-slate-600 dark:text-slate-300" };
  }
}

function getRelationshipInfo(cardNumber: string) {
  const match = cardNumber.match(/^(.*?)([WSDMFHV])(\d+)$/i);
  if (!match) {
    return { headCard: "—", relation: "رب أسرة (أساسي)" };
  }
  const [, base, type, num] = match;
  let relLabel = "تابع";
  switch (type.toUpperCase()) {
    case 'W': relLabel = `زوجة (${num})`; break;
    case 'S': relLabel = `ابن (${num})`; break;
    case 'D': relLabel = `ابنة (${num})`; break;
    case 'M': relLabel = `أم (${num})`; break;
    case 'F': relLabel = `أب (${num})`; break;
    case 'H': relLabel = `زوج (${num})`; break;
    case 'V': relLabel = `أخرى (${num})`; break;
  }
  return { headCard: base, relation: relLabel };
}

export function DuplicateManualMergeForm({
  members,
  preferredId,
  q,
  pz,
  pn,
  action,
  helperText: _helperText,
  hasBirthDateConflict,
  formId,
}: {
  members: Member[];
  preferredId: string;
  q: string;
  pz: number;
  pn: number;
  action: (formData: FormData) => Promise<{ error?: string; ok?: string } | void>;
  helperText?: string;
  /** عند true: الأعضاء لديهم تواريخ ميلاد مختلفة — قد يكونون أشخاصاً مختلفين فعلاً */
  hasBirthDateConflict?: boolean;
  formId?: string;
}) {
  const [actions, setActions] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    const getBase = (n: string) => n.replace(/[^A-Za-z0-9]/g, "").replace(/[A-Za-z]+$/, "").toUpperCase();
    
    const prefMember = members.find(m => m.id === preferredId);
    const prefBaseCard = prefMember ? getBase(prefMember.card_number) : "";

    members.forEach(m => {
      // Default to merge if base cards perfectly match, otherwise keep independent
      if (prefBaseCard && getBase(m.card_number) === prefBaseCard && members.length > 1) {
        map[m.id] = preferredId;
      } else {
        map[m.id] = m.id;
      }
    });
    return map;
  });
  const [isMerged, setIsMerged] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { success, error } = useToast();

  if (isMerged) return null;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const res = await action(formData);
        if (res && res.error) {
          error(res.error);
        } else if (res && res.ok) {
          success(res.ok);
          setIsMerged(true);
        } else {
          setIsMerged(true); // Fallback
          success("تمت العملية بنجاح");
        }
      } catch (_err) {
        error("حدث خطأ غير متوقع. يرجى المحاولة لاحقا.");
      }
    });
  }

  return (
    <form id={formId} action={handleSubmit} className="mb-3 rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-2">
      {/* تحذير تعارض تاريخ الميلاد */}
      {hasBirthDateConflict && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <strong>تحذير:</strong> تواريخ الميلاد مختلفة الأعضاء — قد يكونون أشخاصاً مختلفين. تحقق يدوياً قبل الدمج.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="q" value={q} />
        <input type="hidden" name="pz" value={String(pz)} />
        <input type="hidden" name="pn" value={String(pn)} />
        {members.map((m) => (
          <input key={`mid-${m.id}`} type="hidden" name="member_ids" value={m.id} />
        ))}
        {!formId && (
          <Button type="submit" disabled={isPending} className="h-8 px-3 text-xs flex items-center gap-2">
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {isPending ? "جاري التطبيق..." : "دمج فردي"}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400">
              <th className="py-1 px-2 w-55">الإجراء المخصص</th>
              <th className="py-1 px-2">الاسم</th>
              <th className="py-1 px-2">رقم البطاقة</th>
              <th className="py-1 px-2">عائلة بطاقة ذكية</th>
              <th className="py-1 px-2">الرصيد</th>
              <th className="py-1 px-2">الحالة</th>
              <th className="py-1 px-2 text-center">المعاملات</th>
              <th className="py-1 px-2 text-left">تعديل</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const { label: statusLabel, color: statusColor } = translateStatus(m.status);
              const { headCard } = getRelationshipInfo(m.card_number);

              return (
                <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 px-2">
                    <select
                      name={`action_${m.id}`}
                      value={actions[m.id]}
                      onChange={(e) => setActions({ ...actions, [m.id]: e.target.value })}
                      className={`w-full text-xs py-1.5 px-2 rounded-md border focus:outline-none focus:ring-1 bg-white dark:bg-slate-900 ${
                        actions[m.id] === m.id 
                          ? "border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500 font-bold text-emerald-700 dark:text-emerald-400"
                          : "border-red-300 focus:border-red-500 focus:ring-red-500 font-bold text-red-600 dark:text-red-400"
                      }`}
                    >
                      <option value={m.id}>🟢 إبقاء كشخص مستقل</option>
                      {members.filter(t => t.id !== m.id).map(t => (
                        <option key={`target-${t.id}`} value={t.id}>
                          🔴 دمج مع ⟵ {t.card_number}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-2 font-bold text-slate-900 dark:text-white">{m.name}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300 break-all w-45">{m.card_number}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-400 text-xs font-bold leading-tight">
                    {m.head_of_household ? (
                      <>
                        <span className="block text-slate-900 dark:text-slate-200">{m.head_of_household}</span>
                        <span className="block text-[10px] text-slate-500 font-mono mt-0.5">{headCard}</span>
                      </>
                    ) : (
                      <span className="font-mono">{headCard}</span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300">{formatCurrency(Number(m.remaining_balance))} د.ل</td>
                  <td className={`py-1 px-2 font-medium ${statusColor}`}>{statusLabel}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300 text-center">{m.transactionsCount}</td>
                  <td className="py-1 px-2">
                    <BeneficiaryEditModal
                      beneficiary={{
                        id: m.id,
                        name: m.name,
                        card_number: m.card_number,
                        birth_date: m.birth_date ? new Date(m.birth_date).toISOString().slice(0, 10) : "",
                        status: m.status as "ACTIVE" | "FINISHED" | "SUSPENDED",
                        total_balance: m.total_balance,
                        remaining_balance: m.remaining_balance,
                      }}
                    />
                  </td>
                  
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
