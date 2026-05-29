"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Trash2, Loader2, CheckSquare, Square, CheckCircle, Edit3, X, CreditCard } from "lucide-react";
import {
  deleteTruthRegistryRowsAction,
  deleteFilteredTruthRegistryAction,
  bulkUpdateTruthRegistryBatchAction,
  applySuggestedTruthMatchAction,
  applySuggestedTruthMatchesAction,
  applySuggestedTruthMatchesByFilterAction,
  getFamilyNumberingMismatchContextAction,
  resolveFamilyNumberingMismatchAction,
  prepareTruthMigrationNumberingConflictsAction,
  migrateTruthRowsToSystemAction,
  migrateFilteredTruthRowsToSystemAction,
  softDeleteBeneficiaryRowsAction,
  softDeleteFilteredBeneficiariesAction,
} from "@/app/actions/truth-registry";
import { useEffect } from "react";

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
  similar_truth_card?: string | null;
  similar_truth_name?: string | null;
  similar_truth_batch?: string | null;
  similar_reason?: string | null;
};

type FamilyNumberingOption = {
  canonical_card: string;
  card_number: string;
  from_system: boolean;
  from_truth: boolean;
  system_count: number;
  truth_count: number;
  is_current: boolean;
};

type FamilyNumberingSystemMember = {
  id: string;
  name: string;
  card_number: string;
  canonical_card: string;
  birth_date: Date | string | null;
  batch_number: string | null;
  city: string | null;
  created_at: Date | string;
};

type FamilyNumberingTruthRow = {
  id: string;
  card_number: string;
  canonical_card: string;
  beneficiary_name: string | null;
  birth_date: Date | string | null;
  batch_number: string | null;
  city: string;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  updated_at: Date | string;
};

type FamilyNumberingContext = {
  anchor: {
    id: string;
    name: string;
    card_number: string;
    canonical_card: string;
    birth_date: Date | string | null;
    batch_number: string | null;
    city: string | null;
    family_base: string;
  };
  options: FamilyNumberingOption[];
  recommended_card: string;
  system_same_person: FamilyNumberingSystemMember[];
  truth_same_person: FamilyNumberingTruthRow[];
  system_family: FamilyNumberingSystemMember[];
  truth_family: FamilyNumberingTruthRow[];
  family_standard_plan?: Array<{
    person_key: string;
    name: string;
    birth_date: string;
    relation_code: "MAIN" | "W" | "H" | "M" | "F" | "S" | "D" | "B";
    target_card: string;
    current_cards: string[];
    sources: Array<"system" | "truth">;
    system_cards?: string[];
    truth_cards?: string[];
  }>;
};

type MigrationNumberingConflictMode = "skip" | "merge_use_truth" | "keep_system" | "manual_review";

type MigrationNumberingConflictPreview = {
  person_key: string;
  truth_row_id: string;
  beneficiary_id: string;
  truth_card: string;
  truth_canonical: string;
  truth_name: string;
  truth_birth: string;
  truth_batch: string | null;
  system_cards: string[];
};

interface TruthRegistryTableProps {
  rows: RegistryRow[];
  totalCount: number;
  filters: {
    query: string;
    city: string;
    batch: string;
    system_primary?: boolean;
    multi: boolean;
    not_in_system: boolean;
    in_system_not_in_registry?: boolean;
    similar_only?: boolean;
    similar_numeric?: boolean;
    similar_name_birth?: boolean;
    similar_family_suffix?: boolean;
    family_numbering_mismatch?: boolean;
    multi_person_cards?: boolean;
    legacy_has_batch?: boolean;
    legacy_no_batch?: boolean;
    sort?: string;
  };
}

