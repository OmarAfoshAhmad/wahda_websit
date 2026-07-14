"use server";

import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";

export type RegistryImportItem = {
  card_number: string;
  name: string;
  birth_date?: string | null;
  city: string;
  batch_number: string;
  source_file?: string;
  source_sheet?: string;
  source_row?: number;
};

export async function importTruthRegistryAction(items: RegistryImportItem[]) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  if (!items || items.length === 0) return { error: "لا توجد بيانات للاستيراد" };

  try {
    // نقوم بالاستيراد على دفعات لتجنب مشاكل الذاكرة أو المهلة
    const batchSize = 1000;
    let added = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      
      for (const item of chunk) {
        const cardUpper = item.card_number.trim().toUpperCase();
        
        // تحديث أو إنشاء في CardIssuanceRegistryAll (السجل الكامل)
        await prisma.cardIssuanceRegistryAll.upsert({
          where: { id: `${cardUpper}-${item.batch_number}` }, // معرف فريد مركب
          update: {
            card_number: item.card_number,
            card_number_upper: cardUpper,
            beneficiary_name: item.name,
            birth_date: item.birth_date ? new Date(item.birth_date) : null,
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
            canonical_card: cardUpper, // تبسيطاً في البداية
            beneficiary_name: item.name,
            birth_date: item.birth_date ? new Date(item.birth_date) : null,
            city: item.city,
            batch_number: item.batch_number,
            source_file: item.source_file,
            source_sheet: item.source_sheet,
            source_row: item.source_row,
          },
        });

        // تحديث أو إنشاء في CardIssuanceRegistry (السجل الموحد - الفريد برقم البطاقة)
        // ملاحظة: هنا نستخدم منطق "الأولوية" لأحدث سجل أو السجل الذي يحتوي على بيانات أكثر
        await prisma.cardIssuanceRegistry.upsert({
          where: { card_number_upper: cardUpper },
          update: {
            beneficiary_name: item.name || undefined,
            birth_date: item.birth_date ? new Date(item.birth_date) : undefined,
            city: item.city,
            batch_number: item.batch_number,
            updated_at: new Date(),
          },
          create: {
            card_number: item.card_number,
            card_number_upper: cardUpper,
            canonical_card: cardUpper,
            beneficiary_name: item.name,
            birth_date: item.birth_date ? new Date(item.birth_date) : null,
            city: item.city,
            batch_number: item.batch_number,
          },
        });
        
        added++;
      }
    }

    revalidatePath("/admin/truth-registry");
    return { success: true, added };
  } catch (error) {
    console.error("Registry import error:", error);
    return { error: "حدث خطأ أثناء حفظ البيانات في قاعدة البيانات" };
  }
}
