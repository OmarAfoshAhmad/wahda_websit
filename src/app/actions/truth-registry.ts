"use server";

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import { canonicalizeCardNumber } from "@/lib/normalize";
import { WAHDA_BANK_COMPANY_ID } from "@/lib/constants";
import { mergeDuplicateBeneficiaries } from "./beneficiary/merge";

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
    const normalizedCards = Array.from(
      new Set(
        items
          .map((item) => (item.card_number ?? "").trim().toUpperCase())
          .filter((card) => card.length > 0)
      )
    );
    const canonicalCards = Array.from(
      new Set(normalizedCards.map((card) => canonicalizeCardNumber(card)))
    );

    if (canonicalCards.length === 0) {
      return { success: true, existing: [], existing_truth: [], existing_system: [] };
    }

    // جلب السجلات الموجودة مسبقاً في جدول الحقيقة (مع مراعاة التطبيع)
    const existingTruthRows = await prisma.cardIssuanceRegistry.findMany({
      where: {
        OR: [
          { card_number_upper: { in: normalizedCards } },
          { canonical_card: { in: canonicalCards } },
        ],
      },
      select: {
        card_number_upper: true,
        canonical_card: true,
        beneficiary_name: true,
        city: true,
        batch_number: true,
        updated_at: true,
      },
      orderBy: { updated_at: "desc" },
    });

    const existingTruthMap = new Map<string, { name: string | null; city: string; batch: string | null }>();
    for (const row of existingTruthRows) {
      if (!existingTruthMap.has(row.canonical_card)) {
        existingTruthMap.set(row.canonical_card, {
          name: row.beneficiary_name,
          city: row.city,
          batch: row.batch_number,
        });
      }
    }

    // جلب السجلات الموجودة بالمنظومة (Beneficiary) حتى تظهر حالتها "موجود في النظام"
    type ExistingSystemRow = {
      canonical_card: string;
      name: string | null;
      city: string | null;
      batch_number: string | null;
    };

    const existingSystemRows = await prisma.$queryRaw<ExistingSystemRow[]>`
      SELECT DISTINCT ON (canonical_card)
        canonical_card,
        name,
        city,
        batch_number
      FROM (
        SELECT
          REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card,
          name,
          city,
          batch_number,
          created_at
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          AND REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ANY(${canonicalCards}::text[])
      ) s
      ORDER BY canonical_card, created_at DESC
    `;

    const existingSystemMap = new Map<string, { name: string | null; city: string | null; batch: string | null }>();
    for (const row of existingSystemRows) {
      if (!existingSystemMap.has(row.canonical_card)) {
        existingSystemMap.set(row.canonical_card, {
          name: row.name,
          city: row.city,
          batch: row.batch_number,
        });
      }
    }

    return {
      success: true,
      // إبقاء هذا المفتاح للتوافق الخلفي (حالياً يساوي بيانات جدول الحقيقة)
      existing: Array.from(existingTruthMap.entries()),
      existing_truth: Array.from(existingTruthMap.entries()),
      existing_system: Array.from(existingSystemMap.entries()),
    };
  } catch (error) {
    console.error("Validation error:", error);
    return { error: "فشل في التحقق من تكرار السجلات في النظام" };
  }
}

export async function cleanImportTruthRegistryAction(
  items: RegistryImportItem[],
) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  if (!items || items.length === 0) return { error: "لا توجد بيانات للاستيراد" };

  try {
    // حذف كامل لجدول الحقيقة الكامل (CardIssuanceRegistryAll) وجدول الحقيقة الموحد (CardIssuanceRegistry)
    await prisma.cardIssuanceRegistryAll.deleteMany({});
    await prisma.cardIssuanceRegistry.deleteMany({});
  } catch (err) {
    console.error("Clean import — delete error:", err);
    return { error: "فشل حذف البيانات القديمة قبل الاستيراد" };
  }

  // إعادة الاستيراد من الصفر
  return importTruthRegistryAction(items, { overwriteExisting: false });
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

    const preparedItems = items
      .map((item) => {
        const cardUpper = (item.card_number ?? "").trim().toUpperCase();
        const canonicalCard = cardUpper ? canonicalizeCardNumber(cardUpper) : "";
        const normalizedBatch = String(item.batch_number ?? "").trim();
        return {
          ...item,
          cardUpper,
          canonicalCard,
          normalizedBatch,
        };
      });

    const validItems = preparedItems.filter(
      (item) => item.cardUpper.length > 0 && item.canonicalCard.length > 0 && item.normalizedBatch.length > 0
    );
    if (validItems.length === 0) {
      return { error: "لا توجد سجلات صالحة بعد التطبيع (تحقق من رقم البطاقة ورقم الدفعة)" };
    }

    // إزالة تكرار السجل نفسه داخل نفس عملية الاستيراد (canonical + batch)
    const dedupedByCanonicalBatch = new Map<string, (typeof validItems)[number]>();
    for (const item of validItems) {
      const key = `${item.canonicalCard}::${item.normalizedBatch}`;
      if (!dedupedByCanonicalBatch.has(key)) {
        dedupedByCanonicalBatch.set(key, item);
      }
    }

    const importItems = Array.from(dedupedByCanonicalBatch.values());
    const normalizedCards = Array.from(new Set(importItems.map((item) => item.cardUpper)));
    const canonicalCards = Array.from(new Set(importItems.map((item) => item.canonicalCard)));

    // جلب سجل الحقيقة الموحد (CardIssuanceRegistry) اعتماداً على الرقم المطبع/الموحّد
    const existingUnifiedRows = await prisma.cardIssuanceRegistry.findMany({
      where: {
        OR: [
          { card_number_upper: { in: normalizedCards } },
          { canonical_card: { in: canonicalCards } },
        ],
      },
      select: {
        id: true,
        card_number_upper: true,
        canonical_card: true,
        beneficiary_name: true,
        birth_date: true,
        city: true,
        batch_number: true,
      },
      orderBy: { updated_at: "desc" },
    });

    const truthByCanonical = new Map<
      string,
      {
        id: string;
        card_number_upper: string;
        canonical_card: string;
        beneficiary_name: string | null;
        birth_date: Date | null;
        city: string;
        batch_number: string | null;
      }
    >();
    const truthByPersonKey = new Map<
      string,
      {
        id: string;
        card_number_upper: string;
        canonical_card: string;
        beneficiary_name: string | null;
        birth_date: Date | null;
        city: string;
        batch_number: string | null;
      }
    >();
    for (const row of existingUnifiedRows) {
      if (!truthByCanonical.has(row.canonical_card)) {
        truthByCanonical.set(row.canonical_card, row);
      }
      const personKey = `${normalizeNameLoose(row.beneficiary_name)}::${birthKey(row.birth_date)}`;
      if (
        normalizeNameLoose(row.beneficiary_name) &&
        birthKey(row.birth_date) &&
        !truthByPersonKey.has(personKey)
      ) {
        truthByPersonKey.set(personKey, row);
      }
    }

    // جلب التفاصيل الموجودة في جدول الحقيقة الكامل لنفس canonical (كل الدفعات)
    // الهدف: إذا جاء نفس الشخص/نفس canonical في دفعة أخرى نُحدّث السجل بدل إنشاء سجل جديد.
    const existingAllRows = await prisma.cardIssuanceRegistryAll.findMany({
      where: {
        canonical_card: { in: canonicalCards },
      },
      select: {
        id: true,
        card_number: true,
        card_number_upper: true,
        canonical_card: true,
        beneficiary_name: true,
        birth_date: true,
        city: true,
        batch_number: true,
        source_file: true,
        source_sheet: true,
        source_row: true,
        updated_at: true,
      },
      orderBy: { updated_at: "desc" },
    });

    const allByCanonicalBatch = new Map<
      string,
      {
        id: string;
        card_number: string;
        card_number_upper: string;
        canonical_card: string;
        beneficiary_name: string | null;
        birth_date: Date | null;
        city: string;
        batch_number: string;
        source_file: string | null;
        source_sheet: string | null;
        source_row: number | null;
      }
    >();
    const allLatestByCanonical = new Map<
      string,
      {
        id: string;
        card_number: string;
        card_number_upper: string;
        canonical_card: string;
        beneficiary_name: string | null;
        birth_date: Date | null;
        city: string;
        batch_number: string;
        source_file: string | null;
        source_sheet: string | null;
        source_row: number | null;
      }
    >();
    const allByPersonKey = new Map<
      string,
      {
        id: string;
        card_number: string;
        card_number_upper: string;
        canonical_card: string;
        beneficiary_name: string | null;
        birth_date: Date | null;
        city: string;
        batch_number: string;
        source_file: string | null;
        source_sheet: string | null;
        source_row: number | null;
      }
    >();
    const allByNameFamilyBase = new Map<
      string,
      {
        id: string;
        card_number: string;
        card_number_upper: string;
        canonical_card: string;
        beneficiary_name: string | null;
        birth_date: Date | null;
        city: string;
        batch_number: string;
        source_file: string | null;
        source_sheet: string | null;
        source_row: number | null;
      }
    >();
    const duplicateAllIdsToDelete: string[] = [];
    for (const row of existingAllRows) {
      const key = `${row.canonical_card}::${row.batch_number}`;
      if (!allByCanonicalBatch.has(key)) {
        allByCanonicalBatch.set(key, row);
      } else {
        // تنظيف تكرارات قديمة لنفس canonical+batch في جدول الحقيقة الكامل
        duplicateAllIdsToDelete.push(row.id);
      }

      if (!allLatestByCanonical.has(row.canonical_card)) {
        allLatestByCanonical.set(row.canonical_card, row);
      }

      const rowNameNorm = normalizeNameLoose(row.beneficiary_name);
      const rowBirthKey = birthKey(row.birth_date);
      if (rowNameNorm && rowBirthKey) {
        const pKey = `${rowNameNorm}::${rowBirthKey}`;
        if (!allByPersonKey.has(pKey)) {
          allByPersonKey.set(pKey, row);
        }
      } else if (rowNameNorm) {
        const fBase = familyBaseFromCard(String(row.canonical_card ?? row.card_number_upper ?? ""));
        const nKey = `${rowNameNorm}::${fBase}`;
        if (!allByNameFamilyBase.has(nKey)) {
          allByNameFamilyBase.set(nKey, row);
        }
      }
    }

    if (duplicateAllIdsToDelete.length > 0) {
      await prisma.cardIssuanceRegistryAll.deleteMany({
        where: { id: { in: duplicateAllIdsToDelete } },
      });
    }

    for (let i = 0; i < importItems.length; i += batchSize) {
      const chunk = importItems.slice(i, i + batchSize);
      
      for (const item of chunk) {
        const canonical = item.canonicalCard;
        const batchNumber = item.normalizedBatch;
        const currentName = item.name && item.name.trim() !== "" ? item.name.trim() : null;
        const currentBirthCandidate =
          item.birth_date && !Number.isNaN(new Date(item.birth_date).getTime())
            ? new Date(item.birth_date)
            : null;
        const normalizedName = normalizeNameLoose(currentName);
        const personKey =
          normalizedName && currentBirthCandidate ? `${normalizedName}::${birthKey(currentBirthCandidate)}` : "";
        const familyBase = familyBaseFromCard(canonical);
        const nameFamilyKey = normalizedName ? `${normalizedName}::${familyBase}` : "";

        const existingByCanonical = truthByCanonical.get(canonical);
        const existingByPerson =
          overwriteExisting && personKey ? truthByPersonKey.get(personKey) : undefined;
        const existsInTruth = Boolean(existingByCanonical || existingByPerson);

        // إذا كان موجوداً مسبقاً واخترنا عدم الكتابة فوق البيانات (تخطي)، نقوم بتخطيه
        if (existsInTruth && !overwriteExisting) {
          skipped++;
          continue;
        }

        const existingRecord = existingByCanonical ?? existingByPerson;
        
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

        const finalCardNumber = item.card_number;

        // 1. تحديث أو إنشاء في السجل الكامل (CardIssuanceRegistryAll) بدون تكرار canonical+batch
        const allKey = `${canonical}::${batchNumber}`;
        const existingAllForKey =
          allByCanonicalBatch.get(allKey) ||
          (overwriteExisting
            ? allLatestByCanonical.get(canonical) ||
              (personKey ? allByPersonKey.get(personKey) : undefined) ||
              (nameFamilyKey ? allByNameFamilyBase.get(nameFamilyKey) : undefined)
            : undefined);
        if (existingAllForKey) {
          const oldKey = `${existingAllForKey.canonical_card}::${existingAllForKey.batch_number}`;
          const reusedByFallback = oldKey !== allKey;
          await prisma.cardIssuanceRegistryAll.update({
            where: { id: existingAllForKey.id },
            data: {
              card_number: finalCardNumber,
              card_number_upper: canonical,
              canonical_card: canonical,
              beneficiary_name: finalName,
              birth_date: finalBirthDate,
              city: item.city,
              batch_number: batchNumber,
              source_file: item.source_file,
              source_sheet: item.source_sheet,
              source_row: item.source_row,
              updated_at: new Date(),
            },
          });

          // عند إعادة استخدام سجل موجود بسبب نفس canonical أو نفس الشخص، نحذف النسخ المكررة
          // لنفس الشخص/الترقيم حتى لا يظهر كسجل جديد أثناء الاستيراد.
          if (reusedByFallback) {
            const normalizedFinalName = normalizeNameLoose(finalName);
            const finalBirthKey = birthKey(finalBirthDate);
            if (normalizedFinalName) {
              if (finalBirthKey) {
                await prisma.$executeRaw`
                  DELETE FROM "CardIssuanceRegistryAll"
                  WHERE id <> ${existingAllForKey.id}
                    AND canonical_card = ${canonical}
                    AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) = ${normalizedFinalName}
                    AND birth_date IS NOT NULL
                    AND birth_date::date = ${finalBirthKey}::date
                `;
              } else {
                await prisma.$executeRaw`
                  DELETE FROM "CardIssuanceRegistryAll"
                  WHERE id <> ${existingAllForKey.id}
                    AND canonical_card = ${canonical}
                    AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) = ${normalizedFinalName}
                `;
              }
            }
          }
          if (oldKey !== allKey) {
            allByCanonicalBatch.delete(oldKey);
          }
          const refreshed = {
            ...existingAllForKey,
            card_number: finalCardNumber,
            card_number_upper: canonical,
            canonical_card: canonical,
            beneficiary_name: finalName,
            birth_date: finalBirthDate,
            city: item.city,
            batch_number: batchNumber,
            source_file: item.source_file ?? null,
            source_sheet: item.source_sheet ?? null,
            source_row: item.source_row ?? null,
          };
          allByCanonicalBatch.set(allKey, refreshed);
          allLatestByCanonical.set(canonical, refreshed);
          const refreshedNameNorm = normalizeNameLoose(finalName);
          const refreshedBirthKey = birthKey(finalBirthDate);
          if (refreshedNameNorm && refreshedBirthKey) {
            allByPersonKey.set(`${refreshedNameNorm}::${refreshedBirthKey}`, refreshed);
          } else if (refreshedNameNorm) {
            allByNameFamilyBase.set(`${refreshedNameNorm}::${familyBaseFromCard(canonical)}`, refreshed);
          }
        } else {
          const created = await prisma.cardIssuanceRegistryAll.create({
            data: {
              id: `${canonical}-${batchNumber}`,
              card_number: finalCardNumber,
              card_number_upper: canonical,
              canonical_card: canonical,
              beneficiary_name: finalName,
              birth_date: finalBirthDate,
              city: item.city,
              batch_number: batchNumber,
              source_file: item.source_file,
              source_sheet: item.source_sheet,
              source_row: item.source_row,
            },
          });
          const createdAll = {
            id: created.id,
            card_number: created.card_number,
            card_number_upper: created.card_number_upper,
            canonical_card: created.canonical_card,
            beneficiary_name: created.beneficiary_name,
            birth_date: created.birth_date,
            city: created.city,
            batch_number: created.batch_number,
            source_file: created.source_file,
            source_sheet: created.source_sheet,
            source_row: created.source_row,
          };
          allByCanonicalBatch.set(allKey, createdAll);
          allLatestByCanonical.set(canonical, createdAll);
          const createdNameNorm = normalizeNameLoose(createdAll.beneficiary_name);
          const createdBirthKey = birthKey(createdAll.birth_date);
          if (createdNameNorm && createdBirthKey) {
            allByPersonKey.set(`${createdNameNorm}::${createdBirthKey}`, createdAll);
          } else if (createdNameNorm) {
            allByNameFamilyBase.set(
              `${createdNameNorm}::${familyBaseFromCard(canonical)}`,
              createdAll,
            );
          }
        }

        // 2. تحديث أو إنشاء في السجل الموحد (CardIssuanceRegistry) بالاعتماد على canonical
        if (existingRecord) {
          const oldCanonical = existingRecord.canonical_card;
          await prisma.cardIssuanceRegistry.update({
            where: { id: existingRecord.id },
            data: {
              card_number: finalCardNumber,
              card_number_upper: canonical,
              canonical_card: canonical,
              beneficiary_name: finalName,
              birth_date: finalBirthDate,
              city: item.city,
              batch_number: batchNumber,
              updated_at: new Date(),
            },
          });

          if (oldCanonical && oldCanonical !== canonical) {
            truthByCanonical.delete(oldCanonical);
          }
          const updatedUnified = {
            ...existingRecord,
            card_number_upper: canonical,
            canonical_card: canonical,
            beneficiary_name: finalName,
            birth_date: finalBirthDate,
            city: item.city,
            batch_number: batchNumber,
          };
          truthByCanonical.set(canonical, updatedUnified);
          const updatedPersonKey = `${normalizeNameLoose(finalName)}::${birthKey(finalBirthDate)}`;
          if (normalizeNameLoose(finalName) && birthKey(finalBirthDate)) {
            truthByPersonKey.set(updatedPersonKey, updatedUnified);
          }
          updated++;
        } else {
          const createdUnified = await prisma.cardIssuanceRegistry.create({
            data: {
              card_number: finalCardNumber,
              card_number_upper: canonical,
              canonical_card: canonical,
              beneficiary_name: finalName,
              birth_date: finalBirthDate,
              city: item.city,
              batch_number: batchNumber,
            },
          });
          truthByCanonical.set(canonical, {
            id: createdUnified.id,
            card_number_upper: createdUnified.card_number_upper,
            canonical_card: createdUnified.canonical_card,
            beneficiary_name: createdUnified.beneficiary_name,
            birth_date: createdUnified.birth_date,
            city: createdUnified.city,
            batch_number: createdUnified.batch_number,
          });
          added++;
        }

        // ترحيل تاريخ الميلاد إلى المنظومة (المستفيدين النشطين) فور الاستيراد مع التحديث دائماً
        if (finalBirthDate) {
          try {
            await prisma.$executeRaw`
              UPDATE "Beneficiary"
              SET 
                birth_date = ${finalBirthDate},
                birth_date_synced_from_truth = true
              WHERE deleted_at IS NULL
                AND REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ${canonical}
            `;
          } catch (dbErr) {
            console.warn(`[Birth Date Sync Warning] Failed to update birth date for card ${canonical} (${finalName}) due to duplicate name/birth_date constraint:`, dbErr);
          }
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

export async function deleteTruthRegistryRowsAction(
  ids: string[],
  _options?: { allowSystemDelete?: boolean },
) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  if (!ids || ids.length === 0) return { error: "لم يتم تحديد سجلات للحذف" };

  try {
    // الحذف من شاشة جدول الحقيقة يجب أن يستهدف جدول الحقيقة فقط.
    const registryRows = await prisma.cardIssuanceRegistryAll.findMany({
      where: { id: { in: ids } },
      select: { id: true, card_number_upper: true },
    });

    if (registryRows.length === 0) {
      return { error: "السجلات المحددة ليست من جدول الحقيقة أو لم تعد موجودة." };
    }

    const finalRegistryIds = registryRows.map((r) => r.id);
    const affectedCardNumbers = new Set<string>();

    for (const row of registryRows) {
      affectedCardNumbers.add(row.card_number_upper);
    }

    await prisma.cardIssuanceRegistryAll.deleteMany({
      where: { id: { in: finalRegistryIds } }
    });

    for (const cardUpper of Array.from(affectedCardNumbers)) {
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
    return { success: true, deletedCount: finalRegistryIds.length };
  } catch (error) {
    console.error("Delete registry rows error:", error);
    return { error: "حدث خطأ أثناء حذف السجلات" };
  }
}

export async function deleteFilteredTruthRegistryAction(filters: {
  query?: string;
  city?: string;
  batch?: string;
  system_primary?: boolean;
  multi?: boolean;
  not_in_system?: boolean;
  in_system_not_in_registry?: boolean;
  similar_only?: boolean;
  similar_numeric?: boolean;
  similar_name_birth?: boolean;
  similar_family_suffix?: boolean;
  family_numbering_mismatch?: boolean;
  multi_person_cards?: boolean;
  legacy_no_batch?: boolean;
  legacy_has_batch?: boolean;
  demographic_mismatch?: boolean;
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
    const systemPrimary = filters.system_primary === true && !onlyMissingInSystem;
    const onlySimilarNumeric = filters.similar_numeric === true;
    const onlySimilarNameBirth = filters.similar_name_birth === true;
    const onlySimilarFamilySuffix = filters.similar_family_suffix === true;
    const onlyFamilyNumberingMismatch = filters.family_numbering_mismatch === true;
    const onlyDemographicMismatch = filters.demographic_mismatch === true;
    const requestedSimilarAny =
      filters.similar_only === true ||
      onlySimilarNumeric ||
      onlySimilarNameBirth ||
      onlySimilarFamilySuffix;
    const onlyInSystemNotInRegistry = filters.in_system_not_in_registry === true || requestedSimilarAny;
    const onlySimilarCases = requestedSimilarAny;
    const onlyMultiPersonCards = filters.multi_person_cards === true;
    const _onlyLegacyNoBatch = filters.legacy_no_batch === true;
    const _onlyLegacyHasBatch = filters.legacy_has_batch === true;
    const hasSystemSourcedFilteredDelete =
      systemPrimary ||
      onlyInSystemNotInRegistry ||
      onlyFamilyNumberingMismatch ||
      onlySimilarCases ||
      onlyDemographicMismatch ||
      _onlyLegacyNoBatch ||
      _onlyLegacyHasBatch;

    // أماناً: إذا كانت النتائج مبنية على المنظومة، لا نقوم بأي حذف هنا.
    // شاشة جدول الحقيقة يجب أن تحذف من جدول الحقيقة فقط.
    if (hasSystemSourcedFilteredDelete) {
      return { error: "لا يمكن حذف نتائج المنظومة من شاشة جدول الحقيقة. غيّر التصفية إلى نتائج جدول الحقيقة ثم أعد المحاولة." };
    }

    // 1. جلب السجلات المطابقة للتصفية لمعرفة معرفاتها وأرقام بطاقاتها (CardIssuanceRegistryAll)
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
            OR canonical_card NOT IN (
              SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
              FROM "Beneficiary"
              WHERE deleted_at IS NULL
            )
            AND (
              birth_date IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM "Beneficiary" b2
                WHERE b2.deleted_at IS NULL
                  AND b2.birth_date IS NOT NULL
                  AND b2.birth_date::date = birth_date::date
                  AND UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\s+', ' ', 'g')) =
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g'))
              )
            )
          )
          AND (
            ${onlyMultiPersonCards} = false
            OR (
              birth_date IS NOT NULL
              AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || birth_date::date::text IN (
                SELECT
                  UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || t2.birth_date::date::text
                FROM "CardIssuanceRegistryAll" t2
                WHERE t2.birth_date IS NOT NULL
                GROUP BY
                  UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')),
                  t2.birth_date::date
                HAVING COUNT(DISTINCT t2.canonical_card) > 1
              )
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

export async function bulkUpdateTruthRegistryBatchAction(data: {
  ids: string[];
  batchNumber: string;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const ids = Array.isArray(data.ids) ? data.ids.filter(Boolean) : [];
  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي سجل" };
  }

  const batchNumber = String(data.batchNumber ?? "").trim();
  if (!batchNumber) {
    return { error: "يرجى إدخال رقم دفعة صالح" };
  }

  try {
    // 1. جلب السجلات لمعرفة أرقام البطاقات المقابلة من جدول الحقيقة
    const records = await prisma.cardIssuanceRegistryAll.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        card_number: true,
        card_number_upper: true,
      }
    });

    // 2. إذا لم يتم العثور على كافة المعرفات، فقد تكون قادمة من جدول المستفيدين (Beneficiary)
    const foundIds = new Set(records.map(r => r.id));
    const missingIds = ids.filter(id => !foundIds.has(id));

    if (missingIds.length > 0) {
      const beneficiaries = await prisma.beneficiary.findMany({
        where: { id: { in: missingIds }, deleted_at: null },
        select: {
          id: true,
          card_number: true,
          name: true,
          birth_date: true,
          city: true
        }
      });

      for (const b of beneficiaries) {
        const cardUpper = b.card_number.trim().toUpperCase();
        records.push({
          id: b.id, // نستخدم معرف المستفيد
          card_number: b.card_number,
          card_number_upper: cardUpper
        });
      }
    }

    if (records.length === 0) {
      return { error: "لم يتم العثور على السجلات المحددة" };
    }

    const result = await prisma.$transaction(async (tx) => {
      let updatedCount = 0;

      for (const record of records) {
        const cardUpper = record.card_number_upper;
        const newId = `${cardUpper}-${batchNumber}`;
        const isFromBeneficiary = !record.id.includes("-");

        if (isFromBeneficiary) {
          // جلب بيانات المستفيد
          const b = await tx.beneficiary.findUnique({
            where: { id: record.id },
            select: { name: true, birth_date: true, city: true }
          });

          // أ. إنشاء أو تحديث السجل في CardIssuanceRegistryAll
          await tx.cardIssuanceRegistryAll.upsert({
            where: { id: newId },
            update: {
              card_number: record.card_number,
              card_number_upper: cardUpper,
              beneficiary_name: b?.name,
              birth_date: b?.birth_date,
              city: b?.city || "المنظومة",
              batch_number: batchNumber,
              updated_at: new Date()
            },
            create: {
              id: newId,
              card_number: record.card_number,
              card_number_upper: cardUpper,
              canonical_card: cardUpper,
              beneficiary_name: b?.name,
              birth_date: b?.birth_date,
              city: b?.city || "المنظومة",
              batch_number: batchNumber
            }
          });
        } else {
          // أ. التحقق مما إذا كان المعرف الجديد موجوداً مسبقاً لمنع تكرار المفتاح الأساسي
          const exists = await tx.cardIssuanceRegistryAll.findUnique({
            where: { id: newId }
          });

          if (exists) {
            // إذا كان موجوداً مسبقاً، نقوم بحذف السجل القديم لتفادي التكرار
            await tx.cardIssuanceRegistryAll.delete({
              where: { id: record.id }
            });
          } else {
            // ب. تحديث السجل التفصيلي
            await tx.cardIssuanceRegistryAll.update({
              where: { id: record.id },
              data: {
                id: newId,
                batch_number: batchNumber,
                updated_at: new Date()
              }
            });
          }
        }

        // ج. تحديث السجل الموحد
        await tx.cardIssuanceRegistry.upsert({
          where: { card_number_upper: cardUpper },
          update: {
            batch_number: batchNumber,
            updated_at: new Date()
          },
          create: {
            card_number: record.card_number,
            card_number_upper: cardUpper,
            canonical_card: cardUpper,
            batch_number: batchNumber,
            city: "المنظومة"
          }
        });

        // د. تحديث جدول المستفيدين بالمنظومة إن وجد
        await tx.beneficiary.updateMany({
          where: {
            card_number: { equals: record.card_number, mode: 'insensitive' },
            deleted_at: null
          },
          data: {
            batch_number: batchNumber
          }
        });

        updatedCount++;
      }

      return { count: updatedCount };
    });

    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");
    return { success: true, updatedCount: result.count };
  } catch (error) {
    console.error("Bulk update truth registry batch error:", error);
    return { error: "حدث خطأ أثناء تحديث دفعة السجلات في جدول الحقيقة" };
  }
}

export async function applySuggestedTruthMatchAction(data: {
  beneficiaryId: string;
  targetCard: string;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const beneficiaryId = String(data.beneficiaryId ?? "").trim();
  const targetCardRaw = String(data.targetCard ?? "").trim().toUpperCase();

  if (!beneficiaryId || !targetCardRaw) {
    return { error: "بيانات المطابقة غير مكتملة" };
  }

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: {
        id: true,
        name: true,
        birth_date: true,
        card_number: true,
        batch_number: true,
        deleted_at: true,
      },
    });

    if (!beneficiary || beneficiary.deleted_at) {
      return { error: "المستفيد غير موجود أو محذوف" };
    }

    const targetCanonical = canonicalizeCardNumber(targetCardRaw);
    if (!targetCanonical) {
      return { error: "رقم البطاقة المقترح غير صالح" };
    }

    const truthRecord = await prisma.cardIssuanceRegistry.findFirst({
      where: {
        OR: [
          { canonical_card: targetCanonical },
          { card_number_upper: targetCanonical },
        ],
      },
      select: {
        card_number: true,
        batch_number: true,
      },
      orderBy: { updated_at: "desc" },
    });

    if (!truthRecord) {
      return { error: "البطاقة المقترحة غير موجودة بجدول الحقيقة" };
    }

    const targetCardOfficial = String(truthRecord.card_number ?? "").trim().toUpperCase();
    if (!targetCardOfficial) {
      return { error: "لا يمكن اعتماد بطاقة فارغة من جدول الحقيقة" };
    }

    const duplicateBeneficiary = await prisma.beneficiary.findFirst({
      where: {
        id: { not: beneficiary.id },
        deleted_at: null,
        card_number: { equals: targetCardOfficial, mode: "insensitive" },
      },
      select: { id: true, name: true, card_number: true },
    });

    if (duplicateBeneficiary) {
      const merged = await mergeBeneficiaryIntoTargetCard({
        sourceBeneficiaryId: beneficiary.id,
        keepBeneficiaryId: duplicateBeneficiary.id,
        targetCardOfficial,
        targetBatch: truthRecord.batch_number ?? beneficiary.batch_number ?? null,
      });

      if ("error" in merged && merged.error) {
        return {
          error: `تعذر الدمج التلقائي مع المستفيد الموجود على البطاقة ${targetCardOfficial}: ${merged.error}`,
        };
      }

      await syncTruthNumberingForSamePerson({
        sourceCard: beneficiary.card_number,
        targetCard: targetCardOfficial,
        personName: beneficiary.name,
        birthDate: beneficiary.birth_date,
      });

      revalidatePath("/admin/truth-registry");
      revalidatePath("/beneficiaries");

      return {
        success: true,
        merged: true,
        previousCard: beneficiary.card_number,
        newCard: targetCardOfficial,
        mergedCount: Number((merged as { mergedCount?: number }).mergedCount ?? 1),
        keepId: (merged as { keepId?: string }).keepId ?? duplicateBeneficiary.id,
      };
    }

    await prisma.beneficiary.update({
      where: { id: beneficiary.id },
      data: {
        card_number: targetCardOfficial,
        batch_number: truthRecord.batch_number ?? beneficiary.batch_number ?? null,
      },
    });

    await syncTruthNumberingForSamePerson({
      sourceCard: beneficiary.card_number,
      targetCard: targetCardOfficial,
      personName: beneficiary.name,
      birthDate: beneficiary.birth_date,
    });

    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");

    return {
      success: true,
      previousCard: beneficiary.card_number,
      newCard: targetCardOfficial,
    };
  } catch (error) {
    console.error("Apply suggested truth match error:", error);
    return { error: "حدث خطأ أثناء تطبيق المطابقة المقترحة" };
  }
}

