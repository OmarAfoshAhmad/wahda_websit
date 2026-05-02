"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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

export async function getCardNumberingArchive() {
  const session = await getSession();
  if (!session?.is_admin) return { error: "غير مصرح" };

  try {
    const items = await prisma.cardNumberingArchive.findMany({
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

export async function importCardNumberingAction(data: CardNumberingItem[]) {
  const session = await getSession();
  if (!session?.is_admin) return { error: "غير مصرح" };

  try {
    const report = { total: data.length, ready: 0, duplicate: 0, error: 0 };
    const countsPerEmp = new Map<string, Record<string, number>>();

    for (const item of data) {
      const empNum = String(item.employee_number || "").trim();
      const name = String(item.name || "").trim();
      
      let status: "READY" | "ERROR" | "DUPLICATE" = "READY";
      let errorMsg = null;

      if (!empNum || !name) {
        status = "ERROR";
        errorMsg = "الاسم والرقم الوظيفي مطلوبان";
        report.error++;
      }

      const baseCard = "WAB2025" + empNum.padStart(6, "0");
      let rel = String(item.relationship || "").trim();
      const isMain = !rel || MAIN_ACCOUNT_TERMS.includes(rel) || rel === "Employee";
      let relCode = isMain ? null : (RELATIONSHIP_CODE_MAP[rel] || null);

      let finalCardNumber = baseCard;
      if (relCode && status !== "ERROR") {
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

      // التحقق من التكرار في جدول المستفيدين الرئيسي
      if (status === "READY") {
        const existingBeneficiary = await prisma.beneficiary.findFirst({
          where: { card_number: { equals: finalCardNumber, mode: "insensitive" }, deleted_at: null }
        });
        if (existingBeneficiary) {
          status = "DUPLICATE";
          errorMsg = "موجود مسبقاً في المستفيدين";
          report.duplicate++;
        } else {
          report.ready++;
        }
      }

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
          field3: String(item.field3 || "").trim(),
        },
        create: {
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: bDate,
          card_number: finalCardNumber,
          status,
          error_message: errorMsg,
          field3: String(item.field3 || "").trim(),
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
  if (!session?.is_admin) return { error: "غير مصرح" };

  try {
    const items = await prisma.cardNumberingArchive.findMany({
      where: { 
        id: { in: ids },
        status: "READY" // ترحيل الجاهز فقط
      },
    });

    if (items.length === 0) {
      return { error: "لا توجد سجلات جاهزة للترحيل في التحديد الحالي" };
    }

    let successCount = 0;

    for (const item of items) {
      // التحقق النهائي قبل الترحيل
      const existing = await prisma.beneficiary.findFirst({
        where: { card_number: { equals: item.card_number, mode: "insensitive" }, deleted_at: null },
      });

      if (existing) {
        await prisma.cardNumberingArchive.update({
          where: { id: item.id },
          data: { status: "DUPLICATE", error_message: "تم اكتشاف تكرار عند الترحيل" },
        });
        continue;
      }

      await prisma.beneficiary.create({
        data: {
          name: item.name,
          card_number: item.card_number,
          birth_date: item.birth_date,
          status: "ACTIVE",
          total_balance: 600,     // سقف الرصيد الجديد
          remaining_balance: 600, // الرصيد المتاح حالياً
        },
      });

      await prisma.cardNumberingArchive.update({
        where: { id: item.id },
        data: { 
          status: "MIGRATED", 
          migrated_at: new Date() 
        },
      });
      successCount++;
    }

    revalidatePath("/beneficiaries");
    revalidatePath("/admin/card-numbering");
    return { success: true, successCount };
  } catch (error) {
    console.error("Migration error:", error);
    return { error: "حدث خطأ أثناء ترحيل البيانات" };
  }
}

export async function deleteCardNumberingArchiveItemsAction(ids: string[]) {
  const session = await getSession();
  if (!session?.is_admin) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.deleteMany({
      where: { id: { in: ids } },
    });
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر حذف السجلات" };
  }
}

export async function clearCardNumberingArchiveAction() {
  const session = await getSession();
  if (!session?.is_admin) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.deleteMany({});
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر مسح الأرشيف" };
  }
}
