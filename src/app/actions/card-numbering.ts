"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/session-guard";

export type CardNumberingItem = {
  name: string;
  employee_number: string;
  relationship?: string; 
  birth_date?: string;   
  original_date?: string; // التاريخ الأصلي من الملف
  city?: string;         // المدينة
  batch_number?: string; // رقم الدفعة
  status?: string;       
  field3?: string;
  error_message?: string; // رسالة الخطأ
};

// رموز اللاحقة للعائلة
const RELATIONSHIP_CODE_MAP: Record<string, string> = {
  "زوجة": "W", "زوج": "H",
  "ابن": "S", "ابنة": "D", "ابنه": "D", "ابنته": "D", "ولد": "S", "بنت": "D",
  "أم": "M", "ام": "M", "والدة": "M",
  "أب": "F", "اب": "F", "والد": "F",
  "W": "W", "S": "S", "D": "D", "M": "M", "F": "F", "H": "H"
};

const MAIN_ACCOUNT_TERMS = ["موظف", "موظفة", "رب الأسرة", "صاحب البطاقة", "رئيسي", "MAIN", "EMPLOYEE", "متوفي", "متوفى", "وفاة", "ملحق", "ملحقة"];

const getRelRank = (rel: string) => {
  const r = String(rel || "").trim().toLowerCase();
  if (!r || MAIN_ACCOUNT_TERMS.includes(r) || r === "employee") return 1;
  if (["أب", "اب", "والد"].includes(r)) return 2;
  if (["أم", "ام", "والدة"].includes(r)) return 3;
  if (["زوجة", "زوج"].includes(r)) return 4;
  if (["ابن", "ولد"].includes(r)) return 5;
  if (["ابنة", "بنت", "ابنه", "ابنته"].includes(r)) return 6;
  return 7;
};

// دالة لحساب نسبة التطابق بين التاريخ الأصلي والمحسوب
const calculateMatchPercentage = (originalDate: string | undefined, calculatedDate: string | undefined): { percentage: number; mismatches: string[] } => {
  const mismatches: string[] = [];
  let matchScore = 100;

  if (!originalDate || !calculatedDate) {
    if (!originalDate && !calculatedDate) {
      return { percentage: 100, mismatches: [] };
    }
    return { percentage: 0, mismatches: ["أحد التاريخين مفقود"] };
  }

  // استخراج أجزاء التاريخ
  const original = originalDate.trim();
  const calculated = calculatedDate.trim();

  if (original === calculated) {
    return { percentage: 100, mismatches: [] };
  }

  // محاولة مطابقة الأجزاء
  const origParts = original.split(/[-\/]/).filter(p => p);
  const calcParts = calculated.split(/[-\/]/).filter(p => p);

  if (origParts.length > 0 && calcParts.length > 0) {
    // السنة
    if (origParts[0] !== calcParts[0]) {
      mismatches.push("السنة مختلفة");
      matchScore -= 40;
    }
    // الشهر
    if (origParts[1] && calcParts[1] && origParts[1] !== calcParts[1]) {
      mismatches.push("الشهر مختلف");
      matchScore -= 30;
    }
    // اليوم
    if (origParts[2] && calcParts[2] && origParts[2] !== calcParts[2]) {
      mismatches.push("اليوم مختلف");
      matchScore -= 30;
    }
  }

  return { 
    percentage: Math.max(0, matchScore), 
    mismatches 
  };
};

export async function getCardNumberingArchive(showDeleted: boolean = false) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage_card_numbering") && !hasPermission(session, "migrate_card_numbering"))) return { error: "غير مصرح" };

  try {
    const items = await prisma.cardNumberingArchive.findMany({
      where: {
        deleted_at: showDeleted ? { not: null } : null
      },
      orderBy: [
        { employee_number: "asc" },
        { card_number: "asc" }
      ],
    });
    return {
      items: items.map(item => ({
        ...item,
        created_at: item.created_at.toISOString(),
        migrated_at: item.migrated_at?.toISOString() || null,
        birth_date: item.birth_date ? `${item.birth_date.getUTCFullYear()}-${String(item.birth_date.getUTCMonth() + 1).padStart(2, '0')}-${String(item.birth_date.getUTCDate()).padStart(2, '0')}` : null,
      }))
    };
  } catch (error) {
    return { error: "تعذر جلب الأرشيف" };
  }
}

