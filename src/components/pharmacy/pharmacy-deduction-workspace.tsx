"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Building2, FileText, Loader2, LockKeyhole, Paperclip, Phone, Plus, Search, Upload, UserRound } from "lucide-react";
import { createPharmacyPrescription, getPharmacyBeneficiaryWorkspace, reservePharmacyPrescriptionItems, searchPharmacyBeneficiaries, uploadPharmacyPrescriptionAttachment } from "@/app/actions/pharmacy";
import { Button, Card, Input } from "@/components/ui";

type Category = {
  value: "ROUTINE" | "CHRONIC" | "CHEMICAL";
  label: string;
  ceiling: number | null;
  coverage: number;
  frequencyMonths: number | null;
  prescriptionLimit: number | null;
  attachmentRequired: boolean;
  maxAttachments: number;
};

type SearchItem = {
  id: string;
  card_number: string;
  name: string;
  phone_number: string | null;
  status: string;
};

type WorkspaceBeneficiary = SearchItem & {
  birth_date: string | null;
  company: { id: string; name: string; code: string; logo: string | null } | null;
  pharmacy_dispenses: Array<{
    id: string;
    medicine_category: "ROUTINE" | "CHRONIC" | "CHEMICAL";
    gross_total: number;
    status: string;
    created_at: string;
    facility_id: string;
    facility: { name: string };
    owned_by_current_facility: boolean;
    items: Array<{ sequence: number; price: number }>;
  }>;
  pharmacy_prescriptions: Array<{
    id: string;
    prescription_number: number;
    medicine_category: Category["value"];
    total_item_count: number;
    created_at: string;
    created_by_facility: { id: string; name: string };
    attachments: Array<{ id: string; file_name: string; mime_type: string; created_at: string }>;
    slots: Array<{
      id: string;
      sequence: number;
      status: "AVAILABLE" | "RESERVED" | "DISPENSED";
      reservation_expires_at: string | null;
      reserved_by_facility: { id: string; name: string } | null;
      dispensed_by_facility: { id: string; name: string } | null;
      reserved_by_current_facility: boolean;
      dispensed_by_current_facility: boolean;
      price: number | null;
    }>;
  }>;
};

