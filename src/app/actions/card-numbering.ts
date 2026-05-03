"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/session-guard";

export type CardNumberingItem = {
  name: string;
  employee_number: string;
  relationship?: string; // صلة القرابة (موظف، زوجة، ابن، الخ)
  birth_date?: string;   // تاريخ الميلاد
  field3?: string;
};

// رموز اللاحقة للعائلة
const RELATIONSHIP_CODE_MAP: Record<string, string> = {
  "زوجة": "W", "ابن": "S", "ابنة": "D", "أم": "M", "أب": "F", "أخ": "B", "زوج": "H",
  "W": "W", "S": "S", "D": "D", "M": "M", "F": "F", "B": "B", "H": "H",
  "ابنه": "D", "ولد": "S", "والدة": "M", "والد": "F",
};

const MAIN_ACCOUNT_TERMS = ["موظف", "رب الأسرة", "صاحب البطاقة", "رئيسي", "MAIN", "EMPLOYEE"];

export async function getCardNumberingArchive(showDeleted: boolean = false) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    const items = await prisma.cardNumberingArchive.findMany({
      where: {
        deleted_at: showDeleted ? { not: null } : null
      },
      orderBy: { created_at: "desc" },
    });
    return { 
      items: items.map(item => ({
        ...item,
        created_at: item.created_at.toISOString(),
        migrated_at: item.migrated_at?.toISOString() || null,
        birth_date: item.birth_date?.toISOString().split('T')[0] || null,
      })) 
    };
  } catch (error) {
    return { error: "تعذر جلب الأرشيف" };
  }
}