type FamilyNumberingContextSystemMember = {
  id: string;
  name: string;
  card_number: string;
  canonical_card: string;
  birth_date: Date | null;
  batch_number: string | null;
  city: string | null;
  created_at: Date;
};

type FamilyNumberingContextTruthRow = {
  id: string;
  card_number: string;
  canonical_card: string;
  beneficiary_name: string | null;
  birth_date: Date | null;
  batch_number: string | null;
  city: string;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  updated_at: Date;
};

function buildFamilyNumberingBaseFromCanonical(canonical: string): string {
  const normalized = String(canonical ?? "").trim().toUpperCase();
  const suffixMatch = normalized.match(/^(WAB2025\d+)(?:[WMFH]\d*|[DSB]\d+)$/i);
  return suffixMatch ? suffixMatch[1] : normalized;
}

function isCardNumberInputValid(card: string): boolean {
  const value = String(card ?? "").trim().toUpperCase();
  return /^WAB2025[0-9]+[A-Z0-9]*$/.test(value);
}

type FamilyNumberingOption = {
  canonical_card: string;
  card_number: string;
  from_system: boolean;
  from_truth: boolean;
  system_count: number;
  truth_count: number;
  is_current: boolean;
};

type FamilyRelationCode = "MAIN" | "W" | "H" | "M" | "F" | "S" | "D" | "B";
type FamilyRelationSuffixCode = Exclude<FamilyRelationCode, "MAIN">;

type FamilyStandardPlanItem = {
  person_key: string;
  name: string;
  birth_date: string;
  relation_code: FamilyRelationCode;
  target_card: string;
  current_cards: string[];
  sources: Array<"system" | "truth">;
  system_cards?: string[];
  truth_cards?: string[];
};

function parseFamilySuffixFromCanonical(canonicalCard: string): {
  base: string;
  relation: FamilyRelationCode;
  index: number | null;
} {
  const canonical = canonicalizeCardNumber(String(canonicalCard ?? "").trim().toUpperCase());
  const base = buildFamilyNumberingBaseFromCanonical(canonical);
  if (!base || canonical === base) {
    return { base, relation: "MAIN", index: null };
  }
  const suffix = canonical.slice(base.length);
  const match = suffix.match(/^([A-Z])([0-9]*)$/);
  if (!match) return { base, relation: "MAIN", index: null };
  const relationRaw = match[1].toUpperCase();
  const suffixCodes = ["W", "H", "M", "F", "S", "D", "B"] as const;
  const relation: FamilyRelationCode = suffixCodes.includes(
    relationRaw as FamilyRelationSuffixCode,
  )
    ? (relationRaw as FamilyRelationSuffixCode)
    : "MAIN";
  const index = match[2] ? Number.parseInt(match[2], 10) : null;
  return { base, relation, index: Number.isFinite(index ?? NaN) ? index : null };
}

function buildPersonKeyForFamily(name: string | null | undefined, birthDate: Date | string | null | undefined): string {
  return normalizeNameLoose(name);
}

type FamilyPlanInputSystemRow = {
  id: string;
  name: string | null;
  card_number: string;
  canonical_card: string;
  birth_date: Date | null;
};

type FamilyPlanInputTruthRow = {
  id: string;
  beneficiary_name: string | null;
  card_number: string;
  canonical_card: string;
  birth_date: Date | null;
};

type FamilyPlanBuildResult = {
  plan: FamilyStandardPlanItem[];
  targetByPersonKey: Map<string, string>;
};

