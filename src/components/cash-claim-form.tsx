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

  const allocated = [...amounts.values()].reduce((s, v) => s + v, 0);
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

function buildEligibleMap(members: FamilyMember[]) {
  return new Map(
    members
      .filter((m) => m.eligible)
      .map((m) => [m.id, m]),
  );
}

function toAllocationMap(allocations: Allocation[]) {
  return new Map(allocations.map((a) => [a.beneficiary_id, a.amount]));
}

function normalizeAllocationMap(map: Map<string, number>, members: FamilyMember[]) {
  const eligibleMap = buildEligibleMap(members);
  const next = new Map<string, number>();

  for (const [beneficiaryId, amount] of map.entries()) {
    const member = eligibleMap.get(beneficiaryId);
    if (!member) continue;
    const normalizedAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (normalizedAmount <= 0) continue;
    next.set(beneficiaryId, Math.min(normalizedAmount, member.remaining_balance));
  }

  return next;
}

function allocationTotal(map: Map<string, number>) {
  let total = 0;
  for (const amount of map.values()) total += amount;
  return total;
}

function fillGap(
  map: Map<string, number>,
  members: FamilyMember[],
  gap: number,
  excludeBeneficiaryId?: string,
) {
  if (gap <= 0) return 0;

  const candidates = members
    .filter((m) => m.eligible && m.id !== excludeBeneficiaryId)
    .map((m) => {
      const current = map.get(m.id) ?? 0;
      const spare = Math.max(0, m.remaining_balance - current);
      return { member: m, spare };
    })
    .filter((c) => c.spare > 0)
    .sort((a, b) => b.spare - a.spare);

  let remainingGap = gap;
  for (const candidate of candidates) {
    if (remainingGap <= 0) break;
    const current = map.get(candidate.member.id) ?? 0;
    const put = Math.min(candidate.spare, remainingGap);
    map.set(candidate.member.id, current + put);
    remainingGap -= put;
  }

  return remainingGap;
}

function trimOverInvoice(
  map: Map<string, number>,
  members: FamilyMember[],
  over: number,
  excludeBeneficiaryId?: string,
) {
  if (over <= 0) return 0;

  const candidates = members
    .filter((m) => m.eligible && m.id !== excludeBeneficiaryId)
    .map((m) => ({ member: m, current: map.get(m.id) ?? 0 }))
    .filter((c) => c.current > 0)
    .sort((a, b) => b.current - a.current);

  let remainingOver = over;
  for (const candidate of candidates) {
    if (remainingOver <= 0) break;
    const current = map.get(candidate.member.id) ?? 0;
    const cut = Math.min(current, remainingOver);
    const next = current - cut;
    if (next > 0) map.set(candidate.member.id, next);
    else map.delete(candidate.member.id);
    remainingOver -= cut;
  }

  return remainingOver;
}

function mapToAllocations(map: Map<string, number>, members: FamilyMember[]): Allocation[] {
  return members
    .map((m) => ({ beneficiary_id: m.id, amount: map.get(m.id) ?? 0 }))
    .filter((a) => a.amount > 0);
}

function rebalanceAllocationsForEdit(params: {
  members: FamilyMember[];
  previousAllocations: Allocation[];
  beneficiaryId: string;
  requestedAmount: number;
  invoiceTotal: number;
}) {
  const { members, previousAllocations, beneficiaryId, requestedAmount, invoiceTotal } = params;
  const member = members.find((m) => m.id === beneficiaryId);
  if (!member || !member.eligible) {
    return {
      allocations: previousAllocations,
      remainingGap: Math.max(0, invoiceTotal - previousAllocations.reduce((s, a) => s + a.amount, 0)),
      cappedByBalance: false,
      appliedAmount: 0,
    };
  }

  const normalizedRequested = Math.max(0, Math.floor(Number(requestedAmount) || 0));
  const appliedAmount = Math.min(normalizedRequested, member.remaining_balance);
  const cappedByBalance = normalizedRequested > member.remaining_balance;

  const currentMap = normalizeAllocationMap(toAllocationMap(previousAllocations), members);
  if (appliedAmount > 0) currentMap.set(beneficiaryId, appliedAmount);
  else currentMap.delete(beneficiaryId);

  let total = allocationTotal(currentMap);

  if (total < invoiceTotal) {
    const gap = invoiceTotal - total;
    fillGap(currentMap, members, gap, beneficiaryId);
    total = allocationTotal(currentMap);
  } else if (total > invoiceTotal) {
    let over = total - invoiceTotal;
    over = trimOverInvoice(currentMap, members, over, beneficiaryId);
    if (over > 0) {
      const editedCurrent = currentMap.get(beneficiaryId) ?? 0;
      const cutFromEdited = Math.min(editedCurrent, over);
      const nextEdited = editedCurrent - cutFromEdited;
      if (nextEdited > 0) currentMap.set(beneficiaryId, nextEdited);
      else currentMap.delete(beneficiaryId);
    }
    total = allocationTotal(currentMap);
  }

  return {
    allocations: mapToAllocations(currentMap, members),
    remainingGap: Math.max(0, invoiceTotal - total),
    cappedByBalance,
    appliedAmount,
  };
}

