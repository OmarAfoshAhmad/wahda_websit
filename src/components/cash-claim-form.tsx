"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { lookupFamily, executeCashClaim, type FamilyMember } from "@/app/actions/cash-claim";
import { searchBeneficiaries } from "@/app/actions/beneficiary";
import { Card, Button, Input, Badge } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ConfirmationModal } from "@/components/confirmation-modal";

type Allocation = {
  beneficiary_id: string;
  amount: number;
};

type Props = {
  facilities: Array<{ id: string; name: string }>;
  showFacilityPicker: boolean;
};

function formatNumber(value: number) {
  return value.toLocaleString("ar-LY", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function extractCardCandidate(value: string): string {
  const raw = value.trim();
  if (!raw) return "";

  const embeddedCard = raw.match(/(WAB[0-9A-Z٠-٩۰-۹]+)/i);
  if (embeddedCard?.[1]) return embeddedCard[1];

  const tail = raw.split(/[-–—]/).pop()?.trim();
  return tail || raw;
}

function autoDistribute(invoiceTotal: number, members: FamilyMember[]): Allocation[] {
  const eligible = members
    .filter((m) => m.eligible)
    .sort((a, b) => b.remaining_balance - a.remaining_balance);

  if (eligible.length === 0 || invoiceTotal <= 0) return [];

  const caps = new Map(eligible.map((m) => [m.id, m.remaining_balance]));
  const amounts = new Map<string, number>(eligible.map((m) => [m.id, 0]));

  // توزيع أولي متساوٍ
  const baseShare = Math.floor(invoiceTotal / eligible.length);
  for (const member of eligible) {
    if (baseShare <= 0) break;
    const cap = caps.get(member.id) ?? 0;
    const put = Math.min(baseShare, cap);
    amounts.set(member.id, put);
  }

  let allocated = [...amounts.values()].reduce((s, v) => s + v, 0);
  let remaining = invoiceTotal - allocated;

  // إعادة توزيع الباقي على من لديهم سعة متبقية
  while (remaining > 0) {
    let progressed = false;
    for (const member of eligible) {
      if (remaining <= 0) break;
      const current = amounts.get(member.id) ?? 0;
      const cap = caps.get(member.id) ?? 0;
      if (current < cap) {
        amounts.set(member.id, current + 1);
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  return eligible
    .map((m) => ({ beneficiary_id: m.id, amount: amounts.get(m.id) ?? 0 }))
    .filter((a) => a.amount > 0);
}

export function CashClaimForm({ facilities, showFacilityPicker }: Props) {
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [baseCard, setBaseCard] = useState("");
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [facilityNameInput, setFacilityNameInput] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  const [loadingLookup, setLoadingLookup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const invoiceValue = Number(invoiceTotal || 0);

  const allocationById = useMemo(() => {
    return new Map(allocations.map((a) => [a.beneficiary_id, a.amount]));
  }, [allocations]);

  const totalAvailable = useMemo(() => {
    return members.filter((m) => m.eligible).reduce((s, m) => s + m.remaining_balance, 0);
  }, [members]);

  const totalAllocated = useMemo(() => {
    return allocations.reduce((s, a) => s + a.amount, 0);
  }, [allocations]);

  const canSubmit =
    members.length > 0 &&
    Number.isFinite(invoiceValue) &&
    invoiceValue > 0 &&
    Number.isInteger(invoiceValue) &&
    totalAllocated === invoiceValue &&
    allocations.length > 0;

  const findFamily = async () => {
    const candidate = extractCardCandidate(query);
    if (!candidate || candidate.trim().length < 2) {
      toast.error("أدخل اسم المستفيد أو رقم البطاقة");
      return;
    }

    setLoadingLookup(true);
    try {
      const result = await lookupFamily(candidate);
      if (result.error) {
        toast.error(result.error);
        setMembers([]);
        setBaseCard("");
        setAllocations([]);
        return;
      }

      const foundMembers = result.members ?? [];
      setMembers(foundMembers);
      setBaseCard(result.baseCard ?? "");

      const eligibleCount = foundMembers.filter((m) => m.eligible).length;
      if (eligibleCount === 0) {
        toast.error("لا يوجد أفراد مؤهلون للتوزيع في هذه العائلة");
        setAllocations([]);
      } else {
        if (Number.isInteger(invoiceValue) && invoiceValue > 0) {
          const generated = autoDistribute(invoiceValue, foundMembers);
          setAllocations(generated);
        } else {
          setAllocations([]);
        }
        toast.success(`تم العثور على ${foundMembers.length} فرد (المؤهلون: ${eligibleCount})`);
      }
    } finally {
      setLoadingLookup(false);
      setShowSuggestions(false);
    }
  };

  const applyAutoDistribution = () => {
    if (!Number.isFinite(invoiceValue) || invoiceValue <= 0) {
      toast.error("أدخل قيمة فاتورة صحيحة أولاً");
      return;
    }
    if (!Number.isInteger(invoiceValue)) {
      toast.error("لا يُسمح بالمبالغ العشرية");
      return;
    }

    if (invoiceValue > totalAvailable) {
      toast.error(`قيمة الفاتورة (${formatNumber(invoiceValue)}) أكبر من إجمالي الرصيد المتاح (${formatNumber(totalAvailable)})`);
      return;
    }

    const generated = autoDistribute(invoiceValue, members);
    setAllocations(generated);
    toast.info("تم التوزيع التلقائي. يمكنك تعديل المبالغ يدوياً قبل التأكيد");
  };

  const setMemberAmount = (beneficiaryId: string, raw: string) => {
    if (!Number.isInteger(invoiceValue) || invoiceValue <= 0) {
      toast.error("أدخل قيمة الفاتورة أولاً");
      return;
    }

    if (raw === "") {
      setAllocations((prev) => {
        const prevTotal = prev.reduce((s, a) => s + a.amount, 0);
        const oldAmount = prev.find((a) => a.beneficiary_id === beneficiaryId)?.amount ?? 0;
        const nextTotal = prevTotal - oldAmount;
        if (nextTotal > invoiceValue) return prev;
        return prev.filter((a) => a.beneficiary_id !== beneficiaryId);
      });
      return;
    }

    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) return;
    if (!Number.isInteger(amount)) return;

    const member = members.find((m) => m.id === beneficiaryId);
    if (!member) return;

    if (amount > member.remaining_balance) {
      toast.error(`لا يمكن تجاوز رصيد ${member.name}`);
      return;
    }

    setAllocations((prev) => {
      const prevTotal = prev.reduce((s, a) => s + a.amount, 0);
      const oldAmount = prev.find((a) => a.beneficiary_id === beneficiaryId)?.amount ?? 0;
      const nextTotal = prevTotal - oldAmount + amount;
      if (nextTotal > invoiceValue) {
        toast.error("لا يمكن تجاوز قيمة الفاتورة في مجموع التوزيع");
        return prev;
      }

      const rest = prev.filter((a) => a.beneficiary_id !== beneficiaryId);
      if (amount === 0) return rest;
      return [...rest, { beneficiary_id: beneficiaryId, amount }];
    });
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestionLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      try {
        const result = await searchBeneficiaries(q);
        if (cancelled) return;
        setSuggestions(Array.isArray(result.items) ? result.items : []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSuggestionLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!searchBoxRef.current?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const submitClaim = async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const selectedFacility = facilities.find((f) => f.name === facilityNameInput || f.id === facilityNameInput);
      const res = await executeCashClaim({
        allocations,
        invoiceTotal: invoiceValue,
        facilityId: selectedFacility?.id,
        requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      });

      if (res.error) {
        toast.error(res.error);
        return;
      }

      toast.success(res.success ?? "تم تنفيذ العملية بنجاح");
      setInvoiceTotal("");
      setAllocations([]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2 relative" ref={searchBoxRef}>
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">اسم المستفيد أو رقم البطاقة</label>
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(e.target.value.trim().length >= 2);
                }}
                onFocus={() => setShowSuggestions(query.trim().length >= 2)}
                placeholder="مثال: 12345W1 أو اسم المستفيد"
              />

              {showSuggestions && (suggestionLoading || suggestions.length > 0) && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {suggestionLoading ? (
                    <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">جارٍ البحث...</div>
                  ) : (
                    suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-right hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 last:border-b-0"
                        onClick={() => {
                          setQuery(`${item.name} - ${item.card_number}`);
                          setShowSuggestions(false);
                        }}
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{item.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{item.card_number}</p>
                        </div>
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                          {formatNumber(item.remaining_balance)} د.ل
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">قيمة الفاتورة</label>
              <Input
                type="number"
                min={1}
                step={1}
                value={invoiceTotal}
                onChange={(e) => setInvoiceTotal(e.target.value)}
                placeholder="أدخل قيمة الفاتورة بدون كسور"
              />
            </div>
          </div>

          {showFacilityPicker && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">المرفق (اختياري)</label>
              <Input
                list="cash-claim-facilities"
                value={facilityNameInput}
                onChange={(e) => setFacilityNameInput(e.target.value)}
                placeholder="اختر اسم مرفق"
              />
              <datalist id="cash-claim-facilities">
                {facilities.map((f) => (
                  <option key={f.id} value={f.name} />
                ))}
              </datalist>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={findFamily} disabled={loadingLookup || query.trim().length < 2}>
              {loadingLookup ? "جارٍ البحث..." : "بحث عن العائلة"}
            </Button>
            <Button type="button" variant="secondary" onClick={applyAutoDistribution} disabled={members.length === 0 || !invoiceTotal}>
              توزيع تلقائي
            </Button>
            <Button type="button" variant="outline" onClick={() => setAllocations([])} disabled={allocations.length === 0}>
              تصفير التوزيع
            </Button>
          </div>

          {baseCard && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              رقم العائلة الأساسي: <strong>{baseCard}</strong>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-2">
          <h3 className="text-sm font-black text-slate-900 dark:text-white">ملخص</h3>
          <div className="text-sm text-slate-600 dark:text-slate-300">إجمالي المتاح: <strong>{formatNumber(totalAvailable)}</strong> د.ل</div>
          <div className="text-sm text-slate-600 dark:text-slate-300">إجمالي الموزع: <strong>{formatNumber(totalAllocated)}</strong> د.ل</div>
          <div className="text-sm text-slate-600 dark:text-slate-300">قيمة الفاتورة: <strong>{formatNumber(invoiceValue)}</strong> د.ل</div>
          <div className="pt-1">
            {totalAllocated === invoiceValue && invoiceValue > 0 ? (
              <Badge variant="success">التوزيع متطابق</Badge>
            ) : (
              <Badge variant="warning">التوزيع غير مكتمل</Badge>
            )}
          </div>
          <Button
            type="button"
            className="mt-2 w-full"
            disabled={!canSubmit || submitting}
            onClick={() => setConfirmOpen(true)}
          >
            {submitting ? "جارٍ التنفيذ..." : "تأكيد الخصم"}
          </Button>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200">
              <tr>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">رقم البطاقة</th>
                <th className="px-3 py-2 text-right">الحالة</th>
                <th className="px-3 py-2 text-right">الرصيد المتاح</th>
                <th className="px-3 py-2 text-right">المبلغ الموزع</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400">
                    لا توجد بيانات بعد. ابحث عن عائلة أولاً.
                  </td>
                </tr>
              ) : (
                members.map((m) => {
                  const amount = allocationById.get(m.id) ?? 0;
                  return (
                    <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-bold text-slate-900 dark:text-slate-100">{m.name}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{m.card_number}</td>
                      <td className="px-3 py-2">
                        {m.eligible ? <Badge variant="success">مؤهل</Badge> : <Badge variant="danger">غير مؤهل</Badge>}
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{formatNumber(m.remaining_balance)} د.ل</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          disabled={!m.eligible}
                          value={amount === 0 ? "" : String(amount)}
                          onChange={(e) => setMemberAmount(m.id, e.target.value)}
                          placeholder={m.eligible ? "0" : "غير متاح"}
                          className="h-9"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submitClaim}
        title="تأكيد الخصم"
        description={`سيتم خصم ${formatNumber(invoiceValue)} د.ل من ${allocations.length} عضو. هل تريد المتابعة؟`}
        confirmLabel="نعم، تأكيد الخصم"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={submitting}
      />
    </>
  );
}