function buildFamilyStandardizationPlan(args: {
  familyBase: string;
  systemRows: FamilyPlanInputSystemRow[];
  truthRows: FamilyPlanInputTruthRow[];
  anchorPersonKey?: string;
  anchorPreferredCard?: string;
}): FamilyPlanBuildResult {
  const familyBase = String(args.familyBase ?? "").trim().toUpperCase();

  const personMap = new Map<
    string,
    {
      personKey: string;
      name: string;
      birthDate: string;
      relationVotes: Map<FamilyRelationCode, number>;
      currentCards: Set<string>;
      systemCards: Set<string>;
      truthCards: Set<string>;
      sources: Set<"system" | "truth">;
    }
  >();

  const pushPerson = (params: {
    personKey: string;
    name: string;
    birthDate: string;
    relation: FamilyRelationCode;
    card: string;
    source: "system" | "truth";
  }) => {
    const existing = personMap.get(params.personKey) ?? {
      personKey: params.personKey,
      name: params.name,
      birthDate: params.birthDate,
      relationVotes: new Map<FamilyRelationCode, number>(),
      currentCards: new Set<string>(),
      systemCards: new Set<string>(),
      truthCards: new Set<string>(),
      sources: new Set<"system" | "truth">(),
    };
    existing.relationVotes.set(params.relation, Number(existing.relationVotes.get(params.relation) ?? 0) + 1);
    if (params.card) {
      existing.currentCards.add(params.card);
      if (params.source === "system") {
        existing.systemCards.add(params.card);
      } else {
        existing.truthCards.add(params.card);
      }
    }
    
    const isNewTruth = params.source === "truth";
    const isExistingTruth = existing.sources.has("truth");
    if (params.birthDate && (isNewTruth || !existing.birthDate || !isExistingTruth)) {
      existing.birthDate = params.birthDate;
      existing.name = params.name;
    }

    existing.sources.add(params.source);
    personMap.set(params.personKey, existing);
  };

  for (const row of args.systemRows) {
    const personKey = buildPersonKeyForFamily(row.name, row.birth_date);
    if (!personKey) continue;
    const canonical = canonicalizeCardNumber(String(row.canonical_card ?? row.card_number).trim().toUpperCase());
    const parsed = parseFamilySuffixFromCanonical(canonical);
    pushPerson({
      personKey,
      name: String(row.name ?? "").trim(),
      birthDate: birthKey(row.birth_date),
      relation: parsed.relation,
      card: String(row.card_number ?? "").trim().toUpperCase(),
      source: "system",
    });
  }

  for (const row of args.truthRows) {
    const personKey = buildPersonKeyForFamily(row.beneficiary_name, row.birth_date);
    if (!personKey) continue;
    const canonical = canonicalizeCardNumber(String(row.canonical_card ?? row.card_number).trim().toUpperCase());
    const parsed = parseFamilySuffixFromCanonical(canonical);
    pushPerson({
      personKey,
      name: String(row.beneficiary_name ?? "").trim(),
      birthDate: birthKey(row.birth_date),
      relation: parsed.relation,
      card: String(row.card_number ?? "").trim().toUpperCase(),
      source: "truth",
    });
  }

  if (personMap.size === 0) {
    return { plan: [], targetByPersonKey: new Map<string, string>() };
  }

  const pickTopRelation = (votes: Map<FamilyRelationCode, number>): FamilyRelationCode => {
    const preferredOrder: FamilyRelationCode[] = ["MAIN", "F", "M", "H", "W", "S", "D", "B"];
    const sorted = Array.from(votes.entries()).sort((a, b) => {
      const diff = b[1] - a[1];
      if (diff !== 0) return diff;
      return preferredOrder.indexOf(a[0]) - preferredOrder.indexOf(b[0]);
    });
    return sorted[0]?.[0] ?? "MAIN";
  };

  const targetByPersonKey = new Map<string, string>();
  const byRelation = new Map<FamilyRelationCode, Array<{ personKey: string; birthDate: string; name: string }>>();

  for (const person of personMap.values()) {
    let relation = pickTopRelation(person.relationVotes);
    if (args.anchorPersonKey && args.anchorPersonKey === person.personKey && args.anchorPreferredCard) {
      const preferredCanonical = canonicalizeCardNumber(args.anchorPreferredCard);
      const preferredParsed = parseFamilySuffixFromCanonical(preferredCanonical);
      relation = preferredParsed.base === familyBase ? preferredParsed.relation : relation;
    }
    const bucket = byRelation.get(relation) ?? [];
    bucket.push({
      personKey: person.personKey,
      birthDate: person.birthDate,
      name: person.name,
    });
    byRelation.set(relation, bucket);
  }

  const sortMembersByBirth = (arr: Array<{ personKey: string; birthDate: string; name: string }>) =>
    [...arr].sort((a, b) => {
      const aTime = a.birthDate ? Date.parse(a.birthDate) : Number.POSITIVE_INFINITY;
      const bTime = b.birthDate ? Date.parse(b.birthDate) : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.name.localeCompare(b.name, "ar");
    });

  const relationHasIndex = new Map<FamilyRelationCode, boolean>();
  relationHasIndex.set("S", true);
  relationHasIndex.set("D", true);
  relationHasIndex.set("B", true);

  const allInputCards = [
    ...args.systemRows.map((r) => r.card_number),
    ...args.truthRows.map((r) => r.card_number),
  ];
  if (args.anchorPreferredCard) {
    allInputCards.push(args.anchorPreferredCard);
  }

  for (const card of allInputCards) {
    const parsed = parseFamilySuffixFromCanonical(card);
    if (parsed.relation !== "MAIN" && parsed.index !== null) {
      relationHasIndex.set(parsed.relation, true);
    }
  }

  let displayBase = familyBase;
  if (args.anchorPreferredCard) {
    const rawBase = buildFamilyNumberingBaseFromCanonical(args.anchorPreferredCard);
    if (canonicalizeCardNumber(rawBase) === familyBase) {
      displayBase = rawBase;
    }
  }

  const mainMembers = sortMembersByBirth(byRelation.get("MAIN") ?? []);
  if (mainMembers.length > 0) {
    const anchorInMain = args.anchorPersonKey
      ? mainMembers.find((m) => m.personKey === args.anchorPersonKey)
      : null;
    const anchorPrefCard = anchorInMain && args.anchorPreferredCard
      ? String(args.anchorPreferredCard).trim().toUpperCase()
      : null;

    if (anchorInMain && anchorPrefCard) {
      targetByPersonKey.set(anchorInMain.personKey, anchorPrefCard);
      mainMembers.forEach((member) => {
        if (member.personKey === anchorInMain.personKey) return;
        const current = personMap.get(member.personKey);
        const fallback = Array.from(current?.currentCards ?? [])[0] ?? displayBase;
        targetByPersonKey.set(member.personKey, fallback);
      });
    } else {
      targetByPersonKey.set(mainMembers[0].personKey, displayBase);
      for (const extraMain of mainMembers.slice(1)) {
        const current = personMap.get(extraMain.personKey);
        const fallback = Array.from(current?.currentCards ?? [])[0] ?? displayBase;
        targetByPersonKey.set(extraMain.personKey, fallback);
      }
    }
  }

  const buildForIndexedRelation = (
    relation: FamilyRelationCode,
    alwaysIndexed: boolean,
  ) => {
    const members = sortMembersByBirth(byRelation.get(relation) ?? []);
    if (members.length === 0) return;

    const anchorInGroup = args.anchorPersonKey
      ? members.find((m) => m.personKey === args.anchorPersonKey)
      : null;
    const anchorPrefCard = anchorInGroup && args.anchorPreferredCard
      ? String(args.anchorPreferredCard).trim().toUpperCase()
      : null;

    if (!alwaysIndexed && members.length === 1 && !anchorPrefCard) {
      targetByPersonKey.set(members[0].personKey, `${displayBase}${relation}`);
      return;
    }

    if (members.length === 1 && anchorPrefCard) {
      targetByPersonKey.set(members[0].personKey, anchorPrefCard);
      return;
    }

    let anchorIndex: number | null = null;
    if (anchorPrefCard) {
      const parsed = parseFamilySuffixFromCanonical(anchorPrefCard);
      anchorIndex = parsed.index;
    }

    const usedCards = new Set<string>();
    if (anchorPrefCard && anchorInGroup) {
      targetByPersonKey.set(anchorInGroup.personKey, anchorPrefCard);
      usedCards.add(anchorPrefCard);
    }

    let nextIdx = 1;
    members.forEach((member) => {
      if (anchorInGroup && member.personKey === anchorInGroup.personKey) {
        return;
      }

      let targetCard = "";
      while (true) {
        const suffix = alwaysIndexed || nextIdx > 1 || anchorIndex !== null
          ? `${relation}${nextIdx}`
          : relation;
        targetCard = `${displayBase}${suffix}`;
        if (!usedCards.has(targetCard)) {
          break;
        }
        nextIdx++;
      }
      targetByPersonKey.set(member.personKey, targetCard);
      usedCards.add(targetCard);
      nextIdx++;
    });
  };

  buildForIndexedRelation("F", relationHasIndex.get("F") ?? false);
  buildForIndexedRelation("M", relationHasIndex.get("M") ?? false);
  buildForIndexedRelation("W", relationHasIndex.get("W") ?? false);
  buildForIndexedRelation("H", relationHasIndex.get("H") ?? false);
  buildForIndexedRelation("S", relationHasIndex.get("S") ?? true);
  buildForIndexedRelation("D", relationHasIndex.get("D") ?? true);
  buildForIndexedRelation("B", relationHasIndex.get("B") ?? true);

  const plan: FamilyStandardPlanItem[] = Array.from(personMap.values())
    .map((person) => ({
      person_key: person.personKey,
      name: person.name,
      birth_date: person.birthDate,
      relation_code: parseFamilySuffixFromCanonical(
        targetByPersonKey.get(person.personKey) ?? displayBase,
      ).relation,
      target_card: targetByPersonKey.get(person.personKey) ?? Array.from(person.currentCards)[0] ?? displayBase,
      current_cards: Array.from(person.currentCards).sort(),
      sources: Array.from(person.sources),
      system_cards: Array.from(person.systemCards).sort(),
      truth_cards: Array.from(person.truthCards).sort(),
    }))
    .sort((a, b) => {
      const getRelationRank = (relationCode: string): number => {
        if (relationCode === "MAIN" || !relationCode) return 1;
        if (relationCode === "W" || relationCode === "H") return 2;
        if (relationCode === "F") return 3;
        if (relationCode === "M") return 4;
        if (relationCode === "S") return 5;
        if (relationCode === "D") return 6;
        if (relationCode === "B") return 7;
        return 8;
      };
      const rankA = getRelationRank(a.relation_code);
      const rankB = getRelationRank(b.relation_code);
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      const aTime = a.birth_date ? Date.parse(a.birth_date) : Number.POSITIVE_INFINITY;
      const bTime = b.birth_date ? Date.parse(b.birth_date) : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.name.localeCompare(b.name, "ar");
    });

  console.log("DEBUG buildFamilyStandardizationPlan outputs:", {
    familyBase,
    anchorPreferredCard: args.anchorPreferredCard,
    displayBase,
    planLength: plan.length,
    planTargets: plan.map(p => ({ name: p.name, target: p.target_card, current: p.current_cards }))
  });

  return { plan, targetByPersonKey };
}

function buildFamilyNumberingOptions(args: {
  currentCanonical: string;
  systemRows: FamilyNumberingContextSystemMember[];
  truthRows: FamilyNumberingContextTruthRow[];
}): FamilyNumberingOption[] {
  const byCanonical = new Map<
    string,
    {
      canonical: string;
      cardSamples: string[];
      fromSystem: boolean;
      fromTruth: boolean;
      systemCount: number;
      truthCount: number;
    }
  >();

  for (const row of args.systemRows) {
    const canonical = canonicalizeCardNumber(String(row.canonical_card ?? row.card_number).trim().toUpperCase());
    if (!canonical) continue;
    const existing = byCanonical.get(canonical) ?? {
      canonical,
      cardSamples: [],
      fromSystem: false,
      fromTruth: false,
      systemCount: 0,
      truthCount: 0,
    };
    existing.fromSystem = true;
    existing.systemCount += 1;
    const card = String(row.card_number ?? "").trim().toUpperCase();
    if (card && !existing.cardSamples.includes(card)) existing.cardSamples.push(card);
    byCanonical.set(canonical, existing);
  }

  for (const row of args.truthRows) {
    const canonical = canonicalizeCardNumber(String(row.canonical_card ?? row.card_number).trim().toUpperCase());
    if (!canonical) continue;
    const existing = byCanonical.get(canonical) ?? {
      canonical,
      cardSamples: [],
      fromSystem: false,
      fromTruth: false,
      systemCount: 0,
      truthCount: 0,
    };
    existing.fromTruth = true;
    existing.truthCount += 1;
    const card = String(row.card_number ?? "").trim().toUpperCase();
    if (card && !existing.cardSamples.includes(card)) existing.cardSamples.unshift(card);
    byCanonical.set(canonical, existing);
  }

  return Array.from(byCanonical.values())
    .map((entry) => ({
      canonical_card: entry.canonical,
      card_number: entry.cardSamples[0] ?? entry.canonical,
      from_system: entry.fromSystem,
      from_truth: entry.fromTruth,
      system_count: entry.systemCount,
      truth_count: entry.truthCount,
      is_current: entry.canonical === args.currentCanonical,
    }))
    .sort((a, b) => {
      if (a.is_current && !b.is_current) return -1;
      if (!a.is_current && b.is_current) return 1;
      const truthDiff = b.truth_count - a.truth_count;
      if (truthDiff !== 0) return truthDiff;
      const systemDiff = b.system_count - a.system_count;
      if (systemDiff !== 0) return systemDiff;
      return a.card_number.localeCompare(b.card_number);
    });
}

