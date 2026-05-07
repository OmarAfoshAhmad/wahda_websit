"use server";

import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";

export type RegistryImportItem = {
  card_number: string;
  name?: string | null;
  birth_date?: string | null;
  city: string;
  batch_number: string;
  source_file?: string;
  source_sheet?: string;
  source_row?: number;
};

// التحقق من تكرار البطاقات في النظام دفعة واحدة لتسريع المعاينة والتحقق
export async function validateTruthRegistryAction(items: { card_number: string }[]) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  try {
    const cardNumbers = items.map(item => item.card_number.trim().toUpperCase());
    
    // جلب كافة السجلات المتطابقة من جدول الحقيقة
    const existing = await prisma.cardIssuanceRegistry.findMany({
      where: { card_number_upper: { in: cardNumbers } },
      select: {
        card_number_upper: true,
        beneficiary_name: true,
        city: true,
        batch_number: true,
      }
    });

    const existingMap = new Map();
    existing.forEach(card => {
      existingMap.set(card.card_number_upper, {
        name: card.beneficiary_name,
        city: card.city,
        batch: card.batch_number
      });
    });

    return { success: true, existing: Array.from(existingMap.entries()) };
  } catch (error) {
    console.error("Validation error:", error);
    return { error: "فشل في التحقق من تكرار السجلات في النظام" };
  }
}

export async function importTruthRegistryAction(
  items: RegistryImportItem[],
  options: { overwriteExisting: boolean } = { overwriteExisting: true }
) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  if (!items || items.length === 0) return { error: "لا توجد بيانات للاستيراد" };

  try {
    const { overwriteExisting = true } = options;
    const batchSize = 1000;
    let added = 0;
    let updated = 0;
    let skipped = 0;

    // جلب البطاقات الموجودة مسبقاً لتحديد ما إذا كان السجل مضافاً حديثاً أم مكرراً
    const cardNumbers = items.map(item => item.card_number.trim().toUpperCase());
    const existingInDb = await prisma.cardIssuanceRegistry.findMany({
      where: { card_number_upper: { in: cardNumbers } },
      select: {
        card_number_upper: true,
        beneficiary_name: true,
        birth_date: true,
      }
    });

    const existingMap = new Map(existingInDb.map(c => [c.card_number_upper, c]));

    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      
      for (const item of chunk) {
        const cardUpper = item.card_number.trim().toUpperCase();
        const exists = existingMap.has(cardUpper);

        // إذا كان موجوداً مسبقاً واخترنا عدم الكتابة فوق البيانات (تخطي)، نقوم بتخطيه
        if (exists && !overwriteExisting) {
          skipped++;
          continue;
        }

        const existingRecord = existingMap.get(cardUpper);
        
        // المحافظة على البيانات القديمة إذا كانت الحقول الجديدة فارغة في شيت الإكسيل (حسب رغبة المستخدم)
        const finalName = (item.name && item.name.trim() !== "") 
          ? item.name.trim() 
          : (existingRecord?.beneficiary_name || null);

        let finalBirthDate = existingRecord?.birth_date || null;
        if (item.birth_date) {
          const parsedDate = new Date(item.birth_date);
          if (!isNaN(parsedDate.getTime())) {
            finalBirthDate = parsedDate;
          }
        }

        // 1. تحديث أو إنشاء في السجل الكامل (CardIssuanceRegistryAll)
        await prisma.cardIssuanceRegistryAll.upsert({
          where: { id: `${cardUpper}-${item.batch_number}` },
          update: {
            card_number: item.card_number,
            card_number_upper: cardUpper,
            beneficiary_name: finalName,
            birth_date: finalBirthDate,
            city: item.city,
            batch_number: item.batch_number,
            source_file: item.source_file,
            source_sheet: item.source_sheet,
            source_row: item.source_row,
            updated_at: new Date(),
          },
          create: {
            id: `${cardUpper}-${item.batch_number}`,
            card_number: item.card_number,
            card_number_upper: cardUpper,
            canonical_card: cardUpper,
            beneficiary_name: finalName,
            birth_date: finalBirthDate,
            city: item.city,
            batch_number: item.batch_number,
            source_file: item.source_file,
            source_sheet: item.source_sheet,
            source_row: item.source_row,
          },
        });

        // 2. تحديث أو إنشاء في السجل الموحد (CardIssuanceRegistry)
        await prisma.cardIssuanceRegistry.upsert({
          where: { card_number_upper: cardUpper },
          update: {
            beneficiary_name: finalName,
            birth_date: finalBirthDate,
            city: item.city,
            batch_number: item.batch_number,
            updated_at: new Date(),
          },
          create: {
            card_number: item.card_number,
            card_number_upper: cardUpper,
            canonical_card: cardUpper,
            beneficiary_name: finalName,
            birth_date: finalBirthDate,
            city: item.city,
            batch_number: item.batch_number,
          },
        });

        if (exists) {
          updated++;
        } else {
          added++;
        }
      }
    }

    revalidatePath("/admin/truth-registry");
    return { success: true, added, updated, skipped };
  } catch (error) {
    console.error("Registry import error:", error);
    return { error: "حدث خطأ أثناء حفظ البيانات في قاعدة البيانات" };
  }
}