function rebalanceRemainingGap(params: {
  members: FamilyMember[];
  previousAllocations: Allocation[];
  invoiceTotal: number;
}) {
  const { members, previousAllocations, invoiceTotal } = params;
  const currentMap = normalizeAllocationMap(toAllocationMap(previousAllocations), members);
  const total = allocationTotal(currentMap);
  const gap = Math.max(0, invoiceTotal - total);
  const remainingGap = fillGap(currentMap, members, gap);
  return {
    allocations: mapToAllocations(currentMap, members),
    remainingGap,
  };
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

  const remainingToAllocate = useMemo(() => {
    return Math.max(0, invoiceValue - totalAllocated);
  }, [invoiceValue, totalAllocated]);

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

    const member = members.find((m) => m.id === beneficiaryId);
    if (!member) return;
    if (!member.eligible) {
      toast.error(`${member.name} غير مؤهل للتوزيع`);
      return;
    }

    const requestedAmount = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(requestedAmount) || requestedAmount < 0) return;
    if (!Number.isInteger(requestedAmount)) return;

    const result = rebalanceAllocationsForEdit({
      members,
      previousAllocations: allocations,
      beneficiaryId,
      requestedAmount,
      invoiceTotal: invoiceValue,
    });
    setAllocations(result.allocations);

    if (result.cappedByBalance) {
      toast.info(
        `رصيد ${member.name} لا يكفي. تم اعتماد ${formatNumber(result.appliedAmount)} د.ل له، ونقل الفرق تلقائياً لباقي العائلة قدر الإمكان.`,
      );
    } else if (result.remainingGap > 0) {
      toast.error(
        `تعذر تغطية كامل الفاتورة. المتبقي غير مغطى: ${formatNumber(result.remainingGap)} د.ل`,
      );
    }
  };

  const completeRemainingGap = () => {
    if (!Number.isInteger(invoiceValue) || invoiceValue <= 0) {
      toast.error("أدخل قيمة الفاتورة أولاً");
      return;
    }
    const result = rebalanceRemainingGap({
      members,
      previousAllocations: allocations,
      invoiceTotal: invoiceValue,
    });
    setAllocations(result.allocations);
    if (result.remainingGap === 0) {
      toast.success("تم إكمال الفرق المتبقي تلقائياً بنجاح");
    } else {
      toast.error(`لا تزال هناك قيمة غير مغطاة: ${formatNumber(result.remainingGap)} د.ل`);
    }
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

          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
            عند تعديل مبلغ أي فرد، يتم نقل الفرق تلقائياً لباقي الأفراد المؤهلين ضمن حدود أرصدتهم ودون تجاوز قيمة الفاتورة.
          </p>

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
          <div className="text-sm text-slate-600 dark:text-slate-300">
            المتبقي للتغطية: <strong>{formatNumber(remainingToAllocate)}</strong> د.ل
          </div>
          <div className="pt-1">
            {totalAllocated === invoiceValue && invoiceValue > 0 ? (
              <Badge variant="success">التوزيع متطابق</Badge>
            ) : (
              <Badge variant="warning">التوزيع غير مكتمل</Badge>
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={members.length === 0 || !invoiceTotal || remainingToAllocate <= 0}
            onClick={completeRemainingGap}
          >
            إكمال الفرق تلقائياً
          </Button>
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
                          max={m.remaining_balance}
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