export async function getFamilyNumberingMismatchContextAction(data: {
  beneficiaryId: string;
  preferredCard?: string;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const beneficiaryId = String(data.beneficiaryId ?? "").trim();
  if (!beneficiaryId) return { error: "معرف المستفيد غير صالح" };

  try {
    const anchor = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: {
        id: true,
        name: true,
        card_number: true,
        birth_date: true,
        batch_number: true,
        city: true,
        deleted_at: true,
      },
    });

    if (!anchor || anchor.deleted_at) {
      return { error: "المستفيد غير موجود أو محذوف" };
    }

    const currentCard = String(anchor.card_number ?? "").trim().toUpperCase();
    const currentCanonical = canonicalizeCardNumber(currentCard);
    const familyBase = buildFamilyNumberingBaseFromCanonical(currentCanonical);
    const normalizedName = normalizeNameLoose(anchor.name);
    const birthDateIso = birthKey(anchor.birth_date);
    const anchorPersonKey = buildPersonKeyForFamily(anchor.name, anchor.birth_date);

    const systemFamilyRows = await prisma.$queryRaw<FamilyNumberingContextSystemMember[]>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card,
        b.birth_date,
        b.batch_number,
        b.city,
        b.created_at
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND COALESCE(
          SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
          REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
        ) = ${familyBase}
      ORDER BY canonical_card ASC, b.created_at DESC
      LIMIT 200
    `;

    const truthFamilyRows = await prisma.$queryRaw<FamilyNumberingContextTruthRow[]>`
      SELECT
        t.id,
        t.card_number,
        t.canonical_card,
        t.beneficiary_name,
        t.birth_date,
        t.batch_number,
        t.city,
        t.source_file,
        t.source_sheet,
        t.source_row,
        t.updated_at
      FROM "CardIssuanceRegistryAll" t
      WHERE COALESCE(
          SUBSTRING(t.canonical_card FROM '^(WAB2025[0-9]+)'),
          t.canonical_card
        ) = ${familyBase}
      ORDER BY canonical_card ASC, t.updated_at DESC
      LIMIT 300
    `;

    const systemSamePersonRows =
      birthDateIso && normalizedName
        ? systemFamilyRows.filter((row) => {
            return (
              normalizeNameLoose(row.name) === normalizedName &&
              birthKey(row.birth_date) === birthDateIso
            );
          })
        : systemFamilyRows.filter((row) => row.id === anchor.id);

    const truthSamePersonRows =
      birthDateIso && normalizedName
        ? truthFamilyRows.filter((row) => {
            return (
              normalizeNameLoose(row.beneficiary_name) === normalizedName &&
              birthKey(row.birth_date) === birthDateIso
            );
          })
        : truthFamilyRows.filter((row) => {
            const canonical = canonicalizeCardNumber(String(row.canonical_card ?? row.card_number).trim().toUpperCase());
            return canonical === currentCanonical;
          });

    const options = buildFamilyNumberingOptions({
      currentCanonical,
      systemRows: systemSamePersonRows.length > 0 ? systemSamePersonRows : systemFamilyRows,
      truthRows: truthSamePersonRows.length > 0 ? truthSamePersonRows : truthFamilyRows,
    });

    let recommendedCard = data.preferredCard ? String(data.preferredCard).trim().toUpperCase() : currentCard;
    if (!data.preferredCard) {
      const bestFromTruth = options.find((option) => option.from_truth && !option.is_current);
      if (bestFromTruth?.card_number) {
        recommendedCard = bestFromTruth.card_number;
      } else if (options[0]?.card_number) {
        recommendedCard = options[0].card_number;
      }
    }

    const familyPlan = buildFamilyStandardizationPlan({
      familyBase,
      systemRows: systemFamilyRows.map((row) => ({
        id: row.id,
        name: row.name,
        card_number: row.card_number,
        canonical_card: row.canonical_card,
        birth_date: row.birth_date,
      })),
      truthRows: truthFamilyRows.map((row) => ({
        id: row.id,
        beneficiary_name: row.beneficiary_name,
        card_number: row.card_number,
        canonical_card: row.canonical_card,
        birth_date: row.birth_date,
      })),
      anchorPersonKey: anchorPersonKey || undefined,
      anchorPreferredCard: recommendedCard,
    });

    return {
      success: true,
      context: {
        anchor: {
          id: anchor.id,
          name: anchor.name,
          card_number: currentCard,
          canonical_card: currentCanonical,
          birth_date: anchor.birth_date,
          batch_number: anchor.batch_number,
          city: anchor.city,
          family_base: familyBase,
        },
        options,
        recommended_card: recommendedCard,
        system_same_person: systemSamePersonRows,
        truth_same_person: truthSamePersonRows,
        system_family: systemFamilyRows,
        truth_family: truthFamilyRows,
        family_standard_plan: familyPlan.plan,
      },
    };
  } catch (error) {
    console.error("Get family numbering mismatch context error:", error);
    return { error: "تعذر جلب تفاصيل تباين الترقيم" };
  }
}

export async function resolveFamilyNumberingMismatchAction(data: {
  beneficiaryId: string;
  targetCard: string;
  applyToWholeFamily?: boolean;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const beneficiaryId = String(data.beneficiaryId ?? "").trim();
  const targetCardRaw = String(data.targetCard ?? "").trim().toUpperCase();
  const applyToWholeFamily = data.applyToWholeFamily !== false;
  if (!beneficiaryId || !targetCardRaw) {
    return { error: "بيانات المعالجة غير مكتملة" };
  }
  if (!isCardNumberInputValid(targetCardRaw)) {
    return { error: "رقم البطاقة المدخل غير صالح" };
  }

  try {
    const anchor = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: {
        id: true,
        name: true,
        card_number: true,
        birth_date: true,
        batch_number: true,
        deleted_at: true,
      },
    });

    if (!anchor || anchor.deleted_at) {
      return { error: "المستفيد غير موجود أو محذوف" };
    }

    const sourceCanonical = canonicalizeCardNumber(String(anchor.card_number ?? "").trim().toUpperCase());
    const familyBase = buildFamilyNumberingBaseFromCanonical(sourceCanonical);
    const normalizedName = normalizeNameLoose(anchor.name);
    const birthDateIso = birthKey(anchor.birth_date);
    if (!normalizedName) {
      return { error: "لا يمكن معالجة التباين بدون اسم صحيح" };
    }
    const anchorPersonKey = buildPersonKeyForFamily(anchor.name, anchor.birth_date);

    const targetCanonical = canonicalizeCardNumber(targetCardRaw);
    if (!targetCanonical) return { error: "رقم البطاقة الهدف غير صالح" };
    const targetBase = buildFamilyNumberingBaseFromCanonical(targetCanonical);
    if (targetBase !== familyBase) {
      return { error: "رقم البطاقة المختار يجب أن يكون ضمن نفس العائلة (نفس الأساس)." };
    }

    const truthTarget = await prisma.cardIssuanceRegistry.findFirst({
      where: {
        OR: [{ canonical_card: targetCanonical }, { card_number_upper: targetCanonical }],
      },
      select: { card_number: true, batch_number: true },
      orderBy: { updated_at: "desc" },
    });

    const systemTarget = await prisma.$queryRaw<{ card_number: string; batch_number: string | null }[]>`
      SELECT
        b.card_number,
        b.batch_number
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ${targetCanonical}
      ORDER BY b.created_at DESC
      LIMIT 1
    `;

    const targetCardOfficial = targetCardRaw;
    const targetBatch =
      String(truthTarget?.batch_number ?? systemTarget[0]?.batch_number ?? anchor.batch_number ?? "").trim() || null;

    const systemFamilyRows = await prisma.$queryRaw<FamilyNumberingContextSystemMember[]>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card,
        b.birth_date,
        b.batch_number,
        b.city,
        b.created_at
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND COALESCE(
          SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
          REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
        ) = ${familyBase}
      ORDER BY b.created_at ASC
      LIMIT 300
    `;

    const truthFamilyRows = await prisma.$queryRaw<FamilyNumberingContextTruthRow[]>`
      SELECT
        t.id,
        t.card_number,
        t.canonical_card,
        t.beneficiary_name,
        t.birth_date,
        t.batch_number,
        t.city,
        t.source_file,
        t.source_sheet,
        t.source_row,
        t.updated_at
      FROM "CardIssuanceRegistryAll" t
      WHERE COALESCE(
          SUBSTRING(t.canonical_card FROM '^(WAB2025[0-9]+)'),
          t.canonical_card
        ) = ${familyBase}
      ORDER BY t.updated_at DESC
      LIMIT 500
    `;

    if (!applyToWholeFamily) {
      const samePersonCandidates = systemFamilyRows.filter((row) => {
        return (
          normalizeNameLoose(row.name) === normalizedName &&
          birthKey(row.birth_date) === birthDateIso
        );
      });

      const candidates = samePersonCandidates.length > 0
        ? samePersonCandidates
        : [
            {
              id: anchor.id,
              card_number: anchor.card_number,
              name: anchor.name,
              birth_date: anchor.birth_date,
              batch_number: anchor.batch_number,
              canonical_card: sourceCanonical,
              city: null,
              created_at: new Date(),
            } as FamilyNumberingContextSystemMember,
          ];

      const candidateIds = candidates.map((row) => row.id);
      const externalTargetHolders = await prisma.$queryRaw<
        Array<{ id: string; name: string; birth_date: Date | null; card_number: string }>
      >`
        SELECT
          b.id,
          b.name,
          b.birth_date,
          b.card_number
        FROM "Beneficiary" b
        WHERE b.deleted_at IS NULL
          AND b.id <> ALL(${candidateIds}::text[])
          AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ${targetCanonical}
        ORDER BY b.created_at ASC
        LIMIT 5
      `;

      let keepId = "";
      if (externalTargetHolders.length > 0) {
        const external = externalTargetHolders[0];
        const externalName = normalizeNameLoose(external.name);
        const externalBirth = birthKey(external.birth_date);
        if (externalName !== normalizedName || externalBirth !== birthDateIso) {
          return {
            error: `لا يمكن الاعتماد على البطاقة ${targetCardOfficial} لأنها مستخدمة حالياً لمستفيد مختلف.`,
          };
        }
        keepId = external.id;
      } else {
        const inCandidates = candidates.find(
          (row) => canonicalizeCardNumber(String(row.card_number ?? "").trim().toUpperCase()) === targetCanonical,
        );
        keepId = inCandidates?.id ?? anchor.id;
      }

      let updated = 0;
      let merged = 0;
      let skippedConflict = 0;

      await prisma.beneficiary.updateMany({
        where: { id: keepId, deleted_at: null },
        data: {
          card_number: targetCardOfficial,
          batch_number: targetBatch,
        },
      });
      updated += 1;

      const keepInCandidates = candidates.find((row) => row.id === keepId);
      for (const candidate of candidates) {
        if (candidate.id === keepId) continue;
        const mergeResult = await mergeBeneficiaryIntoTargetCard({
          sourceBeneficiaryId: candidate.id,
          keepBeneficiaryId: keepId,
          targetCardOfficial,
          targetBatch,
        });
        if ("error" in mergeResult && mergeResult.error) {
          skippedConflict += 1;
        } else {
          merged += 1;
        }
      }

      const truthSyncSources = new Set<string>();
      for (const candidate of candidates) {
        truthSyncSources.add(String(candidate.card_number ?? "").trim().toUpperCase());
      }
      if (keepInCandidates) {
        truthSyncSources.add(String(keepInCandidates.card_number ?? "").trim().toUpperCase());
      } else {
        truthSyncSources.add(String(anchor.card_number ?? "").trim().toUpperCase());
      }

      let truthUpdatedRows = 0;
      for (const sourceCard of truthSyncSources) {
        const syncRes = await syncTruthNumberingForSamePerson({
          sourceCard,
          targetCard: targetCardOfficial,
          personName: anchor.name,
          birthDate: anchor.birth_date,
        });
        truthUpdatedRows += Number(syncRes.updatedRows ?? 0);
      }

      await refreshTruthRegistrySnapshotByCanonical(targetCanonical);

      revalidatePath("/admin/truth-registry");
      revalidatePath("/beneficiaries");

      return {
        success: true,
        targetCard: targetCardOfficial,
        updated,
        merged,
        skippedConflict,
        truthUpdatedRows,
        candidatesCount: candidates.length,
      };
    }

    const familyPlan = buildFamilyStandardizationPlan({
      familyBase,
      systemRows: systemFamilyRows.map((row) => ({
        id: row.id,
        name: row.name,
        card_number: row.card_number,
        canonical_card: row.canonical_card,
        birth_date: row.birth_date,
      })),
      truthRows: truthFamilyRows.map((row) => ({
        id: row.id,
        beneficiary_name: row.beneficiary_name,
        card_number: row.card_number,
        canonical_card: row.canonical_card,
        birth_date: row.birth_date,
      })),
      anchorPersonKey,
      anchorPreferredCard: targetCardOfficial,
    });

    if (familyPlan.plan.length === 0) {
      return { error: "تعذر بناء خطة التوحيد العائلي (الاسم/الميلاد غير مكتمل)." };
    }

    const personGroups = new Map<string, FamilyNumberingContextSystemMember[]>();
    const unkeyedSystemRowsByName = new Map<string, FamilyNumberingContextSystemMember[]>();
    for (const row of systemFamilyRows) {
      const key = buildPersonKeyForFamily(row.name, row.birth_date);
      if (key) {
        const bucket = personGroups.get(key) ?? [];
        bucket.push(row);
        personGroups.set(key, bucket);
      } else {
        const normalizedNameOnly = normalizeNameLoose(row.name);
        if (!normalizedNameOnly) continue;
        const bucket = unkeyedSystemRowsByName.get(normalizedNameOnly) ?? [];
        bucket.push(row);
        unkeyedSystemRowsByName.set(normalizedNameOnly, bucket);
      }
    }

    const truthRowsByPersonKey = new Map<string, FamilyNumberingContextTruthRow[]>();
    for (const row of truthFamilyRows) {
      const key = buildPersonKeyForFamily(row.beneficiary_name, row.birth_date);
      if (!key) continue;
      const bucket = truthRowsByPersonKey.get(key) ?? [];
      bucket.push(row);
      truthRowsByPersonKey.set(key, bucket);
    }

    let updated = 0;
    let merged = 0;
    let skippedConflict = 0;
    let truthUpdatedRows = 0;
    let createdFromTruth = 0;
    let restoredFromDeleted = 0;
    let temporaryReassigned = 0;
    const touchedCanonicals = new Set<string>();
    const plannedPersonKeys = new Set(familyPlan.plan.map((item) => item.person_key));
    let tempCardCounter = 0;
    const temporaryMoves: Array<{ id: string; originalCard: string; originalBatch: string | null }> = [];
    const planNameCounts = new Map<string, number>();
    for (const item of familyPlan.plan) {
      const normalizedName = normalizeNameLoose(item.name);
      if (!normalizedName) continue;
      planNameCounts.set(normalizedName, Number(planNameCounts.get(normalizedName) ?? 0) + 1);
    }

    for (const planItem of familyPlan.plan) {
      const targetCardForPerson = String(familyPlan.targetByPersonKey.get(planItem.person_key) ?? "").trim().toUpperCase();
      if (!targetCardForPerson) continue;
      const targetCanonicalForPerson = canonicalizeCardNumber(targetCardForPerson);
      if (!targetCanonicalForPerson) continue;

      let members = [...(personGroups.get(planItem.person_key) ?? [])];
      const planName = normalizeNameLoose(planItem.name);
      if (planName && Number(planNameCounts.get(planName) ?? 0) === 1) {
        const unkeyedSameName = unkeyedSystemRowsByName.get(planName) ?? [];
        if (unkeyedSameName.length > 0) {
          const existingIds = new Set(members.map((m) => m.id));
          for (const row of unkeyedSameName) {
            if (!existingIds.has(row.id)) {
              members.push(row);
              existingIds.add(row.id);
            }
          }
          unkeyedSystemRowsByName.delete(planName);
        }
      } else if (planName) {
        // عند تكرار نفس الاسم مع أكثر من ميلاد، نستخدم نوع الصلة من الترقيم (D/S/W...) كمرجّح
        const unkeyedSameName = unkeyedSystemRowsByName.get(planName) ?? [];
        if (unkeyedSameName.length > 0) {
          const targetRelation = parseFamilySuffixFromCanonical(targetCanonicalForPerson).relation;
          const matchingRelation = unkeyedSameName.filter(
            (row) => parseFamilySuffixFromCanonical(row.canonical_card).relation === targetRelation,
          );
          if (matchingRelation.length === 1) {
            const candidate = matchingRelation[0];
            if (!members.some((m) => m.id === candidate.id)) {
              members.push(candidate);
            }
            const remaining = unkeyedSameName.filter((row) => row.id !== candidate.id);
            if (remaining.length > 0) {
              unkeyedSystemRowsByName.set(planName, remaining);
            } else {
              unkeyedSystemRowsByName.delete(planName);
            }
          }
        }
      }

      if (members.length === 0) {
        const truthCandidatesForPerson = truthRowsByPersonKey.get(planItem.person_key) ?? [];
        const truthSeed =
          truthCandidatesForPerson.find((row) => Boolean(row.beneficiary_name) && Boolean(row.birth_date)) ??
          truthCandidatesForPerson[0];

        if (!truthSeed) {
          skippedConflict += 1;
          continue;
        }

        const normalizedPersonName = normalizeNameLoose(truthSeed.beneficiary_name ?? planItem.name);
        const personBirthDate = birthKey(truthSeed.birth_date ?? planItem.birth_date);
        if (!normalizedPersonName || !personBirthDate) {
          skippedConflict += 1;
          continue;
        }

        const samePersonAny = await prisma.$queryRaw<
          Array<{
            id: string;
            name: string;
            card_number: string;
            birth_date: Date | null;
            batch_number: string | null;
            city: string | null;
            created_at: Date;
            deleted_at: Date | null;
          }>
        >`
          SELECT
            b.id,
            b.name,
            b.card_number,
            b.birth_date,
            b.batch_number,
            b.city,
            b.created_at,
            b.deleted_at
          FROM "Beneficiary" b
          WHERE b.birth_date IS NOT NULL
            AND b.birth_date::date = ${personBirthDate}::date
            AND UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) = ${normalizedPersonName}
          ORDER BY (b.deleted_at IS NULL) DESC, b.created_at ASC
          LIMIT 5
        `;

        const activeSamePerson = samePersonAny.find((row) => row.deleted_at === null);
        if (activeSamePerson) {
          members = [
            {
              id: activeSamePerson.id,
              name: activeSamePerson.name,
              card_number: activeSamePerson.card_number,
              canonical_card: canonicalizeCardNumber(String(activeSamePerson.card_number ?? "").trim().toUpperCase()),
              birth_date: activeSamePerson.birth_date,
              batch_number: activeSamePerson.batch_number,
              city: activeSamePerson.city,
              created_at: activeSamePerson.created_at,
            },
          ];
          personGroups.set(planItem.person_key, members);
        } else {
          const deletedSamePerson = samePersonAny[0];
          if (deletedSamePerson?.id) {
            await prisma.beneficiary.update({
              where: { id: deletedSamePerson.id },
              data: { deleted_at: null },
            });
            restoredFromDeleted += 1;
            members = [
              {
                id: deletedSamePerson.id,
                name: deletedSamePerson.name,
                card_number: deletedSamePerson.card_number,
                canonical_card: canonicalizeCardNumber(
                  String(deletedSamePerson.card_number ?? "").trim().toUpperCase(),
                ),
                birth_date: deletedSamePerson.birth_date,
                batch_number: deletedSamePerson.batch_number,
                city: deletedSamePerson.city,
                created_at: deletedSamePerson.created_at,
              },
            ];
            personGroups.set(planItem.person_key, members);
          } else {
            const existingTargetHolder = await prisma.$queryRaw<
              Array<{ id: string; name: string; birth_date: Date | null; card_number: string; batch_number: string | null; city: string | null; created_at: Date }>
            >`
              SELECT
                b.id,
                b.name,
                b.birth_date,
                b.card_number,
                b.batch_number,
                b.city,
                b.created_at
              FROM "Beneficiary" b
              WHERE b.deleted_at IS NULL
                AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ${targetCanonicalForPerson}
              ORDER BY b.created_at ASC
              LIMIT 1
            `;

            if (existingTargetHolder.length > 0) {
              const holder = existingTargetHolder[0];
              const holderKey = buildPersonKeyForFamily(holder.name, holder.birth_date);
              if (holderKey !== planItem.person_key) {
                skippedConflict += 1;
                continue;
              }
              members = [
                {
                  id: holder.id,
                  name: holder.name,
                  card_number: holder.card_number,
                  canonical_card: canonicalizeCardNumber(String(holder.card_number ?? "").trim().toUpperCase()),
                  birth_date: holder.birth_date,
                  batch_number: holder.batch_number,
                  city: holder.city,
                  created_at: holder.created_at,
                },
              ];
              personGroups.set(planItem.person_key, members);
            } else {
              const created = await prisma.beneficiary.create({
                data: {
                  card_number: targetCardForPerson,
                  name: String(truthSeed.beneficiary_name ?? planItem.name).trim(),
                  birth_date: truthSeed.birth_date ?? null,
                  batch_number: targetBatch ?? truthSeed.batch_number ?? null,
                  city: truthSeed.city ?? null,
                  completed_via: "family_numbering_modal",
                },
                select: {
                  id: true,
                  name: true,
                  card_number: true,
                  birth_date: true,
                  batch_number: true,
                  city: true,
                  created_at: true,
                },
              });
              createdFromTruth += 1;
              members = [
                {
                  id: created.id,
                  name: created.name,
                  card_number: created.card_number,
                  canonical_card: canonicalizeCardNumber(String(created.card_number ?? "").trim().toUpperCase()),
                  birth_date: created.birth_date,
                  batch_number: created.batch_number,
                  city: created.city,
                  created_at: created.created_at,
                },
              ];
              personGroups.set(planItem.person_key, members);
            }
          }
        }
      }

      const memberIds = members.map((member) => member.id);
      const externalHolder = await prisma.$queryRaw<
        Array<{ id: string; name: string; birth_date: Date | null; card_number: string; batch_number: string | null }>
      >`
        SELECT id, name, birth_date, card_number, batch_number
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          AND id <> ALL(${memberIds}::text[])
          AND REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ${targetCanonicalForPerson}
        ORDER BY created_at ASC
        LIMIT 1
      `;

      let keepId = "";
      if (externalHolder.length > 0) {
        const ext = externalHolder[0];
        const extKey = buildPersonKeyForFamily(ext.name, ext.birth_date);
        if (extKey !== planItem.person_key) {
          if (extKey && plannedPersonKeys.has(extKey)) {
            tempCardCounter += 1;
            const tempCard = `${familyBase}TMP${Date.now().toString().slice(-6)}${tempCardCounter}`;
            await prisma.beneficiary.updateMany({
              where: { id: ext.id, deleted_at: null },
              data: { card_number: tempCard },
            });
            temporaryReassigned += 1;
            temporaryMoves.push({
              id: ext.id,
              originalCard: String(ext.card_number ?? "").trim().toUpperCase(),
              originalBatch: ext.batch_number ?? null,
            });

            const extGroup = personGroups.get(extKey) ?? [];
            const patchedExtGroup = extGroup.map((member) =>
              member.id === ext.id
                ? {
                    ...member,
                    card_number: tempCard,
                    canonical_card: canonicalizeCardNumber(tempCard),
                  }
                : member,
            );
            if (patchedExtGroup.length > 0) {
              personGroups.set(extKey, patchedExtGroup);
            }
          } else {
            skippedConflict += 1;
            continue;
          }
          const currentHolder = members.find(
            (member) => canonicalizeCardNumber(String(member.card_number ?? "").trim().toUpperCase()) === targetCanonicalForPerson,
          );
          keepId = currentHolder?.id ?? members[0].id;
        } else {
          keepId = ext.id;
        }
      } else {
        const currentHolder = members.find(
          (member) => canonicalizeCardNumber(String(member.card_number ?? "").trim().toUpperCase()) === targetCanonicalForPerson,
        );
        keepId = currentHolder?.id ?? members[0].id;
      }

      await prisma.beneficiary.updateMany({
        where: { id: keepId, deleted_at: null },
        data: {
          card_number: targetCardForPerson,
          batch_number: targetBatch,
          name: planItem.name,
          birth_date: planItem.birth_date ? new Date(planItem.birth_date) : null,
          birth_date_synced_from_truth: planItem.birth_date ? true : false,
        },
      });
      updated += 1;

      for (const member of members) {
        const sourceCanonicalForTouch = canonicalizeCardNumber(String(member.card_number ?? "").trim().toUpperCase());
        if (sourceCanonicalForTouch) touchedCanonicals.add(sourceCanonicalForTouch);

        if (member.id === keepId) continue;
        const mergeResult = await mergeBeneficiaryIntoTargetCard({
          sourceBeneficiaryId: member.id,
          keepBeneficiaryId: keepId,
          targetCardOfficial: targetCardForPerson,
          targetBatch,
        });
        if ("error" in mergeResult && mergeResult.error) {
          skippedConflict += 1;
        } else {
          merged += 1;
        }
      }

      const personNameForUpdate = normalizeNameLoose(planItem.name);
      const birthDateForUpdate = planItem.birth_date;
      const truthUpdated = await prisma.$executeRaw`
        UPDATE "CardIssuanceRegistryAll"
        SET
          card_number = ${targetCardForPerson},
          card_number_upper = ${targetCanonicalForPerson},
          canonical_card = ${targetCanonicalForPerson},
          updated_at = NOW()
        WHERE birth_date IS NOT NULL
          AND birth_date::date = ${birthDateForUpdate}::date
          AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) = ${personNameForUpdate}
          AND COALESCE(
            SUBSTRING(canonical_card FROM '^(WAB2025[0-9]+)'),
            canonical_card
          ) = ${familyBase}
      `;
      truthUpdatedRows += Number(truthUpdated ?? 0);
      touchedCanonicals.add(targetCanonicalForPerson);
    }

    if (temporaryMoves.length > 0) {
      const movedIds = temporaryMoves.map((item) => item.id);
      const movedRows = await prisma.beneficiary.findMany({
        where: { id: { in: movedIds }, deleted_at: null },
        select: { id: true, card_number: true },
      });

      for (const moved of movedRows) {
        const currentCard = String(moved.card_number ?? "").trim().toUpperCase();
        if (!currentCard.startsWith(`${familyBase}TMP`)) continue;
        const original = temporaryMoves.find((item) => item.id === moved.id);
        if (!original?.originalCard) continue;
        await prisma.beneficiary.updateMany({
          where: { id: moved.id, deleted_at: null },
          data: {
            card_number: original.originalCard,
            batch_number: original.originalBatch,
          },
        });
        skippedConflict += 1;
      }
    }

    for (const canonical of touchedCanonicals) {
      await refreshTruthRegistrySnapshotByCanonical(canonical);
    }

    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");

    return {
      success: true,
      targetCard: targetCardOfficial,
      updated,
      merged,
      skippedConflict,
      truthUpdatedRows,
      createdFromTruth,
      restoredFromDeleted,
      temporaryReassigned,
      candidatesCount: familyPlan.plan.length,
      familyStandardized: true,
    };
  } catch (error) {
    console.error("Resolve family numbering mismatch error:", error);
    return { error: "حدث خطأ أثناء معالجة تباين الترقيم" };
  }
}