export async function importCardNumberingAction(data: CardNumberingItem[], options: { prefix: string, padding: number, sourceFile?: string, city?: string, batchNumber?: string }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    const { prefix = "WAB2025", padding = 0, sourceFile = "يدوي", city: manualCity, batchNumber: manualBatch } = options;

    // --- فرز البيانات لضمان ترقيم صحيح حسب العمر داخل العائلة ---
    const empOrder = new Map();
    data.forEach((item, index) => {
      if (!empOrder.has(item.employee_number)) empOrder.set(item.employee_number, index);
    });

    data.sort((a, b) => {
      const orderA = empOrder.get(a.employee_number);
      const orderB = empOrder.get(b.employee_number);
      if (orderA !== orderB) return orderA - orderB;
      
      const rankA = getRelRank(a.relationship || "");
      const rankB = getRelRank(b.relationship || "");
      if (rankA !== rankB) return rankA - rankB;
      
      if (a.birth_date && b.birth_date) {
        const dateA = new Date(a.birth_date).getTime();
        const dateB = new Date(b.birth_date).getTime();
        if (!isNaN(dateA) && !isNaN(dateB)) return dateA - dateB;
      }
      return 0;
    });

    const report = { total: data.length, ready: 0, duplicate: 0, error: 0, excluded: 0, excludedItems: [] as CardNumberingItem[] };
    const countsPerEmp = new Map<string, number>();
    const seenInBatch = new Set<string>();

    for (const item of data) {
      const empNumRaw = String(item.employee_number || "").trim();
      // إزالة الأصفار البادئة لضمان عدم تكرار الحشو (Double Padding)
      const empNum = empNumRaw.replace(/^0+/, "");
      const name = String(item.name || "").trim();
      const statusVal = String(item.status || "").trim();
      const relVal = String(item.relationship || "").trim();
      const notesVal = String(item.field3 || "").trim();

      // استبعاد الحالات المطلوبة (متوفي أو ملحق) في أي من الحقول الأساسية أو الملاحظات
      const fullTextSearch = `${statusVal} ${name} ${relVal} ${notesVal}`.toLowerCase();
      const isDeceased = fullTextSearch.includes("متوفي") || fullTextSearch.includes("متوفى") || fullTextSearch.includes("وفاة");
      const isAppendix = fullTextSearch.includes("ملحق");

      const birthDateVal = String(item.birth_date || "").trim();
      const isMissingBirthDate = !birthDateVal;

      let exclusionReason = null;
      let errorMsg: string | null = null;

      if (isDeceased) {
        exclusionReason = "متوفي";
      } else if (isAppendix) {
        exclusionReason = "ملحق";
      } 
      
      // لا نستبعد بسبب تاريخ الميلاد، فقط نعطي ملاحظة
      if (isMissingBirthDate && !exclusionReason) {
        errorMsg = "⚠️ تاريخ الميلاد مفقود";
      }

      let status: any = "READY";

      if (exclusionReason) {
        status = "ERROR";
        errorMsg = exclusionReason;
        report.excluded++;
        report.excludedItems.push({ ...item, error_message: exclusionReason } as any);
      } else if (!empNum || !name) {
        status = "ERROR";
        errorMsg = "الاسم والرقم الوظيفي مطلوبان";
        report.error++;
      }

      const baseCard = prefix + (padding > 0 ? empNum.padStart(padding, "0") : empNum);
      let rel = String(item.relationship || "").trim();
      const isMain = !rel || MAIN_ACCOUNT_TERMS.includes(rel) || rel === "Employee";

      // رقم البطاقة النهائي: للموظف الرئيسي نستخدم الرقم الأساسي، وللتابعين نستخدم نظام الترميز
      let finalCardNumber = baseCard;
      if (!isMain) {
        const relCode = RELATIONSHIP_CODE_MAP[rel] || "X"; // استخدم X كافتراضي لمنع التصادم
        
        const relCountKey = `rel_${empNum}_${relCode}`;
        const currentRelCount = (countsPerEmp.get(relCountKey) || 0) + 1;
        countsPerEmp.set(relCountKey, currentRelCount);
        
        finalCardNumber = baseCard + relCode + currentRelCount;
      }

      const rowKey = `${finalCardNumber}`;

      // 1. الأولوية: التحقق من التكرار داخل نفس الملف الحالي
      if (seenInBatch.has(rowKey)) {
        status = "DUPLICATE";
        errorMsg = "[FILE] مكرر في نفس الملف";
        report.duplicate++;
      }
      // 2. التحقق من التكرار في المنظومة الرئيسية
      else {
        const existingInSystem = await prisma.beneficiary.findFirst({
          where: { card_number: { equals: finalCardNumber, mode: "insensitive" }, deleted_at: null }
        });

        if (existingInSystem) {
          status = "DUPLICATE";
          errorMsg = "[SYSTEM] موجود مسبقاً في المنظومة الرئيسية";
          report.duplicate++;
        }
        // 3. التحقق من التكرار في الأرشيف (دفعات سابقة)
        else {
          const existingInArchive = await prisma.cardNumberingArchive.findFirst({
            where: { card_number: { equals: finalCardNumber, mode: "insensitive" } }
          });
          
          if (existingInArchive) {
            const isMigrated = existingInArchive.status === "MIGRATED";
            if (isMigrated) {
              status = "DUPLICATE";
              errorMsg = "[ARCHIVE] هذا المستفيد تم ترحيله مسبقاً";
              report.duplicate++;
            } else {
              status = "READY";
              report.ready++;
            }
          } else {
            report.ready++;
          }
        }
      }

      seenInBatch.add(rowKey);

      let bDate = null;
      if (item.birth_date) {
        const d = new Date(item.birth_date);
        if (!isNaN(d.getTime())) {
          bDate = d;
        }
      }

      // --- حساب نسبة التطابق بين التاريخ الأصلي والمحسوب ---
      const { percentage: matchPercentage, mismatches } = calculateMatchPercentage(
        item.original_date,
        item.birth_date
      );

      // --- جلب البيانات المرجعية من جدول الحقيقة (CardIssuanceRegistry) ---
      let autoCity = item.city;
      let autoBatch = item.batch_number;

      // نبحث عن بيانات الموظف الرئيسي في جدول الحقيقة باستخدام رقم البطاقة الأساسي
      const registryEntry = await prisma.cardIssuanceRegistry.findUnique({
        where: { card_number_upper: baseCard }
      });

      if (registryEntry) {
        autoCity = registryEntry.city;
        autoBatch = registryEntry.batch_number || autoBatch;
      }

      await prisma.cardNumberingArchive.upsert({
        where: { card_number: finalCardNumber },
        update: {
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: bDate,
          original_date: item.original_date || null,
          original_city: item.city || null,
          city: manualCity || autoCity || null,
          batch_number: manualBatch || autoBatch || null,
          status,
          error_message: errorMsg,
          source_file: sourceFile,
          match_percentage: matchPercentage,
          mismatch_reasons: mismatches.length > 0 ? JSON.stringify(mismatches) : null,
          deleted_at: null
        },
        create: {
          card_number: finalCardNumber,
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: bDate,
          original_date: item.original_date || null,
          original_city: item.city || null,
          city: manualCity || autoCity || null,
          batch_number: manualBatch || autoBatch || null,
          status,
          error_message: errorMsg,
          source_file: sourceFile,
          match_percentage: matchPercentage,
          mismatch_reasons: mismatches.length > 0 ? JSON.stringify(mismatches) : null,
          deleted_at: null
        },
      });
    }

    revalidatePath("/admin/card-numbering");
    return { success: true, report };
  } catch (error) {
    console.error("Import error:", error);
    return { error: "تعذر معالجة ملف الاستيراد" };
  }
}