export function TruthRegistryTable({ rows, totalCount, filters }: TruthRegistryTableProps) {
  const router = useRouter();
  const { success, error } = useToast();
  
  // معرفات العناصر المحددة
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAllDatabaseSelected, setIsAllDatabaseSelected] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setSelectedIds(new Set());
    setIsAllDatabaseSelected(false);
  }, [filters]);

  // حالات تحديث الدفعات
  const [batchInput, setBatchInput] = useState("");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [migrationNumberingMode, setMigrationNumberingMode] =
    useState<MigrationNumberingConflictMode>("merge_use_truth");
  const [isPreparingMigrationWizard, setIsPreparingMigrationWizard] = useState(false);
  const [migrationConflictQueue, setMigrationConflictQueue] = useState<MigrationNumberingConflictPreview[]>([]);
  const [migrationConflictIndex, setMigrationConflictIndex] = useState(0);
  const [isApplyingSimilarity, setIsApplyingSimilarity] = useState(false);

  const [editingRow, setEditingRow] = useState<RegistryRow | null>(null);
  const [editBatchInput, setEditBatchInput] = useState("");
  const [isInlineUpdating, setIsInlineUpdating] = useState(false);
  const [fixingRowId, setFixingRowId] = useState<string | null>(null);
  const [numberingModalRow, setNumberingModalRow] = useState<RegistryRow | null>(null);
  const [numberingContext, setNumberingContext] = useState<FamilyNumberingContext | null>(null);
  const [isLoadingNumberingContext, setIsLoadingNumberingContext] = useState(false);
  const [numberingContextError, setNumberingContextError] = useState("");
  const [selectedNumberingCard, setSelectedNumberingCard] = useState("");
  const [manualNumberingCard, setManualNumberingCard] = useState("");
  const [useManualNumberingCard, setUseManualNumberingCard] = useState(false);
  const [applyWholeFamilyNumbering, setApplyWholeFamilyNumbering] = useState(true);
  const [isResolvingNumbering, setIsResolvingNumbering] = useState(false);

  const usingSystemPrimaryRows = Boolean(filters.system_primary && !filters.not_in_system);
  const showSimilarityColumn = Boolean(
    (usingSystemPrimaryRows && !filters.not_in_system) ||
      filters.in_system_not_in_registry ||
      filters.family_numbering_mismatch,
  );
  const canMigrateFromTruthRows =
    !usingSystemPrimaryRows &&
    !filters.in_system_not_in_registry &&
    !filters.family_numbering_mismatch &&
    !filters.legacy_no_batch;

  const closeNumberingModal = () => {
    setNumberingModalRow(null);
    setNumberingContext(null);
    setNumberingContextError("");
    setSelectedNumberingCard("");
    setManualNumberingCard("");
    setUseManualNumberingCard(false);
    setApplyWholeFamilyNumbering(true);
    setIsResolvingNumbering(false);
    setMigrationConflictQueue([]);
    setMigrationConflictIndex(0);
  };

  const openMigrationConflictStep = async (
    conflicts: MigrationNumberingConflictPreview[],
    index: number,
  ) => {
    const item = conflicts[index];
    if (!item) return;
    const pseudoRow: RegistryRow = {
      id: item.beneficiary_id,
      card_number: item.truth_card,
      card_number_upper: item.truth_canonical,
      beneficiary_name: item.truth_name,
      birth_date: item.truth_birth || null,
      city: "",
      batch_number: item.truth_batch,
      source_file: null,
      source_sheet: null,
      source_row: null,
      updated_at: null,
      batches_count: 1,
      batches_list: item.truth_batch ?? null,
      similar_truth_card: null,
      similar_truth_name: null,
      similar_truth_batch: null,
      similar_reason: "معالجة تعارض ترقيم أثناء الترحيل",
    };
    await openFamilyNumberingModal(pseudoRow);
    setApplyWholeFamilyNumbering(false);
    setSelectedNumberingCard(String(item.truth_card ?? "").trim().toUpperCase());
  };

  const closeMigrationModal = () => {
    if (isMigrating) return;
    setIsMigrationModalOpen(false);
  };

  const openFamilyNumberingModal = async (row: RegistryRow) => {
    setNumberingModalRow(row);
    setNumberingContext(null);
    setNumberingContextError("");
    setSelectedNumberingCard("");
    setManualNumberingCard("");
    setUseManualNumberingCard(false);
    setApplyWholeFamilyNumbering(true);
    setIsLoadingNumberingContext(true);
    try {
      const res = await getFamilyNumberingMismatchContextAction({ beneficiaryId: row.id });
      if ("error" in res && res.error) {
        setNumberingContextError(res.error);
        return;
      }
      if (!("success" in res) || !res.success || !("context" in res) || !res.context) {
        setNumberingContextError("تعذر تحميل تفاصيل التباين");
        return;
      }
      const context = res.context as FamilyNumberingContext;
      setNumberingContext(context);
      setSelectedNumberingCard(String(context.recommended_card ?? "").trim().toUpperCase());
    } catch (err) {
      console.error(err);
      setNumberingContextError("حدث خطأ أثناء تحميل تفاصيل التباين");
    } finally {
      setIsLoadingNumberingContext(false);
    }
  };

  const updateFamilyPlan = async (prefCard: string) => {
    if (!numberingModalRow) return;
    try {
      const res = await getFamilyNumberingMismatchContextAction({
        beneficiaryId: numberingModalRow.id,
        preferredCard: prefCard,
      });
      if (res && "success" in res && res.success && res.context) {
        const context = res.context as FamilyNumberingContext;
        setNumberingContext((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            family_standard_plan: context.family_standard_plan,
          };
        });
      }
    } catch (err) {
      console.error("Failed to update family plan preview:", err);
    }
  };

  useEffect(() => {
    if (!numberingModalRow || !numberingContext) return;
    const activeCard = (useManualNumberingCard ? manualNumberingCard : selectedNumberingCard).trim().toUpperCase();
    if (!activeCard) return;

    const delay = useManualNumberingCard ? 400 : 0;
    const timer = setTimeout(() => {
      updateFamilyPlan(activeCard);
    }, delay);

    return () => clearTimeout(timer);
  }, [selectedNumberingCard, useManualNumberingCard, manualNumberingCard, numberingModalRow, !!numberingContext]);

  const handleResolveFamilyNumbering = async () => {
    if (!numberingModalRow) return;
    const targetCard = (
      useManualNumberingCard ? manualNumberingCard : selectedNumberingCard
    )
      .trim()
      .toUpperCase();
    if (!targetCard) {
      error("يرجى اختيار ترقيم هدف أو إدخاله يدوياً");
      return;
    }

    const confirmMsg = applyWholeFamilyNumbering
      ? `تأكيد توحيد ترميز العائلة بالكامل؟\n\nالمرجع المختار: ${targetCard}\n\nسيتم ترتيب أفراد نفس الرمز حسب تاريخ الميلاد (الأقدم أولاً)، وتوحيد المنظومة وجدول الحقيقة، وإضافة أي فرد ناقص من الحقيقة إلى المنظومة تلقائياً.`
      : `تأكيد توحيد ترقيم هذه الحالة؟\n\nالترقيم الهدف: ${targetCard}\n\nسيتم توحيد المنظومة وجدول الحقيقة لهذه الحالة فقط مع معالجة الدمج عند الحاجة.`;
    if (!window.confirm(confirmMsg)) return;

    setIsResolvingNumbering(true);
    try {
      const res = await resolveFamilyNumberingMismatchAction({
        beneficiaryId: numberingModalRow.id,
        targetCard,
        applyToWholeFamily: applyWholeFamilyNumbering,
      });
      if ("error" in res && res.error) {
        error(res.error);
      } else {
        const createdFromTruth = Number((res as { createdFromTruth?: number }).createdFromTruth ?? 0);
        const restoredFromDeleted = Number((res as { restoredFromDeleted?: number }).restoredFromDeleted ?? 0);
        const temporaryReassigned = Number((res as { temporaryReassigned?: number }).temporaryReassigned ?? 0);
        success(
          `${res.familyStandardized ? "تم توحيد العائلة" : "تم التوحيد"} إلى ${res.targetCard} | تحديث: ${Number(res.updated ?? 0)} | إضافة: ${createdFromTruth} | استعادة: ${restoredFromDeleted} | تحرير مؤقت: ${temporaryReassigned} | دمج: ${Number(res.merged ?? 0)} | تحديث الحقيقة: ${Number(res.truthUpdatedRows ?? 0)} | تعارض: ${Number(res.skippedConflict ?? 0)} | حالات: ${Number(res.candidatesCount ?? 0)}`,
        );

        // إذا كنا داخل معالج الترحيل المتتابع، انتقل للحالة التالية تلقائياً
        if (migrationConflictQueue.length > 0) {
          const nextIndex = migrationConflictIndex + 1;
          if (nextIndex < migrationConflictQueue.length) {
            setMigrationConflictIndex(nextIndex);
            await openMigrationConflictStep(migrationConflictQueue, nextIndex);
          } else {
            closeNumberingModal();
            setMigrationConflictQueue([]);
            setMigrationConflictIndex(0);

            // بعد إنهاء كل تعارضات الترقيم، أكمل الترحيل مباشرة
            setIsMigrating(true);
            try {
              const resAfter = await migrateTruthRowsToSystemAction({
                ids: Array.from(selectedIds),
                numberingConflictMode: "merge_use_truth",
              });
              if (resAfter.error) {
                error(resAfter.error);
              } else {
                const created = Number(resAfter.createdCount ?? 0);
                const restored = Number(resAfter.restoredCount ?? 0);
                const skippedExisting = Number(resAfter.skippedExisting ?? 0);
                const skippedInvalid = Number(resAfter.skippedInvalid ?? 0);
                const merged = Number((resAfter as { mergedCount?: number }).mergedCount ?? 0);
                const resolvedNumbering = Number(
                  (resAfter as { resolvedNumberingCount?: number }).resolvedNumberingCount ?? 0,
                );
                const keptSystem = Number(
                  (resAfter as { keptSystemNumbering?: number }).keptSystemNumbering ?? 0,
                );
                const skippedNumberingConflict = Number(
                  (resAfter as { skippedNumberingConflict?: number }).skippedNumberingConflict ?? 0,
                );
                success(
                  `اكتمل الترحيل بعد معالجة التعارضات | تمت الإضافة: ${created} | تمت الاستعادة: ${restored} | دمج: ${merged} | توحيد ترقيم: ${resolvedNumbering} | إبقاء ترقيم المنظومة: ${keptSystem} | موجود مسبقاً: ${skippedExisting} | تعارض يحتاج مراجعة: ${skippedNumberingConflict} | غير صالح: ${skippedInvalid}`,
                );
                setSelectedIds(new Set());
                setIsAllDatabaseSelected(false);
                setIsMigrationModalOpen(false);
                router.refresh();
              }
            } catch (mErr) {
              console.error(mErr);
              error("حدث خطأ أثناء استكمال الترحيل بعد معالجة التعارضات");
            } finally {
              setIsMigrating(false);
            }
          }
        } else {
          closeNumberingModal();
          router.refresh();
        }
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ أثناء معالجة تباين الترقيم");
    } finally {
      setIsResolvingNumbering(false);
    }
  };

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

    const isSystemSourced = Boolean(filters.in_system_not_in_registry || filters.legacy_no_batch || filters.family_numbering_mismatch);

    let confirmMsg = "";
    if (isSystemSourced) {
      if (isAllDatabaseSelected) {
        confirmMsg = `⚠️ تنبيه أمني شديد! هل أنت متأكد تماماً من رغبتك في حذف كافة الـ ${totalCount.toLocaleString("ar-LY")} مستفيد المحددين من المنظومة (حذف مبدئي)؟\n\nتنبيه: هذا الإجراء سيقوم بتعطيل حساباتهم في المنظومة ونقلهم لسلة المحذوفات!`;
      } else {
        confirmMsg = `هل أنت متأكد من رغبتك في حذف ${selectedIds.size} مستفيد من المنظومة (حذف مبدئي)؟\n\nتنبيه: سيتم نقل السجلات المحددة إلى سلة المحذوفات.`;
      }
    } else {
      if (isAllDatabaseSelected) {
        confirmMsg = `⚠️ تنبيه أمني شديد! هل أنت متأكد تماماً من رغبتك في حذف كافة الـ ${totalCount.toLocaleString("ar-LY")} سجل من جدول الحقيقة؟\n\nتنبيه: هذا الإجراء سيقوم بمسح كافة هذه السجلات نهائياً من جدول الحقيقة ولا يمكن التراجع عنه!`;
      } else {
        confirmMsg = `هل أنت متأكد من رغبتك في حذف ${selectedIds.size} سجل من جدول الحقيقة؟\n\nتنبيه: سيتم مسح السجلات المحددة نهائياً من جدول الحقيقة ولا يمكن التراجع عنه.`;
      }
    }

    if (!window.confirm(confirmMsg)) return;

    setIsDeleting(true);
    try {
      let res;
      if (isSystemSourced) {
        if (isAllDatabaseSelected) {
          res = await softDeleteFilteredBeneficiariesAction(filters);
        } else {
          res = await softDeleteBeneficiaryRowsAction(Array.from(selectedIds));
        }
      } else {
        if (isAllDatabaseSelected) {
          res = await deleteFilteredTruthRegistryAction(filters);
        } else {
          res = await deleteTruthRegistryRowsAction(Array.from(selectedIds));
        }
      }

      if (res.error) {
        error(res.error);
      } else {
        const countDeleted = (isAllDatabaseSelected && "deletedCount" in res) 
          ? (res.deletedCount ?? totalCount) 
          : selectedIds.size;

        if (isSystemSourced) {
          success(`تم حذف ${countDeleted.toLocaleString()} مستفيد بنجاح (حذف مبدئي من المنظومة)!`);
        } else {
          success(`تم حذف ${countDeleted.toLocaleString()} سجل بنجاح من جدول الحقيقة!`);
        }
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

  const handleApplySuggestion = async (row: RegistryRow) => {
    const targetCard = String(row.similar_truth_card ?? "").trim();
    if (!targetCard) return;

    const msg = `تطبيق المطابقة المقترحة؟\n\nالبطاقة الحالية: ${row.card_number}\nالبطاقة المقترحة: ${targetCard}`;
    if (!window.confirm(msg)) return;

    setFixingRowId(row.id);
    try {
      const res = await applySuggestedTruthMatchAction({
        beneficiaryId: row.id,
        targetCard,
      });
      if (res.error) {
        error(res.error);
      } else {
        if ("merged" in res && res.merged) {
          success(`تم الدمج بنجاح ثم اعتماد البطاقة: ${res.previousCard} ← ${res.newCard}`);
        } else {
          success(`تم تطبيق المطابقة: ${res.previousCard} ← ${res.newCard}`);
        }
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ أثناء تطبيق المطابقة المقترحة");
    } finally {
      setFixingRowId(null);
    }
  };

  const handleMigrateSelected = () => {
    if (selectedIds.size === 0 && !isAllDatabaseSelected) return;
    setIsMigrationModalOpen(true);
  };

  const handleConfirmMigrateSelected = async () => {
    if (selectedIds.size === 0 && !isAllDatabaseSelected) return;

    const targetCount = isAllDatabaseSelected ? totalCount : selectedIds.size;
    const modeText =
      migrationNumberingMode === "merge_use_truth"
        ? "اعتماد ترقيم جدول الحقيقة + دمج تلقائي"
        : migrationNumberingMode === "keep_system"
          ? "إبقاء ترقيم المنظومة للحالات المتعارضة"
          : migrationNumberingMode === "manual_review"
            ? "معالج يدوي متتالي قبل الترحيل"
            : "تخطي الحالات المتعارضة";
    const confirmMsg = isAllDatabaseSelected
      ? `هل تريد ترحيل كل السجلات المطابقة للفلتر الحالي (${targetCount.toLocaleString("ar-LY")}) إلى المنظومة؟\n\nوضع التعارض: ${modeText}`
      : `هل تريد ترحيل ${targetCount.toLocaleString("ar-LY")} سجل محدد إلى المنظومة؟\n\nوضع التعارض: ${modeText}`;

    if (!window.confirm(confirmMsg)) return;

    // وضع المعالج المتتالي: تحليل التعارضات أولاً ثم معالجة كل حالة يدوياً قبل الترحيل
    if (migrationNumberingMode === "manual_review") {
      if (isAllDatabaseSelected) {
        error("المعالج اليدوي المتتالي متاح حالياً للتحديد اليدوي فقط، وليس لتحديد كل نتائج الفلتر.");
        return;
      }

      setIsPreparingMigrationWizard(true);
      try {
        const preview = await prepareTruthMigrationNumberingConflictsAction({
          ids: Array.from(selectedIds),
        });

        if ("error" in preview && preview.error) {
          error(preview.error);
          return;
        }

        const conflicts = Array.isArray(preview.conflicts)
          ? (preview.conflicts as MigrationNumberingConflictPreview[])
          : [];

        if (conflicts.length === 0) {
          success("لا توجد تعارضات ترقيم تتطلب قراراً يدوياً. سيتم الترحيل مباشرة.");
          setIsMigrating(true);
          try {
            const direct = await migrateTruthRowsToSystemAction({
              ids: Array.from(selectedIds),
              numberingConflictMode: "merge_use_truth",
            });
            if (direct.error) {
              error(direct.error);
            } else {
              const created = Number(direct.createdCount ?? 0);
              const restored = Number(direct.restoredCount ?? 0);
              const skippedExisting = Number(direct.skippedExisting ?? 0);
              const skippedInvalid = Number(direct.skippedInvalid ?? 0);
              const merged = Number((direct as { mergedCount?: number }).mergedCount ?? 0);
              const resolvedNumbering = Number(
                (direct as { resolvedNumberingCount?: number }).resolvedNumberingCount ?? 0,
              );
              const keptSystem = Number(
                (direct as { keptSystemNumbering?: number }).keptSystemNumbering ?? 0,
              );
              const skippedNumberingConflict = Number(
                (direct as { skippedNumberingConflict?: number }).skippedNumberingConflict ?? 0,
              );
              success(
                `تمت الإضافة: ${created} | تمت الاستعادة: ${restored} | دمج: ${merged} | توحيد ترقيم: ${resolvedNumbering} | إبقاء ترقيم المنظومة: ${keptSystem} | موجود مسبقاً: ${skippedExisting} | تعارض يحتاج مراجعة: ${skippedNumberingConflict} | غير صالح: ${skippedInvalid}`,
              );
              setSelectedIds(new Set());
              setIsAllDatabaseSelected(false);
              setIsMigrationModalOpen(false);
              router.refresh();
            }
          } catch (directErr) {
            console.error(directErr);
            error("حدث خطأ أثناء الترحيل");
          } finally {
            setIsMigrating(false);
          }
          return;
        }

        setMigrationConflictQueue(conflicts);
        setMigrationConflictIndex(0);
        setIsMigrationModalOpen(false);
        success(`تم العثور على ${conflicts.length.toLocaleString("ar-LY")} حالة تعارض. ابدأ المعالجة المتتالية.`);
        await openMigrationConflictStep(conflicts, 0);
      } catch (err) {
        console.error(err);
        error("حدث خطأ أثناء تجهيز معالج تعارض الترقيم");
      } finally {
        setIsPreparingMigrationWizard(false);
      }
      return;
    }

    setIsMigrating(true);
    try {
      const res = isAllDatabaseSelected
        ? await migrateFilteredTruthRowsToSystemAction({
            ...filters,
            numbering_conflict_mode: migrationNumberingMode,
          })
        : await migrateTruthRowsToSystemAction({
            ids: Array.from(selectedIds),
            numberingConflictMode: migrationNumberingMode,
          });

      if (res.error) {
        error(res.error);
      } else {
        const created = Number(res.createdCount ?? 0);
        const restored = Number(res.restoredCount ?? 0);
        const skippedExisting = Number(res.skippedExisting ?? 0);
        const skippedInvalid = Number(res.skippedInvalid ?? 0);
        const merged = Number((res as { mergedCount?: number }).mergedCount ?? 0);
        const resolvedNumbering = Number(
          (res as { resolvedNumberingCount?: number }).resolvedNumberingCount ?? 0,
        );
        const keptSystem = Number(
          (res as { keptSystemNumbering?: number }).keptSystemNumbering ?? 0,
        );
        const skippedNumberingConflict = Number(
          (res as { skippedNumberingConflict?: number }).skippedNumberingConflict ?? 0,
        );
        success(
          `تمت الإضافة: ${created} | تمت الاستعادة: ${restored} | دمج: ${merged} | توحيد ترقيم: ${resolvedNumbering} | إبقاء ترقيم المنظومة: ${keptSystem} | موجود مسبقاً: ${skippedExisting} | تعارض يحتاج مراجعة: ${skippedNumberingConflict} | غير صالح: ${skippedInvalid}`,
        );
        setSelectedIds(new Set());
        setIsAllDatabaseSelected(false);
        setIsMigrationModalOpen(false);
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ أثناء الترحيل الجماعي للمنظومة");
    } finally {
      setIsMigrating(false);
    }
  };

  const handleApplySimilarityBulk = async () => {
    if (selectedIds.size === 0 && !isAllDatabaseSelected) return;

    if (!showSimilarityColumn) {
      error("التطبيق الجماعي للمقاربة متاح فقط ضمن عرض حالات المنظومة غير المدرجة بجدول الحقيقة");
      return;
    }

    if (isAllDatabaseSelected) {
      const confirmMsg = `هل تريد تطبيق المقاربة على كل نتائج الفلتر الحالية (${totalCount.toLocaleString("ar-LY")})؟`;
      if (!window.confirm(confirmMsg)) return;

      setIsApplyingSimilarity(true);
      try {
        const res = await applySuggestedTruthMatchesByFilterAction(filters);
        if (!("success" in res) || !res.success) {
          const msg = "error" in res && res.error ? res.error : "تعذر تطبيق المقاربة على نتائج الفلتر";
          error(msg);
        } else {
          success(
            `تم التطبيق: ${Number(res.applied ?? 0)} | تم الدمج: ${Number(res.merged ?? 0)} | تعارض: ${Number(res.skippedConflict ?? 0)} | بدون تطابق: ${Number(res.skippedNoTruth ?? 0)}`,
          );
          setSelectedIds(new Set());
          setIsAllDatabaseSelected(false);
          router.refresh();
        }
      } catch (err) {
        console.error(err);
        error("حدث خطأ أثناء التطبيق الجماعي للمقاربة");
      } finally {
        setIsApplyingSimilarity(false);
      }
      return;
    }

    const selectedRows = rows.filter((row) => selectedIds.has(row.id));
    const matches = selectedRows
      .map((row) => ({
        beneficiaryId: row.id,
        targetCard: String(row.similar_truth_card ?? "").trim(),
      }))
      .filter((item) => item.targetCard.length > 0);

    if (matches.length === 0) {
      error("لا توجد حالات مقاربة قابلة للتطبيق ضمن السجلات المحددة");
      return;
    }

    const confirmMsg = `هل تريد تطبيق المقاربة على ${matches.length.toLocaleString("ar-LY")} سجل محدد؟`;
    if (!window.confirm(confirmMsg)) return;

    setIsApplyingSimilarity(true);
    try {
      const res = await applySuggestedTruthMatchesAction({ matches });
      if (!("success" in res) || !res.success) {
        const msg = "error" in res && res.error ? res.error : "تعذر تطبيق المقاربة على السجلات المحددة";
        error(msg);
      } else {
        success(
          `تم التطبيق: ${Number(res.applied ?? 0)} | تم الدمج: ${Number(res.merged ?? 0)} | تعارض: ${Number(res.skippedConflict ?? 0)} | بدون تطابق: ${Number(res.skippedNoTruth ?? 0)}`,
        );
        setSelectedIds(new Set());
        setIsAllDatabaseSelected(false);
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      error("حدث خطأ أثناء التطبيق الجماعي للمقاربة");
    } finally {
      setIsApplyingSimilarity(false);
    }
  };

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < rows.length;
  const currentMigrationConflict =
    migrationConflictQueue.length > 0 ? migrationConflictQueue[migrationConflictIndex] : null;

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
            className={`h-9 px-4 rounded-xl text-xs font-black flex items-center gap-2 shadow-lg animate-in fade-in transition-all ${
              Boolean(filters.in_system_not_in_registry || filters.legacy_no_batch || filters.family_numbering_mismatch)
                ? "bg-amber-600 hover:bg-amber-700 text-white shadow-amber-950/20"
                : "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-950/20"
            }`}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                جاري الحذف...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                {Boolean(filters.in_system_not_in_registry || filters.legacy_no_batch || filters.family_numbering_mismatch)
                  ? "حذف مبدئي من المنظومة"
                  : "حذف نهائي من جدول الحقيقة"}
              </>
            )}
          </Button>

          {canMigrateFromTruthRows && (
            <Button
              type="button"
              onClick={handleMigrateSelected}
              disabled={isMigrating}
              className="h-9 px-4 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 shadow-lg shadow-emerald-950/20"
            >
              {isMigrating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  جاري الترحيل...
                </>
              ) : (
                <>ترحيل للمنظومة</>
              )}
              </Button>
          )}

          {showSimilarityColumn && (
            <Button
              type="button"
              onClick={handleApplySimilarityBulk}
              disabled={isApplyingSimilarity}
              className="h-9 px-4 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 shadow-lg shadow-emerald-950/20"
            >
              {isApplyingSimilarity ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  جاري تطبيق المقاربة...
                </>
              ) : (
                <>تطبيق المقاربة دفعة واحدة</>
              )}
            </Button>
          )}

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

      {/* بنر مصدر البيانات الحالي */}
      <div className={`border-b px-4 py-2.5 flex items-center justify-between text-xs font-semibold ${
        Boolean(filters.in_system_not_in_registry || filters.legacy_no_batch || filters.family_numbering_mismatch)
          ? "bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-400"
          : "bg-blue-500/10 border-blue-500/20 text-blue-800 dark:text-blue-400"
      }`}>
        <div className="flex items-center gap-2">
          <span>{Boolean(filters.in_system_not_in_registry || filters.legacy_no_batch || filters.family_numbering_mismatch) ? "⚠️" : "📋"}</span>
          <span>
            {Boolean(filters.in_system_not_in_registry || filters.legacy_no_batch || filters.family_numbering_mismatch)
              ? "بيانات المنظومة (المستفيدين) - العمليات تؤثر مباشرة على المنظومة (حذف مبدئي)"
              : "بيانات جدول الحقيقة (البطاقات الرسمية) - العمليات تؤثر على جدول الحقيقة فقط"}
          </span>
        </div>
        <div className="text-[10px] opacity-75">
          {totalCount.toLocaleString("ar-LY")} سجل متطابق
        </div>
      </div>

      {filters.in_system_not_in_registry && (
        <div className="bg-amber-500/10 dark:bg-amber-500/5 border-b border-amber-500/20 px-4 py-3 text-right flex items-start gap-2.5">
          <span className="text-amber-500 text-base shrink-0 mt-0.5">⚠️</span>
          <div>
            <p className="text-xs font-bold text-amber-800 dark:text-amber-400">
              ملاحظة بخصوص مستفيدي المنظومة غير المدرجين بجدول الحقيقة:
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-1">
              هذه السجلات تمثل مستفيدين مسجلين حالياً في المنظومة ولكن لا يوجد لهم أي تطابق في جدول الحقيقة (البطاقات الرسمية).
              يمكنك الآن حذفهم (حذف مبدئي) مباشرة من هذه الشاشة، أو عبر شاشة «البطاقات القديمة» في «إدارة المشاكل».
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
              {showSimilarityColumn && (
                <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">التقارب / الإصلاح</th>
              )}
              <th className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400 text-left">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={showSimilarityColumn ? 13 : 12}
                  className="px-3 py-12 text-center text-slate-400 dark:text-slate-500 font-bold"
                >
                  لا توجد نتائج مطابقة.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelected = selectedIds.has(row.id) || isAllDatabaseSelected;
                const isFamilyNumberingCase = Boolean(
                  filters.family_numbering_mismatch || (row.similar_reason ?? "").includes("اختلاف ترقيم عائلي"),
                );
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
                    {showSimilarityColumn && (
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            {row.similar_reason ?? "تقارب محتمل"}
                          </div>
                          {row.similar_truth_card ? (
                            <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                              {row.similar_truth_card}
                            </div>
                          ) : null}
                          {row.similar_truth_name ? (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-40" title={row.similar_truth_name}>
                              {row.similar_truth_name}
                            </div>
                          ) : null}

                          {isFamilyNumberingCase ? (
                            <Button
                              type="button"
                              onClick={() => openFamilyNumberingModal(row)}
                              className="h-7 px-2.5 rounded-lg text-[11px] font-black bg-blue-600 hover:bg-blue-700 text-white"
                            >
                              فتح معالجة التباين
                            </Button>
                          ) : row.similar_truth_card ? (
                            <Button
                              type="button"
                              onClick={() => handleApplySuggestion(row)}
                              disabled={fixingRowId === row.id}
                              className="h-7 px-2.5 rounded-lg text-[11px] font-black bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              {fixingRowId === row.id ? "جاري التطبيق..." : "تطبيق المطابقة"}
                            </Button>
                          ) : (
                            <span className="text-[11px] text-slate-400">لا يوجد تقارب واضح</span>
                          )}
                        </div>
                      </td>
                    )}
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

      {/* ── مودال خيارات الترحيل إلى المنظومة ────────────────────── */}
      {isMigrationModalOpen && (
        <div className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-900/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900" dir="rtl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">خيارات الترحيل إلى المنظومة</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  السجلات المستهدفة:{" "}
                  <span className="font-black text-slate-700 dark:text-slate-200">
                    {(isAllDatabaseSelected ? totalCount : selectedIds.size).toLocaleString("ar-LY")}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeMigrationModal}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                disabled={isMigrating}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2 rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-xs font-black text-slate-700 dark:text-slate-200">
                عند وجود مستفيد بنفس الاسم + الميلاد لكن برقم بطاقة مختلف:
              </p>

              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                <input
                  type="radio"
                  name="migration-numbering-mode"
                  checked={migrationNumberingMode === "merge_use_truth"}
                  onChange={() => setMigrationNumberingMode("merge_use_truth")}
                  disabled={isMigrating}
                />
                <span>
                  اعتماد ترقيم جدول الحقيقة ودمج السجلات داخل المنظومة تلقائياً (الموصى به).
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                <input
                  type="radio"
                  name="migration-numbering-mode"
                  checked={migrationNumberingMode === "keep_system"}
                  onChange={() => setMigrationNumberingMode("keep_system")}
                  disabled={isMigrating}
                />
                <span>
                  إبقاء ترقيم المنظومة كما هو، وعدم إدخال ترقيم الحقيقة في الحالات المتعارضة.
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                <input
                  type="radio"
                  name="migration-numbering-mode"
                  checked={migrationNumberingMode === "skip"}
                  onChange={() => setMigrationNumberingMode("skip")}
                  disabled={isMigrating}
                />
                <span>
                  تخطي الحالات المتعارضة فقط، مع ترحيل السجلات الأخرى.
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                <input
                  type="radio"
                  name="migration-numbering-mode"
                  checked={migrationNumberingMode === "manual_review"}
                  onChange={() => setMigrationNumberingMode("manual_review")}
                  disabled={isMigrating || isAllDatabaseSelected}
                />
                <span>
                  معالج يدوي متتالي: قبل الترحيل ستظهر لك كل تعارضات الترقيم حالة-حالة لاختيار الصحيح.
                  {isAllDatabaseSelected ? " (غير متاح عند تحديد كل نتائج الفلتر)" : ""}
                </span>
              </label>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeMigrationModal}
                className="h-9 px-4 text-xs font-bold rounded-xl"
                disabled={isMigrating}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                onClick={handleConfirmMigrateSelected}
                className="h-9 px-4 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={isMigrating || isPreparingMigrationWizard}
              >
                {isMigrating
                  ? "جاري الترحيل..."
                  : isPreparingMigrationWizard
                    ? "تجهيز المعالج..."
                    : "بدء الترحيل"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── مودال معالجة اختلاف الترقيم العائلي ────────────────────── */}
      {numberingModalRow && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 w-full max-w-6xl shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto" dir="rtl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  معالجة تباين الترقيم (المنظومة + جدول الحقيقة)
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  المستفيد: <span className="font-bold text-slate-800 dark:text-slate-200">{numberingModalRow.beneficiary_name ?? "—"}</span>
                  {" | "}
                  البطاقة الحالية: <span className="font-mono font-black text-slate-900 dark:text-white">{numberingModalRow.card_number}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeNumberingModal}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                disabled={isResolvingNumbering}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {currentMigrationConflict && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">
                <div className="font-black">
                  معالج الترحيل المتتالي: الحالة {migrationConflictIndex + 1} من {migrationConflictQueue.length}
                </div>
                <div className="mt-1">
                  الحقيقة: <span className="font-mono font-bold">{currentMigrationConflict.truth_card}</span>
                  {" | "}
                  بطاقات المنظومة: <span className="font-mono">{currentMigrationConflict.system_cards.join(" | ") || "—"}</span>
                </div>
              </div>
            )}

            {isLoadingNumberingContext && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري تحميل تفاصيل العائلة والتباين...
              </div>
            )}

            {!isLoadingNumberingContext && numberingContextError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
                {numberingContextError}
              </div>
            )}

            {!isLoadingNumberingContext && numberingContext && (
              <>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    اختر الترقيم المعتمد لهذه الحالة:
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {numberingContext.options.map((option) => (
                      <label
                        key={option.canonical_card}
                        className={`rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                          !useManualNumberingCard && selectedNumberingCard === option.card_number
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                            : "border-slate-200 dark:border-slate-800 hover:border-blue-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="numbering-option"
                              checked={!useManualNumberingCard && selectedNumberingCard === option.card_number}
                              onChange={() => {
                                setUseManualNumberingCard(false);
                                setSelectedNumberingCard(option.card_number);
                              }}
                              className="mt-1"
                              disabled={isResolvingNumbering}
                            />
                            <div>
                              <div className="text-xs font-mono font-black text-slate-900 dark:text-white">
                                {option.card_number}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {option.is_current ? "الحالي" : "مرشح"}
                                {option.from_truth ? " | موجود بالحقيقة" : ""}
                                {option.from_system ? " | موجود بالمنظومة" : ""}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-black">
                              حقيقة {option.truth_count}
                            </span>
                            <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-black">
                              منظومة {option.system_count}
                            </span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                    <label className="inline-flex items-center gap-2 text-xs font-black text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={applyWholeFamilyNumbering}
                        onChange={(e) => setApplyWholeFamilyNumbering(e.target.checked)}
                        disabled={isResolvingNumbering}
                      />
                      توحيد ترميز العائلة بالكامل (الترتيب حسب تاريخ الميلاد)
                    </label>
                    <p className="text-[11px] text-slate-500">
                      عند التفعيل: يتم ترميز أفراد كل فئة (S/D/B/W/M/F/H) وفق ترتيب الميلاد من الأقدم إلى الأحدث لتوحيد النسق بين المنظومة وجدول الحقيقة.
                    </p>
                  </div>

                  {applyWholeFamilyNumbering && numberingContext.family_standard_plan && numberingContext.family_standard_plan.length > 0 && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-slate-50/50 dark:bg-slate-900/30">
                      <div className="flex items-center justify-between text-xs font-black text-slate-700 dark:text-slate-200">
                        <span>معاينة خطة الإصلاح والتوحيد العائلي المقترحة</span>
                        <span className="text-[10px] text-slate-500 font-normal">
                          (إجمالي العائلة: {numberingContext.family_standard_plan.length} أفراد)
                        </span>
                      </div>
                      
                      <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                        {numberingContext.family_standard_plan.map((item) => {
                          const systemCards = item.system_cards || [];
                          let actionText = "مطابق";
                          let actionColor = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
                          let showDiff = false;
                          let originalCardText = "";

                          if (systemCards.length === 0) {
                            actionText = "إضافة للمنظومة";
                            actionColor = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
                            showDiff = true;
                            originalCardText = "غير موجود";
                          } else if (systemCards.length === 1) {
                            if (systemCards[0] === item.target_card) {
                              actionText = "مطابق";
                              actionColor = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
                              showDiff = false;
                            } else {
                              actionText = "تحديث ترقيم";
                              actionColor = "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
                              showDiff = true;
                              originalCardText = systemCards[0];
                            }
                          } else {
                            actionText = "دمج مكرر وتحديث";
                            actionColor = "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400";
                            showDiff = true;
                            originalCardText = `${systemCards.length} بطاقات`;
                          }

                          return (
                            <div
                              key={item.person_key}
                              className={`rounded-xl border p-2.5 text-[11px] flex flex-col md:flex-row md:items-center justify-between gap-2 transition-all ${
                                actionText === "دمج مكرر وتحديث"
                                  ? "border-rose-200 bg-rose-50/20 dark:border-rose-950/30"
                                  : actionText === "تحديث ترقيم"
                                  ? "border-amber-200 bg-amber-50/20 dark:border-amber-950/30"
                                  : actionText === "إضافة للمنظومة"
                                  ? "border-emerald-200 bg-emerald-50/20 dark:border-emerald-950/30"
                                  : "border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-black text-slate-900 dark:text-white truncate">
                                    {item.name}
                                  </span>
                                  <span className="rounded bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 px-1 py-0.5 text-[9px] font-bold">
                                    {item.relation_code === "MAIN" ? "المرجع" : item.relation_code}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  تاريخ الميلاد: {item.birth_date || "—"} | البطاقات الحالية: {item.current_cards.join(", ") || "لا يوجد"}
                                </div>
                              </div>

                              <div className="flex items-center gap-3 justify-between md:justify-end mt-1 md:mt-0">
                                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                                  {showDiff ? (
                                    <>
                                      <span className="text-slate-400 line-through truncate max-w-[100px]" title={originalCardText}>
                                        {originalCardText}
                                      </span>
                                      <span className="text-slate-400">←</span>
                                      <span className="font-bold text-blue-700 dark:text-blue-400">
                                        {item.target_card}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-slate-600 dark:text-slate-300">
                                      {item.target_card}
                                    </span>
                                  )}
                                </div>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black shrink-0 ${actionColor}`}>
                                  {actionText}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={useManualNumberingCard}
                        onChange={(e) => setUseManualNumberingCard(e.target.checked)}
                        disabled={isResolvingNumbering}
                      />
                      إدخال ترقيم يدوي
                    </label>
                    <Input
                      value={manualNumberingCard}
                      onChange={(e) => setManualNumberingCard(e.target.value.toUpperCase())}
                      placeholder="مثال: WAB202512345F1"
                      className="h-10 text-xs font-mono"
                      disabled={!useManualNumberingCard || isResolvingNumbering}
                    />
                    <p className="text-[11px] text-slate-500">
                      عند التطبيق: {applyWholeFamilyNumbering ? "سيتم توحيد المنظومة + جدول الحقيقة لكامل العائلة وفق تسلسل الميلاد، مع إضافة أي فرد ناقص من جدول الحقيقة." : "سيتم توحيد المنظومة + جدول الحقيقة لنفس الشخص فقط."}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
                    <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 mb-2">
                      نفس الشخص في المنظومة ({numberingContext.system_same_person.length})
                    </h4>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {numberingContext.system_same_person.length === 0 ? (
                        <div className="text-[11px] text-slate-400">لا توجد سجلات مطابقة بنفس الاسم والميلاد.</div>
                      ) : (
                        numberingContext.system_same_person.slice(0, 20).map((item) => (
                          <div key={item.id} className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5 text-[11px]">
                            <div className="font-mono font-bold text-slate-800 dark:text-slate-200">{item.card_number}</div>
                            <div className="text-slate-600 dark:text-slate-400">{item.name}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
                    <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 mb-2">
                      نفس الشخص في جدول الحقيقة ({numberingContext.truth_same_person.length})
                    </h4>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {numberingContext.truth_same_person.length === 0 ? (
                        <div className="text-[11px] text-slate-400">لا توجد سجلات مطابقة بنفس الاسم والميلاد.</div>
                      ) : (
                        numberingContext.truth_same_person.slice(0, 20).map((item) => (
                          <div key={item.id} className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5 text-[11px]">
                            <div className="font-mono font-bold text-slate-800 dark:text-slate-200">{item.card_number}</div>
                            <div className="text-slate-600 dark:text-slate-400">
                              {item.beneficiary_name ?? "—"}
                              {item.batch_number ? ` | دفعة ${item.batch_number}` : ""}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
                    <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 mb-2">
                      أفراد العائلة في المنظومة ({numberingContext.system_family.length})
                    </h4>
                    <div className="max-h-44 overflow-y-auto space-y-1">
                      {numberingContext.system_family.slice(0, 16).map((item) => (
                        <div key={item.id} className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5 text-[11px] flex items-center justify-between gap-2">
                          <div className="font-mono text-slate-700 dark:text-slate-300">{item.card_number}</div>
                          <div className="truncate text-slate-500 dark:text-slate-400">{item.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
                    <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 mb-2">
                      بطاقات نفس العائلة بجدول الحقيقة ({numberingContext.truth_family.length})
                    </h4>
                    <div className="max-h-44 overflow-y-auto space-y-1">
                      {numberingContext.truth_family.slice(0, 16).map((item) => (
                        <div key={item.id} className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5 text-[11px] flex items-center justify-between gap-2">
                          <div className="font-mono text-slate-700 dark:text-slate-300">{item.card_number}</div>
                          <div className="truncate text-slate-500 dark:text-slate-400">
                            {item.beneficiary_name ?? "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={closeNumberingModal}
                className="h-9 px-4 text-xs font-bold rounded-xl"
                disabled={isResolvingNumbering}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                onClick={handleResolveFamilyNumbering}
                disabled={
                  isResolvingNumbering ||
                  isLoadingNumberingContext ||
                  !numberingContext ||
                  (useManualNumberingCard ? !manualNumberingCard.trim() : !selectedNumberingCard.trim())
                }
                className="h-9 px-4 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {isResolvingNumbering ? "جاري التوحيد..." : "اعتماد التوحيد"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