type TruthToSystemFilter = {
  query?: string;
  city?: string;
  batch?: string;
  system_primary?: boolean;
  multi?: boolean;
  not_in_system?: boolean;
  in_system_not_in_registry?: boolean;
  similar_only?: boolean;
  similar_numeric?: boolean;
  similar_name_birth?: boolean;
  similar_family_suffix?: boolean;
  family_numbering_mismatch?: boolean;
  multi_person_cards?: boolean;
  legacy_no_batch?: boolean;
  legacy_has_batch?: boolean;
  numbering_conflict_mode?: "skip" | "merge_use_truth" | "keep_system" | string;
  sort?: string;
};

type TruthMigrationNumberingConflictMode = "skip" | "merge_use_truth" | "keep_system";

function normalizeMigrationNumberingConflictMode(
  value: TruthMigrationNumberingConflictMode | string | null | undefined,
): TruthMigrationNumberingConflictMode {
  const normalized = String(value ?? "").trim();
  if (normalized === "merge_use_truth") return "merge_use_truth";
  if (normalized === "keep_system") return "keep_system";
  return "skip";
}

type SuggestedMatchInput = {
  beneficiaryId: string;
  targetCard: string;
};

type SystemRowForSimilarity = {
  id: string;
  card_number: string;
  name: string | null;
  birth_date: Date | null;
  city: string | null;
  batch_number: string | null;
};

type TruthRowForSimilarity = {
  canonical_card: string;
  card_number: string;
  batch_number: string | null;
  beneficiary_name: string | null;
  birth_date: Date | null;
  updated_at: Date;
};

function normalizeNameLoose(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toUpperCase();
}

function birthKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dedupeSuggestedMatches(inputs: SuggestedMatchInput[]) {
  const byId = new Map<string, string>();
  for (const input of inputs) {
    const beneficiaryId = String(input.beneficiaryId ?? "").trim();
    const targetCard = String(input.targetCard ?? "").trim().toUpperCase();
    if (!beneficiaryId || !targetCard) continue;
    if (!byId.has(beneficiaryId)) {
      byId.set(beneficiaryId, targetCard);
    }
  }
  return Array.from(byId.entries()).map(([beneficiaryId, targetCard]) => ({ beneficiaryId, targetCard }));
}

async function mergeBeneficiaryIntoTargetCard(params: {
  sourceBeneficiaryId: string;
  keepBeneficiaryId: string;
  targetCardOfficial: string;
  targetBatch: string | null;
}) {
  const sourceBeneficiaryId = String(params.sourceBeneficiaryId ?? "").trim();
  const keepBeneficiaryId = String(params.keepBeneficiaryId ?? "").trim();
  const targetCardOfficial = String(params.targetCardOfficial ?? "").trim().toUpperCase();
  const targetBatch = String(params.targetBatch ?? "").trim();

  if (!sourceBeneficiaryId || !keepBeneficiaryId || !targetCardOfficial) {
    return { error: "بيانات الدمج غير مكتملة" };
  }

  if (sourceBeneficiaryId === keepBeneficiaryId) {
    return { success: true, mergedCount: 0, keepId: keepBeneficiaryId };
  }

  const mergeResult = await mergeDuplicateBeneficiaries(keepBeneficiaryId, {
    forceKeep: true,
    candidateIds: [keepBeneficiaryId, sourceBeneficiaryId],
    explicitMergeIds: [sourceBeneficiaryId],
    strategy: "ZERO_PRIORITY",
  });

  if ("error" in mergeResult && mergeResult.error) {
    return { error: mergeResult.error };
  }

  const keepId = String((mergeResult as { keepId?: string }).keepId ?? keepBeneficiaryId).trim();

  const updateData: { card_number: string; batch_number?: string } = {
    card_number: targetCardOfficial,
  };
  if (targetBatch) {
    updateData.batch_number = targetBatch;
  }

  await prisma.$transaction(async (tx) => {
    await tx.beneficiary.updateMany({
      where: { id: keepId, deleted_at: null },
      data: updateData,
    });

    await tx.claim.updateMany({
      where: { beneficiary_id: sourceBeneficiaryId },
      data: { beneficiary_id: keepId },
    });

    await tx.$executeRaw`
      INSERT INTO "WalletConsumption" (
        id,
        beneficiary_id,
        company_id,
        wallet_type,
        fiscal_year,
        consumed_amount,
        version,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid()::text,
        ${keepId},
        wc.company_id,
        wc.wallet_type,
        wc.fiscal_year,
        wc.consumed_amount,
        1,
        NOW(),
        NOW()
      FROM "WalletConsumption" wc
      WHERE wc.beneficiary_id = ${sourceBeneficiaryId}
      ON CONFLICT (beneficiary_id, company_id, wallet_type, fiscal_year)
      DO UPDATE SET
        consumed_amount = "WalletConsumption".consumed_amount + EXCLUDED.consumed_amount,
        version = "WalletConsumption".version + 1,
        updated_at = NOW()
    `;

    await tx.walletConsumption.deleteMany({
      where: { beneficiary_id: sourceBeneficiaryId },
    });
  });

  return {
    success: true,
    mergedCount: Number((mergeResult as { mergedCount?: number }).mergedCount ?? 0),
    keepId,
  };
}

function familyBaseFromCard(card: string): string {
  const normalized = String(card ?? "").trim().toUpperCase();
  const suffixMatch = normalized.match(/^(WAB2025\d+)(?:[WMFH]\d*|[DSB]\d+)$/i);
  return suffixMatch ? suffixMatch[1] : normalized;
}

async function refreshTruthRegistrySnapshotByCanonical(canonicalCard: string) {
  const canonical = canonicalizeCardNumber(String(canonicalCard ?? "").trim().toUpperCase());
  if (!canonical) return;

  const latest = await prisma.cardIssuanceRegistryAll.findFirst({
    where: { canonical_card: canonical },
    select: {
      card_number: true,
      beneficiary_name: true,
      birth_date: true,
      city: true,
      batch_number: true,
      updated_at: true,
    },
    orderBy: { updated_at: "desc" },
  });

  if (latest) {
    await prisma.cardIssuanceRegistry.upsert({
      where: { card_number_upper: canonical },
      update: {
        card_number: latest.card_number,
        canonical_card: canonical,
        beneficiary_name: latest.beneficiary_name,
        birth_date: latest.birth_date,
        city: latest.city,
        batch_number: latest.batch_number,
        updated_at: latest.updated_at ?? new Date(),
      },
      create: {
        card_number: latest.card_number,
        card_number_upper: canonical,
        canonical_card: canonical,
        beneficiary_name: latest.beneficiary_name,
        birth_date: latest.birth_date,
        city: latest.city,
        batch_number: latest.batch_number,
      },
    });
    return;
  }

  await prisma.cardIssuanceRegistry.deleteMany({
    where: {
      OR: [{ canonical_card: canonical }, { card_number_upper: canonical }],
    },
  });
}

async function syncTruthNumberingForSamePerson(params: {
  sourceCard: string;
  targetCard: string;
  personName: string | null | undefined;
  birthDate: Date | null | undefined;
}) {
  const sourceCanonical = canonicalizeCardNumber(String(params.sourceCard ?? "").trim().toUpperCase());
  const targetCanonical = canonicalizeCardNumber(String(params.targetCard ?? "").trim().toUpperCase());
  if (!sourceCanonical || !targetCanonical || sourceCanonical === targetCanonical) {
    return { updatedRows: 0 };
  }

  const normalizedName = normalizeNameLoose(params.personName);
  const birthDateKey = birthKey(params.birthDate);
  if (!normalizedName || !birthDateKey) {
    return { updatedRows: 0 };
  }

  const sourceBase = familyBaseFromCard(sourceCanonical);
  const targetBase = familyBaseFromCard(targetCanonical);
  if (!sourceBase || !targetBase || sourceBase !== targetBase) {
    return { updatedRows: 0 };
  }

  const targetCardOfficial = String(params.targetCard ?? "").trim().toUpperCase();
  const now = new Date();

  const updated = await prisma.$executeRaw`
    UPDATE "CardIssuanceRegistryAll"
    SET
      card_number = ${targetCardOfficial},
      card_number_upper = ${targetCanonical},
      canonical_card = ${targetCanonical},
      updated_at = ${now}
    WHERE canonical_card = ${sourceCanonical}
      AND birth_date IS NOT NULL
      AND birth_date::date = ${birthDateKey}::date
      AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) = ${normalizedName}
      AND COALESCE(SUBSTRING(canonical_card FROM '^(WAB2025[0-9]+)'), canonical_card) = ${sourceBase}
  `;

  await refreshTruthRegistrySnapshotByCanonical(sourceCanonical);
  await refreshTruthRegistrySnapshotByCanonical(targetCanonical);

  return { updatedRows: Number(updated ?? 0) };
}