export function PharmacyDeductionWorkspace({
  company,
  categories,
  currentFacility,
}: {
  company: { id: string; name: string; code: string; logo: string | null };
  categories: Category[];
  currentFacility: { id: string; name: string };
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [beneficiary, setBeneficiary] = useState<WorkspaceBeneficiary | null>(null);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [category, setCategory] = useState<Category["value"]>(categories[0]?.value ?? "ROUTINE");
  const [selectedSequences, setSelectedSequences] = useState<number[]>([]);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [activePrescriptionId, setActivePrescriptionId] = useState<string | null>(null);
  const [newPrescriptionItemCount, setNewPrescriptionItemCount] = useState("5");
  const [searching, startSearch] = useTransition();
  const [loadingBeneficiary, startBeneficiaryLoad] = useTransition();
  const [updatingPrescription, startPrescriptionUpdate] = useTransition();

  const selectedCategory = categories.find((item) => item.value === category) ?? categories[0];
  const gross = useMemo(() => selectedSequences.reduce((sum, sequence) => sum + (Number(prices[sequence]) || 0), 0), [prices, selectedSequences]);
  const companyShare = gross * ((selectedCategory?.coverage ?? 0) / 100);
  const patientShare = gross - companyShare;

  const runSearch = (searchQuery = query) => {
    setError("");
    setHasSearched(true);
    startSearch(async () => {
      const response = await searchPharmacyBeneficiaries(company.id, searchQuery);
      setResults(response.items ?? []);
      if (response.error) setError(response.error);
    });
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (beneficiary || loadingBeneficiary || trimmed.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    const timer = window.setTimeout(() => runSearch(trimmed), 250);
    return () => window.clearTimeout(timer);
    // runSearch deliberately uses the current company id and query snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, beneficiary, loadingBeneficiary, company.id]);

  const selectBeneficiary = (item: SearchItem) => {
    setError("");
    setResults([]);
    setQuery(`${item.name} - ${item.card_number}`);
    startBeneficiaryLoad(async () => {
      const response = await getPharmacyBeneficiaryWorkspace(company.id, item.id);
      if (response.error || !response.beneficiary) {
        setError(response.error ?? "تعذر تحميل بيانات المستفيد");
        return;
      }
      setBeneficiary(response.beneficiary as WorkspaceBeneficiary);
    });
  };

  const categoryLabel = (value: string) => categories.find((item) => item.value === value)?.label ?? value;
  const categoryPrescriptions = beneficiary?.pharmacy_prescriptions.filter((item) => item.medicine_category === category) ?? [];
  const activePrescription = categoryPrescriptions.find((item) => item.id === activePrescriptionId) ?? categoryPrescriptions[0] ?? null;
  const prescriptionLimit = Math.min(4, selectedCategory?.prescriptionLimit ?? 4);

  const reloadBeneficiary = async () => {
    if (!beneficiary) return;
    const response = await getPharmacyBeneficiaryWorkspace(company.id, beneficiary.id);
    if (response.error || !response.beneficiary) {
      setError(response.error ?? "تعذر تحديث الوصفات");
      return;
    }
    setBeneficiary(response.beneficiary as WorkspaceBeneficiary);
  };

  const addPrescription = () => {
    if (!beneficiary) return;
    setError("");
    startPrescriptionUpdate(async () => {
      const response = await createPharmacyPrescription({ companyId: company.id, beneficiaryId: beneficiary.id, category, totalItemCount: Number(newPrescriptionItemCount) });
      if (response.error) { setError(response.error); return; }
      await reloadBeneficiary();
      setActivePrescriptionId(response.prescriptionId ?? null);
      setSelectedSequences([]);
      setPrices({});
    });
  };

  const reserveSelectedItems = () => {
    if (!activePrescription || selectedSequences.length === 0) return;
    setError("");
    startPrescriptionUpdate(async () => {
      const response = await reservePharmacyPrescriptionItems(activePrescription.id, selectedSequences);
      if (response.error) { setError(response.error); return; }
      await reloadBeneficiary();
    });
  };

  const uploadPrescriptionFile = (file: File) => {
    if (!activePrescription) return;
    setError("");
    startPrescriptionUpdate(async () => {
      const formData = new FormData();
      formData.set("prescriptionId", activePrescription.id);
      formData.set("file", file);
      const response = await uploadPharmacyPrescriptionAttachment(formData);
      if (response.error) { setError(response.error); return; }
      await reloadBeneficiary();
    });
  };

  return (
    <div className="space-y-3" dir="rtl">
      <Card className="p-2">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); runSearch(); }}>
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(event) => { setQuery(event.target.value); setBeneficiary(null); }} className="h-10 pr-9" placeholder="ابحث برقم البطاقة أو الاسم أو رقم الهاتف" />
          </div>
          <Button type="submit" disabled={searching || query.trim().length < 2} className="min-w-24">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} بحث
          </Button>
        </form>
        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
        {!beneficiary && query.trim().length >= 2 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            {searching ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جاري البحث عن المستفيدين...</div>
            ) : results.length > 0 ? results.map((item) => (
              <button key={item.id} type="button" onClick={() => selectBeneficiary(item)} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-right last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                <span><strong className="block text-sm">{item.name}</strong><span className="text-xs text-slate-500">{item.card_number}</span></span>
                <span className="text-xs text-slate-500">{item.phone_number || "دون هاتف"}</span>
              </button>
            )) : hasSearched && !error ? (
              <p className="px-3 py-3 text-sm font-bold text-slate-500">لا توجد أسماء مطابقة داخل شركة {company.name}.</p>
            ) : null}
          </div>
        )}
      </Card>

      {loadingBeneficiary && <Card className="flex items-center justify-center gap-2 p-10 text-sm font-bold text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل ملف المستفيد</Card>}

      {beneficiary && !loadingBeneficiary && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Card className="p-4">
              <div className="mb-3 flex items-start justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">{beneficiary.name}</h2>
                  <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${beneficiary.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{beneficiary.status === "ACTIVE" ? "نشط" : "غير نشط"}</span>
                </div>
                <UserRound className="h-8 w-8 text-teal-600" />
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-800"><dt className="text-[10px] font-bold text-slate-400">رقم البطاقة</dt><dd className="font-black">{beneficiary.card_number}</dd></div>
                <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-800"><dt className="flex items-center gap-1 text-[10px] font-bold text-slate-400"><Phone className="h-3 w-3" /> رقم الهاتف</dt><dd className="font-black" dir="ltr">{beneficiary.phone_number || "غير مسجل"}</dd></div>
                <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-800"><dt className="text-[10px] font-bold text-slate-400">شركة التأمين</dt><dd className="font-black">{beneficiary.company?.name}</dd></div>
                <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-800"><dt className="text-[10px] font-bold text-slate-400">تاريخ الميلاد</dt><dd className="font-black">{beneficiary.birth_date ? new Date(beneficiary.birth_date).toLocaleDateString("ar-LY") : "غير مسجل"}</dd></div>
              </dl>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black"><FileText className="h-4 w-4 text-teal-600" /> الوصفات السابقة</h3>
              {beneficiary.pharmacy_dispenses.length === 0 ? <p className="text-xs text-slate-500">لا توجد وصفات مسجلة لهذا المستفيد.</p> : (
                <div className="space-y-2">
                  {beneficiary.pharmacy_dispenses.map((dispense) => (
                    <div key={dispense.id} className="flex items-center justify-between rounded-md border border-slate-200 p-2 dark:border-slate-700">
                      <div>
                        <p className="text-xs font-black">{categoryLabel(dispense.medicine_category)} · {dispense.gross_total.toLocaleString("ar-LY")} د.ل</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">{new Date(dispense.created_at).toLocaleDateString("ar-LY")} · {dispense.facility.name}</p>
                      </div>
                      {dispense.owned_by_current_facility ? (
                        <span className="rounded-full bg-teal-100 px-2 py-1 text-[10px] font-bold text-teal-700">من هذا المرفق</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700"><LockKeyhole className="h-3 w-3" /> مرفق آخر — للعرض فقط</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <div><h2 className="text-lg font-black">الوصفة والأسعار</h2><p className="text-xs text-slate-500">المرفق المنفذ: {currentFacility.name}</p></div>
              <Building2 className="h-6 w-6 text-teal-600" />
            </div>
            <label className="mb-1 block text-xs font-black text-slate-500">نوع الوصفة</label>
            <select value={category} onChange={(event) => { setCategory(event.target.value as Category["value"]); setActivePrescriptionId(null); setSelectedSequences([]); setPrices({}); }} className="mb-3 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900">
              {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>

            <div className="mb-2 grid grid-cols-3 gap-2 rounded-md bg-teal-50 p-2 text-center text-[10px] font-bold text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
              <span>التغطية {selectedCategory?.coverage}%</span>
              <span>السقف {selectedCategory?.ceiling === null ? "مفتوح" : `${selectedCategory?.ceiling} د.ل`}</span>
              <span>{selectedCategory?.frequencyMonths ? `كل ${selectedCategory.frequencyMonths} شهر` : "دون دورة"}</span>
            </div>

            <div className="mb-3 flex flex-wrap items-end justify-between gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <div>
                <p className="text-xs font-black">الوصفات: {categoryPrescriptions.length} من {prescriptionLimit}</p>
                <p className="text-[10px] text-slate-500">أنشئ وصفة ثم أكمل مرفقها وبنودها في البطاقة نفسها.</p>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-[10px] font-bold text-slate-500">عدد البنود
                  <Input className="mt-1 h-8 w-20" type="number" min="1" max="50" value={newPrescriptionItemCount} onChange={(event) => setNewPrescriptionItemCount(event.target.value)} />
                </label>
                <Button type="button" onClick={addPrescription} disabled={updatingPrescription || categoryPrescriptions.length >= prescriptionLimit} className="h-8 px-3 text-xs"><Plus className="h-3.5 w-3.5" /> وصفة جديدة</Button>
              </div>
            </div>

            {categoryPrescriptions.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {categoryPrescriptions.map((prescription) => (
                  <button key={prescription.id} type="button" onClick={() => { setActivePrescriptionId(prescription.id); setSelectedSequences([]); setPrices({}); }} className={`rounded-md border px-3 py-1.5 text-xs font-black ${activePrescription?.id === prescription.id ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/30" : "border-slate-200 dark:border-slate-700"}`}>
                    وصفة {prescription.prescription_number}
                  </button>
                ))}
              </div>
            )}

            {activePrescription ? (
              <div className="overflow-hidden rounded-xl border border-teal-200 dark:border-teal-900">
                <div className="flex items-center justify-between bg-teal-50 px-3 py-2 dark:bg-teal-950/30">
                  <div><p className="text-sm font-black">وصفة رقم {activePrescription.prescription_number}</p><p className="text-[10px] text-slate-500">{activePrescription.total_item_count} بنود · أنشأها {activePrescription.created_by_facility.name}</p></div>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-teal-700 dark:bg-slate-900">{selectedCategory?.label}</span>
                </div>

                <div className="border-b border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="flex items-center gap-1.5 text-xs font-black"><Paperclip className="h-4 w-4 text-teal-600" /> مرفق الوصفة <span className="text-red-500">*</span></p><p className="text-[10px] text-slate-500">إجباري قبل اختيار البنود والأسعار · بحد أقصى {selectedCategory?.maxAttachments ?? 1}</p></div>
                    <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-black ${updatingPrescription || activePrescription.attachments.length >= (selectedCategory?.maxAttachments ?? 1) ? "pointer-events-none opacity-40" : "border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300"}`}>
                      {updatingPrescription ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} إرفاق ملف
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadPrescriptionFile(file); event.target.value = ""; }} />
                    </label>
                  </div>
                  {activePrescription.attachments.length > 0 ? <div className="mt-2 flex flex-wrap gap-1">{activePrescription.attachments.map((attachment) => <div key={attachment.id} className="flex max-w-56 items-center gap-2 rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><Paperclip className="h-3 w-3 shrink-0" /><span className="truncate text-[10px] font-bold">{attachment.file_name}</span></div>)}</div> : <p className="mt-1 text-[10px] font-bold text-amber-600">أرفق ملف الوصفة لتفعيل اختيار البنود والأسعار.</p>}
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-700">
                  {activePrescription.slots.map((slot) => {
                    const expired = slot.reservation_expires_at ? new Date(slot.reservation_expires_at) <= new Date() : false;
                    const reservedElsewhere = slot.status === "RESERVED" && !expired && !slot.reserved_by_current_facility;
                    const dispensed = slot.status === "DISPENSED";
                    const occupiedInAnotherPrescription = categoryPrescriptions
                      .filter((prescription) => prescription.id !== activePrescription.id)
                      .flatMap((prescription) => prescription.slots.map((otherSlot) => ({ prescription, slot: otherSlot })))
                      .find(({ slot: otherSlot }) => {
                        if (otherSlot.sequence !== slot.sequence) return false;
                        if (otherSlot.status === "DISPENSED") return true;
                        return otherSlot.status === "RESERVED" && (!otherSlot.reservation_expires_at || new Date(otherSlot.reservation_expires_at) > new Date());
                      });
                    const hasPrescriptionFile = activePrescription.attachments.length > 0;
                    const selectable = hasPrescriptionFile && !reservedElsewhere && !dispensed && !occupiedInAnotherPrescription;
                    const selected = selectedSequences.includes(slot.sequence);
                    const otherPrescriptionFacility = occupiedInAnotherPrescription?.slot.status === "DISPENSED"
                      ? occupiedInAnotherPrescription.slot.dispensed_by_facility?.name
                      : occupiedInAnotherPrescription?.slot.reserved_by_facility?.name;
                    const statusText = occupiedInAnotherPrescription
                      ? `مستخدم في وصفة ${occupiedInAnotherPrescription.prescription.prescription_number}${otherPrescriptionFacility ? ` · ${otherPrescriptionFacility}` : ""}`
                      : dispensed
                        ? `صُرف بواسطة ${slot.dispensed_by_facility?.name ?? "مرفق آخر"}`
                        : reservedElsewhere
                          ? `محجوز لدى ${slot.reserved_by_facility?.name ?? "مرفق آخر"}`
                          : slot.reserved_by_current_facility ? "محجوز لهذا المرفق" : hasPrescriptionFile ? "متاح" : "أرفق الوصفة أولًا";
                    return (
                      <div key={slot.id} className={`grid grid-cols-[7rem_1fr_9rem] items-center gap-2 px-3 py-2 ${reservedElsewhere || dispensed || occupiedInAnotherPrescription ? "bg-slate-50 opacity-75 dark:bg-slate-900/50" : ""}`}>
                        <label className={`flex items-center gap-2 text-xs font-black ${selectable ? "cursor-pointer" : ""}`}>
                          <input type="checkbox" checked={selected} disabled={!selectable} onChange={() => { setSelectedSequences((current) => selected ? current.filter((value) => value !== slot.sequence) : [...current, slot.sequence].sort((a, b) => a - b)); if (selected) setPrices((current) => { const next = { ...current }; delete next[slot.sequence]; return next; }); }} />
                          البند {slot.sequence}
                        </label>
                        <span className={`flex min-w-0 items-center gap-1 text-[10px] font-bold ${reservedElsewhere || occupiedInAnotherPrescription ? "text-amber-700" : dispensed ? "text-slate-500" : "text-teal-700"}`}>{(reservedElsewhere || dispensed || occupiedInAnotherPrescription) && <LockKeyhole className="h-3 w-3 shrink-0" />}<span className="truncate">{statusText}</span></span>
                        {selected ? <Input className="h-8" type="number" min="0" step="0.01" value={prices[slot.sequence] ?? ""} onChange={(event) => setPrices((current) => ({ ...current, [slot.sequence]: event.target.value }))} placeholder="السعر" aria-label={`سعر البند ${slot.sequence}`} /> : <span className="text-left text-xs font-black text-slate-500">{slot.price === null ? "—" : `${slot.price.toFixed(2)} د.ل`}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                  <span className="text-[10px] font-bold text-slate-500">تم اختيار {selectedSequences.length} بند</span>
                  <Button type="button" onClick={reserveSelectedItems} disabled={updatingPrescription || activePrescription.attachments.length === 0 || selectedSequences.length === 0} className="h-8 text-xs">{updatingPrescription && <Loader2 className="h-3.5 w-3.5 animate-spin" />} حجز البنود المحددة</Button>
                </div>
              </div>
            ) : <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-xs font-bold text-slate-500 dark:border-slate-700">لا توجد وصفة. حدد عدد البنود واضغط «وصفة جديدة».</div>}

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-center dark:border-slate-800">
              <div><p className="text-[10px] text-slate-400">الإجمالي</p><p className="font-black">{gross.toFixed(2)} د.ل</p></div>
              <div><p className="text-[10px] text-slate-400">الشركة</p><p className="font-black text-teal-600">{companyShare.toFixed(2)} د.ل</p></div>
              <div><p className="text-[10px] text-slate-400">المستفيد</p><p className="font-black text-amber-600">{patientShare.toFixed(2)} د.ل</p></div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
