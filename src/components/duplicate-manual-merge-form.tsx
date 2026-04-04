"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { AlertTriangle } from "lucide-react";
import { BeneficiaryEditModal } from "@/components/beneficiary-edit-modal";

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

export function DuplicateManualMergeForm({
  members,
  preferredId,
  q,
  pz,
  pn,
  action,
  helperText,
  hasBirthDateConflict,
}: {
  members: Member[];
  preferredId: string;
  q: string;
  pz: number;
  pn: number;
  action: (formData: FormData) => void | Promise<void>;
  helperText?: string;
  /** عند true: الأعضاء لديهم تواريخ ميلاد مختلفة — قد يكونون أشخاصاً مختلفين فعلاً */
  hasBirthDateConflict?: boolean;
}) {
  const initialKeep = members.some((m) => m.id === preferredId) ? preferredId : members[0]?.id ?? "";
  const [keepId, setKeepId] = useState(initialKeep);

  return (
    <form action={action} className="mb-3 rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-2">
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
        <span className="font-bold text-slate-700 dark:text-slate-300">دمج مخصص:</span>
        <span className="text-slate-500 dark:text-slate-400">{helperText ?? "اختر سجلًا واحدًا للإبقاء، والباقي سيتم حذفه ناعمًا تلقائيًا"}</span>
        <input type="hidden" name="q" value={q} />
        <input type="hidden" name="pz" value={String(pz)} />
        <input type="hidden" name="pn" value={String(pn)} />
        {members.map((m) => (
          <input key={`mid-${m.id}`} type="hidden" name="member_ids" value={m.id} />
        ))}
        <Button type="submit" className="h-8 px-3 text-xs">تطبيق الدمج المخصص</Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400">
              <th className="py-1 px-2">إبقاء</th>
              <th className="py-1 px-2">الاسم</th>
              <th className="py-1 px-2">رقم البطاقة</th>
              <th className="py-1 px-2">رب الأسرة</th>
              <th className="py-1 px-2">الصلة</th>
              <th className="py-1 px-2">الرصيد</th>
              <th className="py-1 px-2">الحالة</th>
              <th className="py-1 px-2">تاريخ الميلاد</th>
              <th className="py-1 px-2">المعاملات</th>
              <th className="py-1 px-2">إجراءات</th>
              <th className="py-1 px-2">القرار</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isKeep = keepId === m.id;
              const { label: statusLabel, color: statusColor } = translateStatus(m.status);
              const birthDateStr = m.birth_date
                ? new Date(m.birth_date).toLocaleDateString("ar-LY", { year: "numeric", month: "2-digit", day: "2-digit" })
                : "—";
              return (
                <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 px-2">
                    <input
                      type="radio"
                      name="keep_id"
                      value={m.id}
                      checked={isKeep}
                      onChange={() => setKeepId(m.id)}
                      aria-label={`إبقاء ${m.name}`}
                    />
                  </td>
                  <td className="py-1 px-2 font-bold text-slate-900 dark:text-white">{m.name}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300">{m.card_number}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300 font-bold">{m.head_of_household ?? "—"}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300">{m.relationship ?? "—"}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300">{Number(m.remaining_balance).toLocaleString("ar-LY")} د.ل</td>
                  <td className={`py-1 px-2 font-medium ${statusColor}`}>{statusLabel}</td>
                  <td className="py-1 px-2 text-slate-600 dark:text-slate-400 text-xs">{birthDateStr}</td>
                  <td className="py-1 px-2 text-slate-700 dark:text-slate-300">{m.transactionsCount}</td>
                  <td className="py-1 px-2">
                    <BeneficiaryEditModal
                      beneficiary={{
                        id: m.id,
                        name: m.name,
                        card_number: m.card_number,
                        birth_date: m.birth_date ? new Date(m.birth_date).toISOString().slice(0, 10) : "",
                        status: m.status as any,
                        total_balance: m.total_balance,
                        remaining_balance: m.remaining_balance,
                      }}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <div className="flex items-center gap-2">
                      {isKeep ? (
                        <span className="text-emerald-700 dark:text-emerald-400 text-xs font-black">إبقاء</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 text-xs font-black">حذف ناعم</span>
                      )}
                    </div>
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