async function applySuggestedMatchesInternal(inputs: SuggestedMatchInput[]) {
  const deduped = dedupeSuggestedMatches(inputs);
  if (deduped.length === 0) {
    return {
      attempted: 0,
      applied: 0,
      merged: 0,
      skippedNotFound: 0,
      skippedInvalidTarget: 0,
      skippedNoTruth: 0,
      skippedConflict: 0,
      skippedAlreadyMatched: 0,
    };
  }

  const beneficiaryIds = deduped.map((x) => x.beneficiaryId);
  const targetCanonicals = Array.from(
    new Set(
      deduped
        .map((x) => canonicalizeCardNumber(x.targetCard))
        .filter((x) => Boolean(x))
    ),
  );

  const [beneficiaries, truthRows] = await Promise.all([
    prisma.beneficiary.findMany({
      where: { id: { in: beneficiaryIds }, deleted_at: null },
      select: { id: true, name: true, birth_date: true, card_number: true, batch_number: true },
    }),
    targetCanonicals.length > 0
      ? prisma.cardIssuanceRegistry.findMany({
          where: { canonical_card: { in: targetCanonicals } },
          select: {
            canonical_card: true,
            card_number: true,
            batch_number: true,
            updated_at: true,
          },
          orderBy: { updated_at: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const beneficiaryById = new Map(beneficiaries.map((b) => [b.id, b]));
  const truthByCanonical = new Map<string, { card_number: string; batch_number: string | null }>();
  for (const row of truthRows) {
    if (!truthByCanonical.has(row.canonical_card)) {
      truthByCanonical.set(row.canonical_card, {
        card_number: row.card_number,
        batch_number: row.batch_number,
      });
    }
  }

  const candidates: Array<{
    beneficiaryId: string;
    personName: string | null;
    personBirthDate: Date | null;
    currentCard: string;
    targetCard: string;
    targetCanonical: string;
    targetBatch: string | null;
  }> = [];

  let skippedNotFound = 0;
  let skippedInvalidTarget = 0;
  let skippedNoTruth = 0;
  let skippedAlreadyMatched = 0;

  for (const item of deduped) {
    const b = beneficiaryById.get(item.beneficiaryId);
    if (!b) {
      skippedNotFound += 1;
      continue;
    }

    const targetCanonical = canonicalizeCardNumber(item.targetCard);
    if (!targetCanonical) {
      skippedInvalidTarget += 1;
      continue;
    }

    const truth = truthByCanonical.get(targetCanonical);
    if (!truth) {
      skippedNoTruth += 1;
      continue;
    }

    const targetOfficial = String(truth.card_number ?? "").trim().toUpperCase();
    const targetOfficialCanonical = canonicalizeCardNumber(targetOfficial);
    if (!targetOfficial || !targetOfficialCanonical) {
      skippedInvalidTarget += 1;
      continue;
    }

    const currentCanonical = canonicalizeCardNumber(String(b.card_number ?? "").trim().toUpperCase());
    if (currentCanonical && currentCanonical === targetOfficialCanonical) {
      skippedAlreadyMatched += 1;
      continue;
    }

    candidates.push({
      beneficiaryId: b.id,
      personName: b.name,
      personBirthDate: b.birth_date,
      currentCard: b.card_number,
      targetCard: targetOfficial,
      targetCanonical: targetOfficialCanonical,
      targetBatch: truth.batch_number ?? b.batch_number ?? null,
    });
  }

  if (candidates.length === 0) {
    return {
      attempted: deduped.length,
      applied: 0,
      merged: 0,
      skippedNotFound,
      skippedInvalidTarget,
      skippedNoTruth,
      skippedConflict: 0,
      skippedAlreadyMatched,
    };
  }

  const candidateIds = candidates.map((c) => c.beneficiaryId);
  const candidateCanonicals = Array.from(new Set(candidates.map((c) => c.targetCanonical)));

  const existingConflicts = await prisma.$queryRaw<{ id: string; canonical_card: string }[]>`
    SELECT
      id,
      REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND id <> ALL(${candidateIds}::text[])
      AND REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ANY(${candidateCanonicals}::text[])
  `;
  const keepByCanonical = new Map<string, string>();
  for (const row of existingConflicts) {
    if (!keepByCanonical.has(row.canonical_card)) {
      keepByCanonical.set(row.canonical_card, row.id);
    }
  }

  const byCanonical = new Map<string, typeof candidates>();
  for (const item of candidates) {
    const arr = byCanonical.get(item.targetCanonical) ?? [];
    arr.push(item);
    byCanonical.set(item.targetCanonical, arr);
  }

  let applied = 0;
  let merged = 0;
  let skippedConflict = 0;

  for (const [canonical, group] of byCanonical.entries()) {
    if (group.length === 0) continue;

    const externalKeepId = keepByCanonical.get(canonical);
    if (externalKeepId) {
      for (const item of group) {
        const mergeRes = await mergeBeneficiaryIntoTargetCard({
          sourceBeneficiaryId: item.beneficiaryId,
          keepBeneficiaryId: externalKeepId,
          targetCardOfficial: item.targetCard,
          targetBatch: item.targetBatch,
        });
        if ("error" in mergeRes && mergeRes.error) {
          skippedConflict += 1;
        } else {
          await syncTruthNumberingForSamePerson({
            sourceCard: item.currentCard,
            targetCard: item.targetCard,
            personName: item.personName,
            birthDate: item.personBirthDate,
          });
          merged += 1;
        }
      }
      continue;
    }

    const keepCandidate = group[0];
    try {
      await prisma.beneficiary.update({
        where: { id: keepCandidate.beneficiaryId },
        data: {
          card_number: keepCandidate.targetCard,
          batch_number: keepCandidate.targetBatch,
        },
      });
      await syncTruthNumberingForSamePerson({
        sourceCard: keepCandidate.currentCard,
        targetCard: keepCandidate.targetCard,
        personName: keepCandidate.personName,
        birthDate: keepCandidate.personBirthDate,
      });
      applied += 1;
    } catch {
      skippedConflict += 1;
      continue;
    }

    const keepId = keepCandidate.beneficiaryId;
    for (const item of group.slice(1)) {
      const mergeRes = await mergeBeneficiaryIntoTargetCard({
        sourceBeneficiaryId: item.beneficiaryId,
        keepBeneficiaryId: keepId,
        targetCardOfficial: keepCandidate.targetCard,
        targetBatch: keepCandidate.targetBatch,
      });
      if ("error" in mergeRes && mergeRes.error) {
        skippedConflict += 1;
      } else {
        await syncTruthNumberingForSamePerson({
          sourceCard: item.currentCard,
          targetCard: keepCandidate.targetCard,
          personName: item.personName,
          birthDate: item.personBirthDate,
        });
        merged += 1;
      }
    }
  }

  return {
    attempted: deduped.length,
    applied,
    merged,
    skippedNotFound,
    skippedInvalidTarget,
    skippedNoTruth,
    skippedConflict,
    skippedAlreadyMatched,
  };
}

async function buildSimilaritySuggestedMatches(
  rows: SystemRowForSimilarity[],
  options: {
    numericOnly: boolean;
    nameBirthOnly: boolean;
    familySuffixOnly: boolean;
    familyNumberingOnly: boolean;
  },
): Promise<SuggestedMatchInput[]> {
  if (rows.length === 0) return [];

  const noSpecificType =
    !options.numericOnly &&
    !options.nameBirthOnly &&
    !options.familySuffixOnly &&
    !options.familyNumberingOnly;
  const useNumeric = options.numericOnly || noSpecificType;
  const useNameBirth = options.nameBirthOnly || noSpecificType;
  const useFamilySuffix = options.familySuffixOnly || noSpecificType;
  const useFamilyNumbering = options.familyNumberingOnly;

  const minusOneCanonicals = new Set<string>();
  const familyVariantCanonicals = new Set<string>();
  const names = new Set<string>();

  for (const row of rows) {
    const canonical = canonicalizeCardNumber(String(row.card_number ?? "").trim().toUpperCase());
    if (useNumeric) {
      const minusOne = canonical.match(/^(WAB2025\d+)1$/)?.[1];
      if (minusOne) minusOneCanonicals.add(minusOne);
    }
    if (useFamilySuffix) {
      const withOne = canonical.match(/^(WAB2025[0-9]+)([FMW])1$/);
      if (withOne) {
        familyVariantCanonicals.add(`${withOne[1]}${withOne[2]}`);
      } else {
        const withoutOne = canonical.match(/^(WAB2025[0-9]+)([FMW])$/);
        if (withoutOne) {
          familyVariantCanonicals.add(`${withoutOne[1]}${withoutOne[2]}1`);
        }
      }
    }
    if ((useNameBirth || useFamilyNumbering) && row.name) {
      names.add(String(row.name).trim());
    }
  }

  const [numericTruthRows, nameBirthTruthRows, familyTruthRows] = await Promise.all([
    useNumeric && minusOneCanonicals.size > 0
      ? prisma.cardIssuanceRegistry.findMany({
          where: { canonical_card: { in: Array.from(minusOneCanonicals) } },
          select: {
            canonical_card: true,
            card_number: true,
            batch_number: true,
            beneficiary_name: true,
            birth_date: true,
            updated_at: true,
          },
          orderBy: { updated_at: "desc" },
        })
      : Promise.resolve([] as TruthRowForSimilarity[]),
    (useNameBirth || useFamilyNumbering) && names.size > 0
      ? prisma.cardIssuanceRegistry.findMany({
          where: {
            beneficiary_name: { in: Array.from(names) },
            birth_date: { not: null },
          },
          select: {
            canonical_card: true,
            card_number: true,
            batch_number: true,
            beneficiary_name: true,
            birth_date: true,
            updated_at: true,
          },
          orderBy: { updated_at: "desc" },
        })
      : Promise.resolve([] as TruthRowForSimilarity[]),
    useFamilySuffix && familyVariantCanonicals.size > 0
      ? prisma.cardIssuanceRegistry.findMany({
          where: { canonical_card: { in: Array.from(familyVariantCanonicals) } },
          select: {
            canonical_card: true,
            card_number: true,
            batch_number: true,
            beneficiary_name: true,
            birth_date: true,
            updated_at: true,
          },
          orderBy: { updated_at: "desc" },
        })
      : Promise.resolve([] as TruthRowForSimilarity[]),
  ]);

  const numericTruthByCanonical = new Map<string, TruthRowForSimilarity>();
  for (const row of numericTruthRows) {
    if (!numericTruthByCanonical.has(row.canonical_card)) {
      numericTruthByCanonical.set(row.canonical_card, row);
    }
  }

  const nameBirthTruthByKey = new Map<string, TruthRowForSimilarity>();
  const nameBirthTruthByKeyAll = new Map<string, TruthRowForSimilarity[]>();
  for (const row of nameBirthTruthRows) {
    const key = `${normalizeNameLoose(row.beneficiary_name)}::${birthKey(row.birth_date)}`;
    if (!key.endsWith("::") && !nameBirthTruthByKey.has(key)) {
      nameBirthTruthByKey.set(key, row);
    }
    if (!key.endsWith("::")) {
      const bucket = nameBirthTruthByKeyAll.get(key) ?? [];
      bucket.push(row);
      nameBirthTruthByKeyAll.set(key, bucket);
    }
  }

  const familyTruthByCanonical = new Map<string, TruthRowForSimilarity>();
  for (const row of familyTruthRows) {
    if (!familyTruthByCanonical.has(row.canonical_card)) {
      familyTruthByCanonical.set(row.canonical_card, row);
    }
  }

  const output: SuggestedMatchInput[] = [];

  for (const row of rows) {
    const currentCanonical = canonicalizeCardNumber(String(row.card_number ?? "").trim().toUpperCase());

    if (useNumeric) {
      const minusOne = currentCanonical.match(/^(WAB2025\d+)1$/)?.[1] ?? "";
      const numericHit = minusOne ? numericTruthByCanonical.get(minusOne) : undefined;
      if (numericHit?.card_number) {
        output.push({
          beneficiaryId: row.id,
          targetCard: numericHit.card_number,
        });
        continue;
      }
    }

    if (useFamilySuffix) {
      const withOne = currentCanonical.match(/^(WAB2025[0-9]+)([FMW])1$/);
      const familyCanonical = withOne
        ? `${withOne[1]}${withOne[2]}`
        : (() => {
            const withoutOne = currentCanonical.match(/^(WAB2025[0-9]+)([FMW])$/);
            return withoutOne ? `${withoutOne[1]}${withoutOne[2]}1` : "";
          })();
      const familyHit = familyCanonical ? familyTruthByCanonical.get(familyCanonical) : undefined;
      if (familyHit?.card_number) {
        output.push({
          beneficiaryId: row.id,
          targetCard: familyHit.card_number,
        });
        continue;
      }
    }

    if (useFamilyNumbering) {
      const key = `${normalizeNameLoose(row.name)}::${birthKey(row.birth_date)}`;
      if (!key.endsWith("::")) {
        const currentBase = familyBaseFromCard(currentCanonical);
        const candidates = nameBirthTruthByKeyAll.get(key) ?? [];
        const familyNumberingHit = candidates.find((candidate) => {
          if (!candidate.card_number || !candidate.canonical_card) return false;
          if (candidate.canonical_card === currentCanonical) return false;
          const candidateBase = familyBaseFromCard(String(candidate.canonical_card));
          return candidateBase === currentBase;
        });
        if (familyNumberingHit?.card_number) {
          output.push({
            beneficiaryId: row.id,
            targetCard: familyNumberingHit.card_number,
          });
          continue;
        }
      }
    }

    if (useNameBirth) {
      const key = `${normalizeNameLoose(row.name)}::${birthKey(row.birth_date)}`;
      const nameHit = nameBirthTruthByKey.get(key);
      if (nameHit?.card_number && nameHit.canonical_card !== currentCanonical) {
        output.push({
          beneficiaryId: row.id,
          targetCard: nameHit.card_number,
        });
      }
    }
  }

  return output;
}

export async function applySuggestedTruthMatchesAction(data: {
  matches: SuggestedMatchInput[];
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const matches = Array.isArray(data.matches) ? data.matches : [];
  if (matches.length === 0) {
    return { error: "لا توجد حالات مقاربة للتطبيق" };
  }

  try {
    const result = await applySuggestedMatchesInternal(matches);
    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");
    return { success: true, ...result };
  } catch (error) {
    console.error("Apply suggested truth matches error:", error);
    return { error: "حدث خطأ أثناء التطبيق الجماعي للمقاربة" };
  }
}

export async function applySuggestedTruthMatchesByFilterAction(filters: TruthToSystemFilter) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  try {
    const query = String(filters.query ?? "").trim();
    const cityFilter = String(filters.city ?? "").trim();
    const batchFilter = String(filters.batch ?? "").trim();
    const isNoBatchFilter = batchFilter === "__NO_BATCH__";
    const onlyInSystemNotInRegistry = filters.in_system_not_in_registry === true;
    const useSystemPrimaryRows = filters.system_primary === true && filters.not_in_system !== true;
    const onlyLegacyNoBatch = filters.legacy_no_batch === true;
    const onlyLegacyHasBatch = filters.legacy_has_batch === true;
    const onlySimilarNumeric = filters.similar_numeric === true;
    const onlySimilarNameBirth = filters.similar_name_birth === true;
    const onlySimilarFamilySuffix = filters.similar_family_suffix === true;
    const onlyFamilyNumberingMismatch = filters.family_numbering_mismatch === true;

    if (!onlyInSystemNotInRegistry && !onlyFamilyNumberingMismatch && !useSystemPrimaryRows) {
      return { error: "التطبيق الجماعي للمقاربة متاح فقط ضمن نتائج المنظومة (مصدر أساسي) أو حالات اختلاف الترقيم العائلي" };
    }

    const sourceRows = await prisma.$queryRaw<SystemRowForSimilarity[]>`
      SELECT
        b.id,
        b.card_number,
        b.name,
        b.birth_date,
        b.city,
        b.batch_number
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND (
          ${onlyInSystemNotInRegistry} = false
          OR (b."company_id" = ${WAHDA_BANK_COMPANY_ID} OR b."company_id" IS NULL)
        )
        AND (${cityFilter} = '' OR COALESCE(b.city, '—') = ${cityFilter})
        AND (
          (${batchFilter} = '')
          OR (${isNoBatchFilter} = true AND (b.batch_number IS NULL OR BTRIM(b.batch_number) = ''))
          OR (${isNoBatchFilter} = false AND b.batch_number = ${batchFilter})
        )
        AND (
          ${query} = ''
          OR b.card_number ILIKE ${`%${query}%`}
          OR b.name ILIKE ${`%${query}%`}
        )
        AND (
          ${onlyInSystemNotInRegistry} = false
          OR ${onlyFamilyNumberingMismatch} = true
          OR REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') NOT IN (
            SELECT canonical_card
            FROM "CardIssuanceRegistryAll"
            WHERE canonical_card IS NOT NULL
          )
        )
        AND (
          ${onlyLegacyNoBatch} = false
          OR (
            b.is_legacy_card = true
            AND (b.batch_number IS NULL OR BTRIM(b.batch_number) = '')
          )
        )
        AND (
          ${onlyLegacyHasBatch} = false
          OR (
            b.is_legacy_card = true
            AND b.batch_number IS NOT NULL AND BTRIM(b.batch_number) <> ''
          )
        )
        AND (
          ${onlyFamilyNumberingMismatch} = false
          OR EXISTS (
            SELECT 1
            FROM "CardIssuanceRegistryAll" t
            WHERE UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                  UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g'))
              AND (
                (b.birth_date IS NOT NULL AND t.birth_date IS NOT NULL AND t.birth_date::date = b.birth_date::date)
                OR
                (b.birth_date IS NULL)
              )
              AND COALESCE(
                SUBSTRING(t.canonical_card FROM '^(WAB2025[0-9]+)'),
                t.canonical_card
              ) = COALESCE(
                SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
                REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
              )
              AND t.canonical_card <>
                  REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
          )
        )
      ORDER BY b.created_at DESC
    `;

    const suggested = await buildSimilaritySuggestedMatches(sourceRows, {
      numericOnly: onlySimilarNumeric,
      nameBirthOnly: onlySimilarNameBirth,
      familySuffixOnly: onlySimilarFamilySuffix,
      familyNumberingOnly: onlyFamilyNumberingMismatch,
    });

    const result = await applySuggestedMatchesInternal(suggested);
    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");
    return { success: true, ...result, totalCandidates: suggested.length };
  } catch (error) {
    console.error("Apply suggested truth matches by filter error:", error);
    return { error: "حدث خطأ أثناء تطبيق المقاربة على نتائج الفلتر" };
  }
}

type RegistryAllForMigration = {
  id: string;
  card_number: string;
  canonical_card: string | null;
  beneficiary_name: string | null;
  birth_date: Date | null;
  city: string;
  batch_number: string;
};

type TruthMigrationNumberingConflictPreview = {
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

type ExistingPersonRowForMigration = {
  id: string;
  name: string | null;
  birth_date: Date | null;
  birth_key: string | null;
  normalized_name: string;
  card_number: string;
  canonical_card: string;
  batch_number: string | null;
  created_at: Date;
};

function safeNameForMigration(name: string | null, card: string): string {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `مستفيد ${card}`;
}

function normalizePersonNameForUnique(name: string | null | undefined): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function birthDateKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function canonicalizeCardForMigration(card: string | null | undefined): string {
  const raw = String(card ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  const m = raw.match(/^WAB20250*([1-9][0-9]*|0)([A-Z0-9]*)$/);
  if (!m) return raw;
  const numericCore = m[1];
  const suffix = m[2] ?? "";
  return `WAB2025${numericCore}${suffix}`;
}

export async function prepareTruthMigrationNumberingConflictsAction(data: { ids: string[] }) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const ids = Array.isArray(data?.ids)
    ? Array.from(new Set(data.ids.map((x) => String(x ?? "").trim()).filter(Boolean)))
    : [];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي سجلات لتحليل التعارض" };
  }

  try {
    const rows = await prisma.cardIssuanceRegistryAll.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        card_number: true,
        canonical_card: true,
        beneficiary_name: true,
        birth_date: true,
        city: true,
        batch_number: true,
      },
    });

    if (rows.length === 0) {
      return { success: true, conflicts: [] as TruthMigrationNumberingConflictPreview[] };
    }

    const preparedRows = rows.map((r) => {
      const card = String(r.card_number ?? "").trim().toUpperCase();
      const canonicalFromRow = String(r.canonical_card ?? "").trim().toUpperCase();
      const canonical = canonicalFromRow || canonicalizeCardForMigration(card);
      return {
        ...r,
        _card: card,
        _canonical: canonical,
      };
    });

    const candidateBirthDates = Array.from(
      new Set(
        preparedRows
          .map((r) => birthDateKey(r.birth_date))
          .filter((x) => x.length > 0),
      ),
    );

    const candidateNames = Array.from(
      new Set(
        preparedRows
          .map((r) =>
            normalizePersonNameForUnique(
              safeNameForMigration(r.beneficiary_name, String(r.card_number ?? "").trim()),
            ),
          )
          .filter((x) => x.length > 0),
      ),
    );

    const existingPersons =
      candidateBirthDates.length > 0 && candidateNames.length > 0
        ? await prisma.$queryRaw<ExistingPersonRowForMigration[]>`
            SELECT
              id,
              name,
              birth_date,
              birth_date::date::text AS birth_key,
              UPPER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) AS normalized_name,
              card_number,
              REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card,
              batch_number,
              created_at
            FROM "Beneficiary"
            WHERE deleted_at IS NULL
              AND birth_date IS NOT NULL
              AND birth_date::date = ANY(${candidateBirthDates}::date[])
              AND UPPER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) = ANY(${candidateNames}::text[])
            ORDER BY created_at ASC
          `
        : [];

    const existingSystemByPersonKey = new Map<string, ExistingPersonRowForMigration[]>();
    for (const row of existingPersons) {
      const personKey = row.birth_key ? `${row.normalized_name}::${row.birth_key}` : "";
      if (!personKey) continue;
      const bucket = existingSystemByPersonKey.get(personKey) ?? [];
      bucket.push(row);
      existingSystemByPersonKey.set(personKey, bucket);
    }

    const conflicts = new Map<string, TruthMigrationNumberingConflictPreview>();
    for (const row of preparedRows) {
      const safeName = safeNameForMigration(row.beneficiary_name, String(row.card_number ?? "").trim());
      const normalizedName = normalizePersonNameForUnique(safeName);
      const bKey = birthDateKey(row.birth_date);
      const personKey = bKey ? `${normalizedName}::${bKey}` : "";
      if (!personKey) continue;
      const existingForPerson = existingSystemByPersonKey.get(personKey) ?? [];
      if (existingForPerson.length === 0) continue;

      const truthCanonical = String(row._canonical ?? "").trim().toUpperCase();
      if (!truthCanonical) continue;

      const hasDifferentCanonical = existingForPerson.some(
        (item) => String(item.canonical_card ?? "").trim().toUpperCase() !== truthCanonical,
      );
      if (!hasDifferentCanonical) continue;

      if (conflicts.has(personKey)) continue;

      const preferredAnchor =
        existingForPerson.find(
          (item) => String(item.canonical_card ?? "").trim().toUpperCase() !== truthCanonical,
        ) ?? existingForPerson[0];

      conflicts.set(personKey, {
        person_key: personKey,
        truth_row_id: row.id,
        beneficiary_id: preferredAnchor.id,
        truth_card: String(row._card ?? row.card_number ?? "").trim().toUpperCase(),
        truth_canonical: truthCanonical,
        truth_name: safeName,
        truth_birth: bKey,
        truth_batch: String(row.batch_number ?? "").trim() || null,
        system_cards: Array.from(
          new Set(
            existingForPerson
              .map((item) => String(item.card_number ?? "").trim().toUpperCase())
              .filter(Boolean),
          ),
        ),
      });
    }

    const conflictList = Array.from(conflicts.values()).sort((a, b) => {
      const batchA = Number(String(a.truth_batch ?? "").trim()) || 0;
      const batchB = Number(String(b.truth_batch ?? "").trim()) || 0;
      if (batchA !== batchB) return batchA - batchB;
      return a.truth_name.localeCompare(b.truth_name, "ar");
    });

    return {
      success: true,
      conflicts: conflictList,
      totalSelected: rows.length,
      totalConflicts: conflictList.length,
    };
  } catch (error) {
    console.error("Prepare truth migration numbering conflicts error:", error);
    return { error: "حدث خطأ أثناء تحليل تعارضات الترقيم" };
  }
}

async function migrateRegistryRowsToSystem(
  rows: RegistryAllForMigration[],
  options: { numberingConflictMode?: TruthMigrationNumberingConflictMode | string } = {},
) {
  const numberingConflictMode = normalizeMigrationNumberingConflictMode(options.numberingConflictMode);

  if (rows.length === 0) {
    return {
      createdCount: 0,
      restoredCount: 0,
      skippedExisting: 0,
      skippedInvalid: 0,
      mergedCount: 0,
      resolvedNumberingCount: 0,
      keptSystemNumbering: 0,
      skippedNumberingConflict: 0,
      numberingConflictMode,
    };
  }

  const preparedRows = rows.map((r) => {
    const card = String(r.card_number ?? "").trim().toUpperCase();
    const canonicalFromRow = String(r.canonical_card ?? "").trim().toUpperCase();
    const canonical = canonicalFromRow || canonicalizeCardForMigration(card);
    return {
      ...r,
      _card: card,
      _canonical: canonical,
    };
  });

  const familyBases = Array.from(
    new Set(
      preparedRows
        .map((r) => parseFamilySuffixFromCanonical(r._canonical).base)
        .filter(Boolean)
    )
  );

  let resolvedNumberingCount = 0;

  if (familyBases.length > 0) {
    // 1. Fetch system rows for these family bases
    const systemFamilyRows = await prisma.$queryRaw<
      Array<{ id: string; name: string | null; card_number: string; canonical_card: string; birth_date: Date | null }>
    >`
      SELECT
        id,
        name,
        card_number,
        REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card,
        birth_date
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND REGEXP_REPLACE(
          REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'),
          '(?:[WMFH]\\d*|[DSB]\\d+)$',
          ''
        ) = ANY(${familyBases}::text[])
    `;

    // 2. Fetch all truth rows for these families
    const truthFamilyRows = await prisma.$queryRaw<
      Array<{ id: string; beneficiary_name: string | null; card_number: string; canonical_card: string; birth_date: Date | null }>
    >`
      SELECT
        id,
        beneficiary_name,
        card_number,
        canonical_card,
        birth_date
      FROM "CardIssuanceRegistryAll"
      WHERE REGEXP_REPLACE(
        canonical_card,
        '(?:[WMFH]\\d*|[DSB]\\d+)$',
        ''
      ) = ANY(${familyBases}::text[])
    `;

    // Group system and truth rows by family base
    const systemRowsByBase = new Map<string, typeof systemFamilyRows>();
    for (const r of systemFamilyRows) {
      const base = buildFamilyNumberingBaseFromCanonical(r.canonical_card);
      const list = systemRowsByBase.get(base) ?? [];
      list.push(r);
      systemRowsByBase.set(base, list);
    }

    const truthRowsByBase = new Map<string, typeof truthFamilyRows>();
    for (const r of truthFamilyRows) {
      const base = buildFamilyNumberingBaseFromCanonical(r.canonical_card);
      const list = truthRowsByBase.get(base) ?? [];
      list.push(r);
      truthRowsByBase.set(base, list);
    }

    const targetCardByPersonKey = new Map<string, string>();

    // 3. Re-index and standardize each family
    for (const base of familyBases) {
      const sRows = systemRowsByBase.get(base) ?? [];
      const tRows = truthRowsByBase.get(base) ?? [];

      const familyPlan = buildFamilyStandardizationPlan({
        familyBase: base,
        systemRows: sRows.map((r) => ({
          id: r.id,
          name: r.name,
          card_number: r.card_number,
          canonical_card: r.canonical_card,
          birth_date: r.birth_date,
        })),
        truthRows: tRows.map((r) => ({
          id: r.id,
          beneficiary_name: r.beneficiary_name,
          card_number: r.card_number,
          canonical_card: r.canonical_card,
          birth_date: r.birth_date,
        })),
      });

      for (const [pKey, targetCard] of familyPlan.targetByPersonKey.entries()) {
        targetCardByPersonKey.set(pKey, targetCard);
      }

      // Identify which existing system rows need updating
      const updatesToMake: Array<{
        id: string;
        currentCard: string;
        targetCard: string;
        targetName: string;
        targetBirthDate: string | null;
      }> = [];
      for (const sysRow of sRows) {
        const pKey = buildPersonKeyForFamily(sysRow.name, sysRow.birth_date);
        const targetCard = familyPlan.targetByPersonKey.get(pKey);
        const planItem = familyPlan.plan.find((p) => p.person_key === pKey);
        if (targetCard && sysRow.card_number.toUpperCase() !== targetCard.toUpperCase()) {
          updatesToMake.push({
            id: sysRow.id,
            currentCard: sysRow.card_number,
            targetCard,
            targetName: planItem?.name ?? sysRow.name ?? "",
            targetBirthDate: planItem?.birth_date ?? (sysRow.birth_date ? sysRow.birth_date.toISOString() : null),
          });
        }
      }

      if (updatesToMake.length > 0) {
        let tempCounter = 0;
        const tempMoves: Array<{
          id: string;
          targetCard: string;
          targetName: string;
          targetBirthDate: string | null;
        }> = [];

        // Temporary re-assignment to avoid unique key collisions
        for (const item of updatesToMake) {
          const tempCard = `${base}TMP${Date.now().toString().slice(-6)}${tempCounter++}`;
          await prisma.beneficiary.updateMany({
            where: { id: item.id, deleted_at: null },
            data: { card_number: tempCard },
          });
          tempMoves.push({
            id: item.id,
            targetCard: item.targetCard,
            targetName: item.targetName,
            targetBirthDate: item.targetBirthDate,
          });
        }

        // Final correct card assignment and demographic alignment
        for (const item of tempMoves) {
          await prisma.beneficiary.updateMany({
            where: { id: item.id, deleted_at: null },
            data: {
              card_number: item.targetCard,
              name: item.targetName,
              birth_date: item.targetBirthDate ? new Date(item.targetBirthDate) : null,
              birth_date_synced_from_truth: item.targetBirthDate ? true : false,
              completed_via: "truth_registry_migration_standardization",
            },
          });
          resolvedNumberingCount += 1;
        }
      }
    }

    // 4. Override incoming row card numbers to match the standardized plan
    for (const r of preparedRows) {
      const pKey = buildPersonKeyForFamily(r.beneficiary_name, r.birth_date);
      const standardizedCard = targetCardByPersonKey.get(pKey);
      if (standardizedCard) {
        r._card = standardizedCard;
        r._canonical = canonicalizeCardForMigration(standardizedCard);
      }
    }
  }

  const canonicalList = Array.from(new Set(preparedRows.map((r) => r._canonical).filter(Boolean)));
  if (canonicalList.length === 0) {
    return {
      createdCount: 0,
      restoredCount: 0,
      skippedExisting: 0,
      skippedInvalid: rows.length,
      mergedCount: 0,
      resolvedNumberingCount: 0,
      keptSystemNumbering: 0,
      skippedNumberingConflict: 0,
      numberingConflictMode,
    };
  }

  const existingInSystem = await prisma.$queryRaw<{ canonical_card: string }[]>`
    SELECT DISTINCT
      REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ANY(${canonicalList}::text[])
  `;

  const existingSet = new Set(existingInSystem.map((x) => x.canonical_card));

  const invalidRowsCount = preparedRows.filter((r) => !r._canonical || !r._card).length;
  const existingRowsCount = preparedRows.filter((r) => r._canonical && r._card && existingSet.has(r._canonical)).length;

  const toCreate = preparedRows.filter((r) => r._canonical && r._card && !existingSet.has(r._canonical));
  if (toCreate.length === 0) {
    return {
      createdCount: 0,
      restoredCount: 0,
      skippedExisting: existingRowsCount,
      skippedInvalid: invalidRowsCount,
      mergedCount: 0,
      resolvedNumberingCount: 0,
      keptSystemNumbering: 0,
      skippedNumberingConflict: 0,
      numberingConflictMode,
    };
  }

  const candidateBirthDates = Array.from(
    new Set(
      toCreate
        .map((r) => birthDateKey(r.birth_date))
        .filter((x) => x.length > 0),
    ),
  );

  const candidateNames = Array.from(
    new Set(
      toCreate
        .map((r) =>
          normalizePersonNameForUnique(safeNameForMigration(r.beneficiary_name, String(r.card_number).trim())),
        )
        .filter((x) => x.length > 0),
    ),
  );

  type ExistingPersonRow = {
    id: string;
    name: string | null;
    birth_date: Date | null;
    birth_key: string | null;
    normalized_name: string;
    card_number: string;
    canonical_card: string;
    batch_number: string | null;
    created_at: Date;
  };

  const existingPersons = candidateBirthDates.length > 0 && candidateNames.length > 0
    ? await prisma.$queryRaw<ExistingPersonRow[]>`
        SELECT
          id,
          name,
          birth_date,
          birth_date::date::text AS birth_key,
          UPPER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) AS normalized_name,
          card_number,
          REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card,
          batch_number,
          created_at
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          AND birth_date IS NOT NULL
          AND birth_date::date = ANY(${candidateBirthDates}::date[])
          AND UPPER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) = ANY(${candidateNames}::text[])
        ORDER BY created_at ASC
      `
    : [];

  const existingSystemByPersonKey = new Map<string, ExistingPersonRow[]>();
  for (const row of existingPersons) {
    const personKey = row.birth_key ? `${row.normalized_name}::${row.birth_key}` : "";
    if (!personKey) continue;
    const bucket = existingSystemByPersonKey.get(personKey) ?? [];
    bucket.push(row);
    existingSystemByPersonKey.set(personKey, bucket);
  }

  const toCreateByCard = new Map<string, (typeof toCreate)[number]>();
  for (const row of toCreate) {
    const cardKey = String(row.card_number ?? "").trim().toUpperCase();
    if (!cardKey) continue;
    if (!toCreateByCard.has(cardKey)) toCreateByCard.set(cardKey, row);
  }

  const dedupedToCreate: Array<(typeof toCreate)[number]> = [];
  const seenPersonKeys = new Set<string>();
  let skippedByPersonDuplicateInBatch = 0;
  for (const row of toCreateByCard.values()) {
    const safeName = safeNameForMigration(row.beneficiary_name, String(row.card_number).trim());
    const normalizedName = normalizePersonNameForUnique(safeName);
    const bKey = birthDateKey(row.birth_date);
    const personKey = bKey ? `${normalizedName}::${bKey}` : "";
    if (personKey && seenPersonKeys.has(personKey)) {
      skippedByPersonDuplicateInBatch += 1;
      continue;
    }
    if (personKey) seenPersonKeys.add(personKey);
    dedupedToCreate.push(row);
  }

  if (dedupedToCreate.length === 0) {
    return {
      createdCount: 0,
      restoredCount: 0,
      skippedExisting: existingRowsCount + skippedByPersonDuplicateInBatch,
      skippedInvalid: invalidRowsCount,
      mergedCount: 0,
      resolvedNumberingCount: 0,
      keptSystemNumbering: 0,
      skippedNumberingConflict: 0,
      numberingConflictMode,
    };
  }

  let mergedCount = 0;
  let keptSystemNumbering = 0;
  let skippedNumberingConflict = 0;
  let skippedByPersonExisting = 0;
  const handledRows = new Set<string>();

  for (const row of dedupedToCreate) {
    const safeName = safeNameForMigration(row.beneficiary_name, String(row.card_number).trim());
    const normalizedName = normalizePersonNameForUnique(safeName);
    const bKey = birthDateKey(row.birth_date);
    const personKey = bKey ? `${normalizedName}::${bKey}` : "";
    if (!personKey) continue;

    const existingForPerson = existingSystemByPersonKey.get(personKey) ?? [];
    if (existingForPerson.length === 0) continue;

    if (numberingConflictMode === "skip") {
      skippedByPersonExisting += 1;
      handledRows.add(row.id);
      continue;
    }

    if (numberingConflictMode === "keep_system") {
      keptSystemNumbering += 1;
      handledRows.add(row.id);
      continue;
    }

    const targetCanonical = String(row._canonical ?? "").trim().toUpperCase();
    const targetCardOfficial = String(row._card ?? row.card_number ?? "").trim().toUpperCase();
    if (!targetCanonical || !targetCardOfficial) {
      skippedNumberingConflict += 1;
      handledRows.add(row.id);
      continue;
    }

    const candidateIds = existingForPerson.map((item) => item.id);
    const externalTargetHolders = await prisma.$queryRaw<
      Array<{ id: string; name: string | null; birth_date: Date | null; card_number: string; batch_number: string | null }>
    >`
      SELECT
        b.id,
        b.name,
        b.birth_date,
        b.card_number,
        b.batch_number
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND b.id <> ALL(${candidateIds}::text[])
        AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ${targetCanonical}
      ORDER BY b.created_at ASC
      LIMIT 5
    `;

    let keepId = existingForPerson[0].id;
    if (externalTargetHolders.length > 0) {
      const holder = externalTargetHolders[0];
      const holderName = normalizePersonNameForUnique(holder.name);
      const holderBirth = birthDateKey(holder.birth_date);
      if (holderName !== normalizedName || holderBirth !== bKey) {
        skippedNumberingConflict += 1;
        handledRows.add(row.id);
        continue;
      }
      keepId = holder.id;
    }

    const targetBatch = String(row.batch_number ?? "").trim() || null;
    const keepUpdated = await prisma.beneficiary.updateMany({
      where: { id: keepId, deleted_at: null },
      data: {
        card_number: targetCardOfficial,
        batch_number: targetBatch,
        completed_via: "truth_registry_migration",
      },
    });
    if (Number(keepUpdated.count ?? 0) === 0) {
      skippedNumberingConflict += 1;
      handledRows.add(row.id);
      continue;
    }

    resolvedNumberingCount += 1;

    for (const candidate of existingForPerson) {
      if (candidate.id === keepId) continue;
      const mergeResult = await mergeBeneficiaryIntoTargetCard({
        sourceBeneficiaryId: candidate.id,
        keepBeneficiaryId: keepId,
        targetCardOfficial,
        targetBatch,
      });
      if ("error" in mergeResult && mergeResult.error) {
        skippedNumberingConflict += 1;
      } else {
        mergedCount += 1;
      }
    }

    handledRows.add(row.id);
  }

  const remainingRows = dedupedToCreate.filter((row) => !handledRows.has(row.id));

  const candidateCardUppers = Array.from(
    new Set(
      remainingRows
        .map((r) => String(r.card_number ?? "").trim().toUpperCase())
        .filter((x) => x.length > 0),
    ),
  );

  const softDeletedByCard = candidateCardUppers.length > 0
    ? await prisma.$queryRaw<{ id: string; card_upper: string }[]>`
        SELECT
          id,
          UPPER(BTRIM(card_number)) AS card_upper
        FROM "Beneficiary"
        WHERE deleted_at IS NOT NULL
          AND UPPER(BTRIM(card_number)) = ANY(${candidateCardUppers}::text[])
      `
    : [];

  const softDeletedCardMap = new Map<string, string>();
  for (const row of softDeletedByCard) {
    if (!softDeletedCardMap.has(row.card_upper)) softDeletedCardMap.set(row.card_upper, row.id);
  }

  const rowsToRestore: Array<{ beneficiaryId: string; row: (typeof remainingRows)[number] }> = [];
  const rowsToInsert: Array<(typeof remainingRows)[number]> = [];
  for (const row of remainingRows) {
    const cardUpper = String(row.card_number ?? "").trim().toUpperCase();
    const deletedId = softDeletedCardMap.get(cardUpper);
    if (deletedId) rowsToRestore.push({ beneficiaryId: deletedId, row });
    else rowsToInsert.push(row);
  }

  let restoredCount = 0;
  let createdCount = 0;
  let skippedByUniqueConflicts = 0;

  for (const item of rowsToRestore) {
    try {
      await prisma.beneficiary.update({
        where: { id: item.beneficiaryId },
        data: {
          deleted_at: null,
          card_number: String(item.row.card_number ?? "").trim(),
          name: safeNameForMigration(item.row.beneficiary_name, String(item.row.card_number ?? "").trim()),
          birth_date: item.row.birth_date ?? null,
          birth_date_synced_from_truth: item.row.birth_date ? true : false,
          city: item.row.city ?? null,
          batch_number: item.row.batch_number ?? null,
          completed_via: "truth_registry_migration",
        },
      });
      restoredCount += 1;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2002") {
        skippedByUniqueConflicts += 1;
        continue;
      }
      throw err;
    }
  }

  const now = new Date();
  for (const row of rowsToInsert) {
    try {
      await prisma.beneficiary.create({
        data: {
          card_number: String(row.card_number).trim(),
          name: safeNameForMigration(row.beneficiary_name, String(row.card_number).trim()),
          birth_date: row.birth_date ?? null,
          birth_date_synced_from_truth: row.birth_date ? true : false,
          city: row.city ?? null,
          batch_number: row.batch_number ?? null,
          completed_via: "truth_registry_migration",
          created_at: now,
        },
      });
      createdCount += 1;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2002") {
        skippedByUniqueConflicts += 1;
        continue;
      }
      throw err;
    }
  }

  return {
    createdCount,
    restoredCount,
    skippedExisting:
      existingRowsCount +
      skippedByPersonExisting +
      keptSystemNumbering +
      skippedByPersonDuplicateInBatch +
      skippedByUniqueConflicts,
    skippedInvalid: invalidRowsCount,
    mergedCount,
    resolvedNumberingCount,
    keptSystemNumbering,
    skippedNumberingConflict,
    numberingConflictMode,
  };
}