export async function migrateCardNumberingAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "migrate_card_numbering")) return { error: "غير مصرح" };

  const report = {
    total: ids.length,
    added: 0,
    updated: 0,
    failed: 0,
    details: [] as any[]
  };

  const migrationId = `MIG-${Date.now()}`;
  const changes = []; // لتخزين التغييرات لأغراض التراجع

  try {
    const items = await prisma.cardNumberingArchive.findMany({
      where: {
        id: { in: ids },
        status: "READY"
      },
    });

    for (const item of items) {
      try {
        // 1. البحث عن أي مستفيد موجود بنفس رقم البطاقة (حتى لو كان محذوفاً ناعماً)
        const existingByCard = await prisma.beneficiary.findFirst({
          where: {
            card_number: { equals: item.card_number.trim(), mode: "insensitive" }
          },
        });

        if (existingByCard) {
          // تحديث البيانات المستفيد الموجود بدلاً من الفشل
          const oldData = { ...existingByCard };
          await prisma.beneficiary.update({
            where: { id: existingByCard.id },
            data: {
              name: item.name,
              birth_date: item.birth_date || existingByCard.birth_date,
              city: item.city || existingByCard.city,           // ترحيل المدينة
              batch_number: item.batch_number || existingByCard.batch_number, // ترحيل رقم الدفعة
              deleted_at: null, // استعادة السجل إذا كان في سلة المحذوفات
              status: "ACTIVE"
            }
          });
          report.updated++;
          report.details.push({ name: item.name, card_number: item.card_number, status: "UPDATED", reason: existingByCard.deleted_at ? "استعادة وتحديث من المحذوفات" : "تحديث بيانات موجودة" });
          changes.push({
            type: "UPDATE",
            beneficiaryId: existingByCard.id,
            name: item.name,
            oldCard: oldData.card_number,
            newCard: item.card_number
          });

          await prisma.cardNumberingArchive.update({
            where: { id: item.id },
            data: { status: "MIGRATED", migrated_at: new Date() },
          });
          continue;
        }

        // 2. البحث بالرقم الوظيفي كخيار ثانٍ (إذا كان رقم البطاقة مختلفاً ولكن الشخص هو نفسه)
        const existingByEmp = await prisma.beneficiary.findFirst({
          where: {
            card_number: { startsWith: item.employee_number },
            name: { equals: item.name, mode: "insensitive" },
            deleted_at: null
          },
        });

        if (existingByEmp) {
          // تحديث رقم البطاقة لشخص موجود
          const oldData = { ...existingByEmp };
          await prisma.beneficiary.update({
            where: { id: existingByEmp.id },
            data: {
              card_number: item.card_number,
              birth_date: item.birth_date || existingByEmp.birth_date,
              city: item.city || existingByEmp.city,           // ترحيل المدينة
              batch_number: item.batch_number || existingByEmp.batch_number, // ترحيل رقم الدفعة
            }
          });
          report.updated++;
          report.details.push({ name: item.name, card_number: item.card_number, status: "UPDATED", reason: "تحديث رقم البطاقة لمستفيد موجود" });
          changes.push({
            type: "UPDATE",
            beneficiaryId: existingByEmp.id,
            name: item.name,
            oldCard: oldData.card_number,
            newCard: item.card_number
          });
        } else {
          // 3. إضافة جديد كلياً
          const newBen = await prisma.beneficiary.create({
            data: {
              name: item.name,
              card_number: item.card_number,
              birth_date: item.birth_date,
              city: item.city,           // ترحيل المدينة للجديد
              batch_number: item.batch_number, // ترحيل رقم الدفعة للجديد
              status: "ACTIVE",
              total_balance: 600,
              remaining_balance: 600,
            },
          });
          report.added++;
          report.details.push({ name: item.name, status: "ADDED", reason: "مستفيد جديد" });
          changes.push({
            type: "CREATE",
            beneficiaryId: newBen.id,
            name: item.name,
            card_number: item.card_number
          });
        }

        await prisma.cardNumberingArchive.update({
          where: { id: item.id },
          data: { status: "MIGRATED", migrated_at: new Date() },
        });

        // تسجيل عملية الترحيل في سجل حركات المستفيد
        await prisma.transaction.create({
          data: {
            beneficiary_id: changes[changes.length - 1].beneficiaryId,
            facility_id: session.id,
            amount: 0,
            type: "SETTLEMENT",
            idempotency_key: `MIG-REC-${item.id}`
          }
        });

      } catch (err) {
        report.failed++;
        report.details.push({ name: item.name, status: "FAIL", reason: "خطأ تقني أثناء الترحيل" });
      }
    }

    // سجل المراقبة
    await prisma.auditLog.create({
      data: {
        user: session.id,
        action: "CARD_NUMBERING_MIGRATION",
        metadata: {
          migrationId,
          report: { total: report.total, added: report.added, updated: report.updated, failed: report.failed },
          changes
        },
        facility_id: null
      }
    });

    revalidatePath("/admin/card-numbering");
    return { success: true, report };
  } catch (error) {
    return { error: "فشل عام في عملية الترحيل" };
  }
}