export async function importCardNumberingAction(data: CardNumberingItem[], options: { prefix: string, padding: number, sourceFile?: string }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    const { prefix = "WAB2025", padding = 6, sourceFile = "يدوي" } = options;
    const report = { total: data.length, ready: 0, duplicate: 0, error: 0 };
    const countsPerEmp = new Map<string, Record<string, number>>();
    const seenInBatch = new Set<string>();

    for (const item of data) {
      const empNum = String(item.employee_number || "").trim();
      const name = String(item.name || "").trim();
      
      let status: any = "READY";
      let errorMsg: string | null = null;

      if (!empNum || !name) {
        status = "ERROR";
        errorMsg = "الاسم والرقم الوظيفي مطلوبان";
        report.error++;
      }

      const baseCard = prefix + empNum.padStart(padding, "0");
      let rel = String(item.relationship || "").trim();
      const isMain = !rel || MAIN_ACCOUNT_TERMS.includes(rel) || rel === "Employee";
      let relCode = isMain ? null : (RELATIONSHIP_CODE_MAP[rel] || null);

      let finalCardNumber = baseCard;

      // جلب كافة سجلات هذا الموظف من الأرشيف للمقارنة
      const empArchiveItems = await prisma.cardNumberingArchive.findMany({
        where: { employee_number: empNum },
        select: { id: true, name: true, relationship: true, card_number: true }
      });

      // تلافي التكرار والذكاء في التصحيح (داخل الكود لتجنب أخطاء قاعدة البيانات)
      const existingInArchive = empArchiveItems.find(item => {
        const isSameRel = item.relationship === (rel || null);
        if (!isSameRel) return false;

        // 1. تطابق تام بالاسم
        if (item.name.toLowerCase() === name.toLowerCase()) return true;

        // 2. إذا كان الاسم المسجل قديماً "مشبوهاً" (رقم أو تاريخ)، نعتبره هو نفس الشخص ونقوم بتصحيحه
        const isSuspicious = 
          item.name.includes("GMT") || 
          item.name.includes("Time") || 
          /^\d+$/.test(item.name);
          
        return isSuspicious;
      });

      if (existingInArchive) {
        finalCardNumber = existingInArchive.card_number;
      } else if (relCode && status !== "ERROR") {
        if (!countsPerEmp.has(empNum)) {
          const existing = await prisma.cardNumberingArchive.findMany({
            where: { employee_number: empNum, relationship: { not: null } },
            select: { card_number: true }
          });
          const dbCounts: Record<string, number> = {};
          existing.forEach(e => {
            const m = e.card_number.match(/[A-Z](\d+)$/);
            if (m) {
              const code = e.card_number.charAt(baseCard.length);
              const idx = parseInt(m[1], 10);
              dbCounts[code] = Math.max(dbCounts[code] || 0, idx);
            }
          });
          countsPerEmp.set(empNum, dbCounts);
        }
        const batchCounts = countsPerEmp.get(empNum)!;
        const nextIdx = (batchCounts[relCode] || 0) + 1;
        batchCounts[relCode] = nextIdx;
        finalCardNumber = `${baseCard}${relCode}${nextIdx}`;
      }

      const rowKey = `${empNum}-${rel || "M"}`;
      
      // 1. الأولوية: التحقق من التكرار داخل نفس الملف الحالي (تصفية الملف أولاً)
      if (seenInBatch.has(rowKey)) {
        status = "DUPLICATE";
        errorMsg = "[FILE] مكرر في نفس الملف";
        report.duplicate++;
      } 
      // 2. التحقق من التكرار في المنظومة الرئيسية (المستفيدين الفعليين)
      else {
        const existingInSystem = await prisma.beneficiary.findFirst({
          where: { card_number: { equals: finalCardNumber, mode: "insensitive" }, deleted_at: null }
        });

        if (existingInSystem) {
          status = "DUPLICATE";
          errorMsg = "[SYSTEM] موجود مسبقاً في المنظومة";
          report.duplicate++;
        } 
        // 3. التحقق من التكرار في الأرشيف (دفعات سابقة)
        else if (existingInArchive && existingInArchive.name.toLowerCase() === name.toLowerCase()) {
          status = "DUPLICATE";
          errorMsg = "[ARCHIVE] موجود مسبقاً في دفعات الأرشيف";
          report.duplicate++;
        } else {
          report.ready++;
        }
      }

      seenInBatch.add(rowKey);

      let bDate = null;
      if (item.birth_date) {
        const d = new Date(item.birth_date);
        if (!isNaN(d.getTime())) bDate = d;
      }

      await prisma.cardNumberingArchive.upsert({
        where: { card_number: finalCardNumber },
        update: {
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: bDate,
          status,
          error_message: errorMsg,
          source_file: sourceFile,
          deleted_at: null // استعادة السجل إذا تمت إعادة استيراده
        },
        create: {
          card_number: finalCardNumber,
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: bDate,
          status,
          error_message: errorMsg,
          source_file: sourceFile,
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
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

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
        // 1. البحث عن مستفيد موجود بنفس الرقم الوظيفي (تحديث) أو رقم البطاقة (تكرار خطأ)
        const existingByCard = await prisma.beneficiary.findFirst({
          where: { card_number: item.card_number, deleted_at: null },
        });

        if (existingByCard) {
          report.failed++;
          report.details.push({ name: item.name, status: "FAIL", reason: "رقم البطاقة مستخدم بالفعل" });
          continue;
        }

        // البحث بالرقم الوظيفي للتحديث
        const existingByEmp = await prisma.beneficiary.findFirst({
          where: { 
            card_number: { startsWith: item.employee_number }, // افتراض أن الرقم الوظيفي جزء من الهوية
            name: item.name,
            deleted_at: null 
          },
        });

        if (existingByEmp) {
          // تحديث
          const oldData = { ...existingByEmp };
          await prisma.beneficiary.update({
            where: { id: existingByEmp.id },
            data: { 
              card_number: item.card_number,
              birth_date: item.birth_date || existingByEmp.birth_date,
            }
          });
          report.updated++;
          report.details.push({ name: item.name, status: "UPDATED", reason: "تحديث بطاقة موجودة" });
          changes.push({ type: "UPDATE", beneficiaryId: existingByEmp.id, oldCard: oldData.card_number, newCard: item.card_number });
        } else {
          // إضافة جديد
          const newBen = await prisma.beneficiary.create({
            data: {
              name: item.name,
              card_number: item.card_number,
              birth_date: item.birth_date,
              status: "ACTIVE",
              total_balance: 600,
              remaining_balance: 600,
            },
          });
          report.added++;
          report.details.push({ name: item.name, status: "ADDED", reason: "مستفيد جديد" });
          changes.push({ type: "CREATE", beneficiaryId: newBen.id });
        }

        await prisma.cardNumberingArchive.update({
          where: { id: item.id },
          data: { status: "MIGRATED", migrated_at: new Date() },
        });

      } catch (err) {
        report.failed++;
        report.details.push({ name: item.name, status: "FAIL", reason: "خطأ تقني أثناء الترحيل" });
      }
    }

    // سجل المراقبة
    await prisma.auditLog.create({
      data: {
        user: session.user_id,
        action: "CARD_NUMBERING_MIGRATION",
        metadata: {
          migrationId,
          report: { total: report.total, added: report.added, updated: report.updated, failed: report.failed },
          changes
        },
        facility_id: session.facility_id
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
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

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
        user: session.user_id,
        action: "ROLLBACK_MIGRATION",
        metadata: { originalLogId: logId },
        facility_id: session.facility_id
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