export async function migrateTruthRowsToSystemAction(data: {
  ids: string[];
  numberingConflictMode?: "skip" | "merge_use_truth" | "keep_system";
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const ids = Array.isArray(data.ids) ? Array.from(new Set(data.ids.filter(Boolean))) : [];
  if (ids.length === 0) return { error: "لم يتم تحديد أي سجل للترحيل" };

  try {
    const rows = await prisma.cardIssuanceRegistryAll.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        card_number: true,
        canonical_card: true,
        beneficiary_name: true,
        birth_date: true,
        city: true,
        batch_number: true,
      },
    });

    if (rows.length === 0) {
      return { error: "السجلات المحددة ليست من جدول الحقيقة أو غير موجودة" };
    }

    const result = await migrateRegistryRowsToSystem(rows, {
      numberingConflictMode: data.numberingConflictMode,
    });

    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");

    return {
      success: true,
      createdCount: result.createdCount,
      restoredCount: result.restoredCount ?? 0,
      skippedExisting: result.skippedExisting,
      skippedInvalid: result.skippedInvalid,
      mergedCount: result.mergedCount ?? 0,
      resolvedNumberingCount: result.resolvedNumberingCount ?? 0,
      keptSystemNumbering: result.keptSystemNumbering ?? 0,
      skippedNumberingConflict: result.skippedNumberingConflict ?? 0,
      numberingConflictMode: result.numberingConflictMode,
    };
  } catch (error) {
    console.error("Migrate selected truth rows to system error:", error);
    return { error: "حدث خطأ أثناء ترحيل السجلات المحددة للمنظومة" };
  }
}