export async function rollbackMigrationAction(logId: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "migrate_card_numbering")) return { error: "غير مصرح" };

  try {
    const log = await prisma.auditLog.findUnique({ where: { id: logId } });
    if (!log || log.action !== "CARD_NUMBERING_MIGRATION") return { error: "سجل غير صالح" };

    const { changes } = log.metadata as any;

    for (const change of changes) {
      if (change.type === "CREATE") {
        await prisma.beneficiary.delete({ where: { id: change.beneficiaryId } });
      } else if (change.type === "UPDATE") {
        await prisma.beneficiary.update({
          where: { id: change.beneficiaryId },
          data: { card_number: change.oldCard }
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        user: session.id,
        action: "ROLLBACK_MIGRATION",
        metadata: { originalLogId: logId },
        facility_id: null
      }
    });

    return { success: true };
  } catch (error) {
    return { error: "فشل التراجع عن الترحيل" };
  }
}

export async function getMigrationLogs(search?: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  const logs = await prisma.auditLog.findMany({
    where: {
      action: "CARD_NUMBERING_MIGRATION",
      OR: search ? [
        { user: { contains: search, mode: "insensitive" } },
        { metadata: { path: ["migrationId"], string_contains: search } }
      ] : undefined
    },
    orderBy: { created_at: "desc" },
    take: 50
  });

  return { logs };
}

export async function deleteCardNumberingArchiveItemsAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.updateMany({
      where: { id: { in: ids } },
      data: { deleted_at: new Date() }
    });
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر نقل السجلات للسلة" };
  }
}

export async function restoreCardNumberingArchiveItemsAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.updateMany({
      where: { id: { in: ids } },
      data: { deleted_at: null }
    });
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر استعادة السجلات" };
  }
}

export async function permanentlyDeleteCardNumberingArchiveItemsAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.deleteMany({
      where: { id: { in: ids }, deleted_at: { not: null } } // أمان إضافي: الحذف النهائي فقط للمحذوف ناعما
    });
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر الحذف النهائي" };
  }
}

export async function clearCardNumberingArchiveAction() {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.deleteMany({});
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر مسح الأرشيف" };
  }
}
