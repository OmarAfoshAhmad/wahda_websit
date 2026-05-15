"use server";

import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import { canonicalizeCardNumber } from "@/lib/normalize";

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
            const year = parsedDate.getFullYear();
            if (year >= 1850 && year <= 2100) {
              finalBirthDate = parsedDate;
            }
          }
        }

        const canonical = canonicalizeCardNumber(cardUpper);

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
            canonical_card: canonical,
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
            canonical_card: canonical,
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

export async function deleteTruthRegistryRowsAction(ids: string[]) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  if (!ids || ids.length === 0) return { error: "لم يتم تحديد سجلات للحذف" };

  try {
    // 1. جلب السجلات المراد حذفها لمعرفة أرقام بطاقاتها
    const recordsToDelete = await prisma.cardIssuanceRegistryAll.findMany({
      where: { id: { in: ids } },
      select: { card_number_upper: true }
    });

    const cardNumbers = Array.from(new Set(recordsToDelete.map(r => r.card_number_upper)));

    // 2. حذف السجلات من CardIssuanceRegistryAll
    await prisma.cardIssuanceRegistryAll.deleteMany({
      where: { id: { in: ids } }
    });

    // 3. لكل بطاقة تم مس منها سجل، نقوم بتحديث أو حذف السجل الموحد CardIssuanceRegistry
    for (const cardUpper of cardNumbers) {
      // البحث عن أي سجلات متبقية لهذه البطاقة في CardIssuanceRegistryAll
      const remaining = await prisma.cardIssuanceRegistryAll.findFirst({
        where: { card_number_upper: cardUpper },
        orderBy: { updated_at: "desc" }
      });

      if (remaining) {
        // إذا كان هناك سجل متبقٍ، نقوم بتحديث السجل الموحد ببياناته
        await prisma.cardIssuanceRegistry.update({
          where: { card_number_upper: cardUpper },
          data: {
            beneficiary_name: remaining.beneficiary_name,
            birth_date: remaining.birth_date,
            city: remaining.city,
            batch_number: remaining.batch_number,
            updated_at: new Date()
          }
        });
      } else {
        // إذا لم يتبقَ أي سجل لهذه البطاقة، نقوم بحذفها تماماً من السجل الموحد
        await prisma.cardIssuanceRegistry.delete({
          where: { card_number_upper: cardUpper }
        }).catch(() => {}); // نتفادى أي خطأ في حال كانت غير موجودة مسبقاً
      }
    }

    revalidatePath("/admin/truth-registry");
    return { success: true };
  } catch (error) {
    console.error("Delete registry rows error:", error);
    return { error: "حدث خطأ أثناء حذف السجلات" };
  }
}

export async function deleteFilteredTruthRegistryAction(filters: {
  query?: string;
  city?: string;
  batch?: string;
  multi?: boolean;
  not_in_system?: boolean;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  try {
    const query = (filters.query ?? "").trim();
    const cityFilter = (filters.city ?? "").trim();
    const batchFilter = (filters.batch ?? "").trim();
    const isNoBatchFilter = batchFilter === "__NO_BATCH__";
    const onlyMultiBatch = filters.multi === true;
    const onlyMissingInSystem = filters.not_in_system === true;

    // 1. جلب السجلات المطابقة للتصفية لمعرفة معرفاتها وأرقام بطاقاتها
    const rows = await prisma.$queryRaw<{ id: string, card_number_upper: string }[]>`
      WITH filtered AS (
        SELECT id, card_number_upper
        FROM "CardIssuanceRegistryAll"
        WHERE (${cityFilter} = '' OR city = ${cityFilter})
          AND (
            (${batchFilter} = '')
            OR (${isNoBatchFilter} = true AND (batch_number IS NULL OR BTRIM(batch_number) = ''))
            OR (${isNoBatchFilter} = false AND batch_number = ${batchFilter})
          )
          AND (
            ${query} = ''
            OR card_number ILIKE ${`%${query}%`}
            OR COALESCE(beneficiary_name, '') ILIKE ${`%${query}%`}
            OR COALESCE(source_file, '') ILIKE ${`%${query}%`}
          )
          AND (
            ${onlyMissingInSystem} = false
            OR REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') NOT IN (
              SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
              FROM "Beneficiary"
              WHERE deleted_at IS NULL
            )
          )
      ),
      stats AS (
        SELECT
          card_number_upper,
          COUNT(DISTINCT COALESCE(NULLIF(BTRIM(batch_number), ''), '__NO_BATCH__'))::int AS batches_count
        FROM "CardIssuanceRegistryAll"
        GROUP BY card_number_upper
      )
      SELECT f.id, f.card_number_upper
      FROM filtered f
      JOIN stats s ON s.card_number_upper = f.card_number_upper
      WHERE (${onlyMultiBatch} = false OR s.batches_count > 1)
    `;

    if (rows.length === 0) return { success: true, deletedCount: 0 };

    const ids = rows.map(r => r.id);
    const cardNumbers = Array.from(new Set(rows.map(r => r.card_number_upper)));

    // 2. حذف السجلات من CardIssuanceRegistryAll في حزم دفعات
    const chunkSize = 5000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      await prisma.cardIssuanceRegistryAll.deleteMany({
        where: { id: { in: chunk } }
      });
    }

    // 3. لكل بطاقة تم مس منها سجل، نقوم بتحديث أو حذف السجل الموحد CardIssuanceRegistry
    for (const cardUpper of cardNumbers) {
      const remaining = await prisma.cardIssuanceRegistryAll.findFirst({
        where: { card_number_upper: cardUpper },
        orderBy: { updated_at: "desc" }
      });

      if (remaining) {
        await prisma.cardIssuanceRegistry.update({
          where: { card_number_upper: cardUpper },
          data: {
            beneficiary_name: remaining.beneficiary_name,
            birth_date: remaining.birth_date,
            city: remaining.city,
            batch_number: remaining.batch_number,
            updated_at: new Date()
          }
        });
      } else {
        await prisma.cardIssuanceRegistry.delete({
          where: { card_number_upper: cardUpper }
        }).catch(() => {});
      }
    }

    revalidatePath("/admin/truth-registry");
    return { success: true, deletedCount: ids.length };
  } catch (error) {
    console.error("Delete filtered registry rows error:", error);
    return { error: "حدث خطأ أثناء حذف السجلات المطابقة للتصفية" };
  }
}