export async function migrateFilteredTruthRowsToSystemAction(filters: TruthToSystemFilter) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  try {
    const query = String(filters.query ?? "").trim();
    const cityFilter = String(filters.city ?? "").trim();
    const batchFilter = String(filters.batch ?? "").trim();
    const isNoBatchFilter = batchFilter === "__NO_BATCH__";
    const onlyMultiBatch = filters.multi === true;
    const onlyMissingInSystem = filters.not_in_system === true;
    const useSystemPrimaryRows = filters.system_primary === true && !onlyMissingInSystem;
    const onlyInSystemNotInRegistry = filters.in_system_not_in_registry === true;
    const onlyFamilyNumberingMismatch = filters.family_numbering_mismatch === true;
    const onlyMultiPersonCards = filters.multi_person_cards === true;
    const onlyLegacyNoBatch = filters.legacy_no_batch === true;
    const onlyLegacyHasBatch = filters.legacy_has_batch === true;
    const numberingConflictMode = normalizeMigrationNumberingConflictMode(
      filters.numbering_conflict_mode,
    );
    const sort = String(filters.sort ?? "").trim();

    if (useSystemPrimaryRows || onlyInSystemNotInRegistry || onlyLegacyNoBatch || onlyFamilyNumberingMismatch) {
      return { error: "الترحيل يعمل فقط مع نتائج جدول الحقيقة وليس نتائج المنظومة" };
    }

    let orderSql = Prisma.sql`ORDER BY f.city ASC, f.batch_number ASC NULLS LAST, f.card_number ASC`;
    if (sort === "birth_asc") {
      orderSql = Prisma.sql`ORDER BY f.birth_date ASC NULLS LAST, f.city ASC, f.batch_number ASC NULLS LAST, f.card_number ASC`;
    } else if (sort === "birth_desc") {
      orderSql = Prisma.sql`ORDER BY f.birth_date DESC NULLS LAST, f.city ASC, f.batch_number ASC NULLS LAST, f.card_number ASC`;
    }

    const rows = await prisma.$queryRaw<RegistryAllForMigration[]>`
      WITH filtered AS (
        SELECT
          id,
          card_number,
          canonical_card,
          beneficiary_name,
          birth_date,
          city,
          batch_number
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
            AND (
              birth_date IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM "Beneficiary" b2
                WHERE b2.deleted_at IS NULL
                  AND b2.birth_date IS NOT NULL
                  AND b2.birth_date::date = birth_date::date
                  AND UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\s+', ' ', 'g')) =
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g'))
                )
              )
          )
          AND (
            ${onlyMultiPersonCards} = false
            OR (
              birth_date IS NOT NULL
              AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || birth_date::date::text IN (
                SELECT
                  UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || t2.birth_date::date::text
                FROM "CardIssuanceRegistryAll" t2
                WHERE t2.birth_date IS NOT NULL
                GROUP BY
                  UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')),
                  t2.birth_date::date
                HAVING COUNT(DISTINCT COALESCE(t2.canonical_card, REGEXP_REPLACE(t2.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'))) > 1
              )
            )
          )
          AND (
            ${onlyLegacyHasBatch} = false
            OR (
              (batch_number IS NOT NULL AND BTRIM(batch_number) <> '')
              AND REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') IN (
                SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                FROM "Beneficiary"
                WHERE deleted_at IS NULL AND is_legacy_card = true
              )
            )
          )
          AND (
            ${onlyLegacyNoBatch} = false
            OR (
              (batch_number IS NULL OR BTRIM(batch_number) = '')
              AND REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') IN (
                SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                FROM "Beneficiary"
                WHERE deleted_at IS NULL AND is_legacy_card = true
              )
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
      SELECT
        f.id,
        f.card_number,
        f.canonical_card,
        f.beneficiary_name,
        f.birth_date,
        f.city,
        f.batch_number
      FROM filtered f
      JOIN "CardIssuanceRegistryAll" a ON a.id = f.id
      JOIN stats s ON s.card_number_upper = a.card_number_upper
      WHERE (${onlyMultiBatch} = false OR s.batches_count > 1)
      ${orderSql}
    `;

    if (rows.length === 0) {
      return { success: true, createdCount: 0, skippedExisting: 0, skippedInvalid: 0 };
    }

    const result = await migrateRegistryRowsToSystem(rows, {
      numberingConflictMode,
    });

    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");

    return {
      success: true,
      createdCount: result.createdCount,
      restoredCount: result.restoredCount ?? 0,
      skippedExisting: result.skippedExisting,
      skippedInvalid: result.skippedInvalid,
      mergedCount: result.mergedCount ?? 0,
      resolvedNumberingCount: result.resolvedNumberingCount ?? 0,
      keptSystemNumbering: result.keptSystemNumbering ?? 0,
      skippedNumberingConflict: result.skippedNumberingConflict ?? 0,
      numberingConflictMode: result.numberingConflictMode,
      totalMatched: rows.length,
    };
  } catch (error) {
    console.error("Migrate filtered truth rows to system error:", error);
    return { error: "حدث خطأ أثناء ترحيل نتائج الفلتر للمنظومة" };
  }
}

export async function resolveDemographicMismatchAction(data: {
  truthRowId: string;
  resolveMode: "use_truth" | "keep_system";
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  try {
    const truthRow = await prisma.cardIssuanceRegistryAll.findUnique({
      where: { id: data.truthRowId },
    });
    if (!truthRow) return { error: "سجل جدول الحقيقة غير موجود" };

    const canonical = truthRow.canonical_card;

    if (data.resolveMode === "use_truth") {
      // Find matching beneficiaries by canonical card
      const systemBeneficiaries = await prisma.beneficiary.findMany({
        where: {
          deleted_at: null,
          card_number: { startsWith: "WAB2025", mode: "insensitive" }
        }
      });

      // Match in memory using canonicalizeCardNumber
      const targetBeneficiaries = systemBeneficiaries.filter(
        (b) => canonicalizeCardNumber(b.card_number) === canonical
      );

      if (targetBeneficiaries.length === 0) {
        return { error: "لم يتم العثور على مستفيد مطابق في المنظومة لتحديثه" };
      }

      // Update all matching beneficiaries to have the name and birth date of the truth registry
      for (const b of targetBeneficiaries) {
        await prisma.beneficiary.update({
          where: { id: b.id },
          data: {
            name: truthRow.beneficiary_name || b.name,
            birth_date: truthRow.birth_date,
            birth_date_synced_from_truth: truthRow.birth_date ? true : false,
            completed_via: "truth_registry_demographic_resolution"
          }
        });
      }

      revalidatePath("/admin/truth-registry");
      revalidatePath("/beneficiaries");
      return { success: true, updatedCount: targetBeneficiaries.length };
    }

    return { success: true, message: "تم الاحتفاظ ببيانات المنظومة" };
  } catch (e) {
    console.error(e);
    return { error: "حدث خطأ أثناء حل تضارب البيانات الديموغرافية" };
  }
}

export async function softDeleteBeneficiaryRowsAction(ids: string[]) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  const idsArray = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (idsArray.length === 0) return { error: "لم يتم تحديد سجلات للحذف" };

  try {
    // 1. Fetch matching active beneficiaries
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: idsArray }, deleted_at: null },
      select: {
        id: true,
        name: true,
        card_number: true,
        _count: { select: { transactions: { where: { is_cancelled: false } } } }
      }
    });

    if (beneficiaries.length === 0) {
      return { error: "السجلات المحددة ليست من جدول المنظومة أو تم حذفها مسبقاً." };
    }

    // 2. Validate transactions
    const hasTransactions = beneficiaries.filter(b => b._count.transactions > 0);
    if (hasTransactions.length > 0) {
      const names = hasTransactions.map(b => `${b.name} (${b.card_number})`).join(", ");
      return { error: `لا يمكن حذف المستفيدين التالية أسماؤهم لوجود حركات مالية مسجلة لديهم: ${names}` };
    }

    const finalIds = beneficiaries.map(b => b.id);

    // 3. Soft delete in transaction
    await prisma.$transaction(async (tx) => {
      await tx.beneficiary.updateMany({
        where: { id: { in: finalIds } },
        data: { deleted_at: new Date() }
      });

      for (const b of beneficiaries) {
        await tx.auditLog.create({
          data: {
            facility_id: session.id,
            user: session.username,
            action: "DELETE_BENEFICIARY",
            metadata: { beneficiary_name: b.name, beneficiary_id: b.id, card_number: b.card_number },
          }
        });
      }
    });

    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");
    return { success: true, deletedCount: finalIds.length };
  } catch (error) {
    console.error("Soft delete beneficiary rows error:", error);
    return { error: "حدث خطأ أثناء حذف السجلات من المنظومة" };
  }
}

export async function softDeleteFilteredBeneficiariesAction(filters: {
  query?: string;
  city?: string;
  batch?: string;
  system_primary?: boolean;
  multi?: boolean;
  not_in_system?: boolean;
  in_system_not_in_registry?: boolean;
  similar_only?: boolean;
  similar_numeric?: boolean;
  similar_name_birth?: boolean;
  similar_family_suffix?: boolean;
  family_numbering_mismatch?: boolean;
  multi_person_cards?: boolean;
  legacy_no_batch?: boolean;
  legacy_has_batch?: boolean;
  demographic_mismatch?: boolean;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) return { error: "غير مصرح" };

  try {
    const query = (filters.query ?? "").trim();
    const onlyInSystemNotInRegistry = filters.in_system_not_in_registry === true;
    const onlyLegacyNoBatch = filters.legacy_no_batch === true;
    const onlyLegacyHasBatch = filters.legacy_has_batch === true;
    const onlyFamilyNumberingMismatch = filters.family_numbering_mismatch === true;

    // Safety: ensure it is a system-sourced filter
    const isSystemSourced = onlyInSystemNotInRegistry || onlyLegacyNoBatch || onlyFamilyNumberingMismatch;
    if (!isSystemSourced) {
      return { error: "هذا الإجراء مخصص لحذف سجلات المنظومة فقط بناءً على تصفية متوافقة." };
    }

    // 1. Fetch matching active beneficiaries with raw query
    const matchingBeneficiaries = await prisma.$queryRaw<Array<{ id: string, name: string, card_number: string, transactions_count: number }>>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        (
          SELECT COUNT(*)::int
          FROM "Transaction" t
          WHERE t.beneficiary_id = b.id
            AND t.is_cancelled = false
        ) AS transactions_count
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND (
          ${query} = ''
          OR b.card_number ILIKE ${`%${query}%`}
          OR b.name ILIKE ${`%${query}%`}
        )
        AND (
          ${onlyInSystemNotInRegistry} = false
          OR (
            NOT EXISTS (
              SELECT 1
              FROM "CardIssuanceRegistryAll" __t_insys
              WHERE __t_insys.card_number_upper IS NOT NULL
                AND REGEXP_REPLACE(__t_insys.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                    REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
            )
            AND (
              b.birth_date IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM "CardIssuanceRegistryAll" t2
                WHERE t2.birth_date IS NOT NULL
                  AND t2.birth_date::date = b.birth_date::date
                  AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                      UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g'))
              )
            )
          )
        )
        AND (
          ${onlyLegacyNoBatch} = false
          OR (
            b.is_legacy_card = true
            AND (b.batch_number IS NULL OR BTRIM(b.batch_number) = '')
          )
        )
        AND (
          ${onlyLegacyHasBatch} = false
          OR (
            b.is_legacy_card = true
            AND b.batch_number IS NOT NULL AND BTRIM(b.batch_number) <> ''
          )
        )
        AND (
          ${onlyFamilyNumberingMismatch} = false
          OR EXISTS (
            SELECT 1
            FROM "CardIssuanceRegistryAll" t
            WHERE UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                  UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g'))
              AND (
                (b.birth_date IS NOT NULL AND t.birth_date IS NOT NULL AND t.birth_date::date = b.birth_date::date)
                OR
                (b.birth_date IS NULL)
              )
              AND COALESCE(
                SUBSTRING(t.canonical_card FROM '^(WAB2025[0-9]+)'),
                t.canonical_card
              ) = COALESCE(
                SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
                REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
              )
              AND t.canonical_card <>
                  REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
          )
        )
    `;

    if (matchingBeneficiaries.length === 0) {
      return { error: "لا توجد سجلات مطابقة للتصفية في المنظومة أو تم حذفها مسبقاً." };
    }

    // 2. Validate transactions
    const hasTransactions = matchingBeneficiaries.filter(b => b.transactions_count > 0);
    if (hasTransactions.length > 0) {
      const names = hasTransactions.slice(0, 5).map(b => `${b.name} (${b.card_number})`).join(", ");
      const extraCount = hasTransactions.length - 5;
      const extraMsg = extraCount > 0 ? ` ... و ${extraCount} مستفيدين آخرين` : "";
      return { error: `لا يمكن حذف المستفيدين لوجود حركات مالية مسجلة لديهم. المستفيدون المتأثرون: ${names}${extraMsg}` };
    }

    const finalIds = matchingBeneficiaries.map(b => b.id);

    // 3. Soft delete in transaction
    await prisma.$transaction(async (tx) => {
      await tx.beneficiary.updateMany({
        where: { id: { in: finalIds } },
        data: { deleted_at: new Date() }
      });

      // Write bulk audit logs (up to a limit to prevent query explosion, or just a single bulk action log)
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_DELETE_BENEFICIARIES",
          metadata: {
            deleted_count: finalIds.length,
            filter_query: query,
            filters_used: { onlyInSystemNotInRegistry, onlyLegacyNoBatch, onlyFamilyNumberingMismatch }
          }
        }
      });
    });

    revalidatePath("/admin/truth-registry");
    revalidatePath("/beneficiaries");
    return { success: true, deletedCount: finalIds.length };
  } catch (error) {
    console.error("Soft delete filtered beneficiaries error:", error);
    return { error: "حدث خطأ أثناء حذف السجلات المفلترة من المنظومة" };
  }
}


