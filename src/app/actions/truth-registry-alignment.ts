"use server";

import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";

export type DiscrepancyRow = {
  beneficiary_id: string;
  beneficiary_name: string;
  current_card_number: string;
  registry_card_number: string;
  city: string;
  batch_number: string | null;
};

/**
 * جلب البطاقات التي تختلف كتابتها (عدد الأصفار) بين المستفيدين وجدول الحقيقة
 */
export async function getCardDiscrepanciesAction() {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح لك بالوصول" };
  }

  try {
    const discrepancies = await prisma.$queryRaw<DiscrepancyRow[]>`
      SELECT
        b.id as beneficiary_id,
        b.name as beneficiary_name,
        b.card_number as current_card_number,
        r.card_number as registry_card_number,
        r.city,
        r.batch_number
      FROM "Beneficiary" b
      JOIN "CardIssuanceRegistry" r ON
        REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
        REGEXP_REPLACE(r.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
      WHERE b.deleted_at IS NULL
        AND UPPER(BTRIM(b.card_number)) <> r.card_number_upper
      ORDER BY b.name ASC
      LIMIT 200
    `;

    return { success: true, discrepancies };
  } catch (error) {
    console.error("Failed to fetch discrepancies:", error);
    return { error: "حدث خطأ أثناء فحص تضاربات البيانات" };
  }
}

/**
 * معالجة ومواءمة رقم بطاقة مستفيد معين ليطابق جدول الحقيقة
 */
export async function alignCardNumberAction(beneficiaryId: string, targetCardNumber: string) {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح لك بالعملية" };
  }

  try {
    const targetUpper = targetCardNumber.trim().toUpperCase();

    // التحقق من عدم وجود بطاقة نشطة أخرى بنفس الرقم المستهدف لتفادي الأخطاء
    const existing = await prisma.beneficiary.findFirst({
      where: {
        card_number: { equals: targetUpper, mode: "insensitive" },
        deleted_at: null,
        id: { not: beneficiaryId }
      }
    });

    if (existing) {
      return { error: "توجد بطاقة نشطة أخرى بالفعل في المنظومة تحمل نفس الرقم المستهدف، يرجى دمج الحسابين أولاً" };
    }

    // تحديث رقم البطاقة للمستفيد بأمان تام (الحركات والتقارير لن تتأثر لأنها مرتبطة بالمعرف CUID ID)
    await prisma.beneficiary.update({
      where: { id: beneficiaryId },
      data: {
        card_number: targetUpper
      }
    });

    revalidatePath("/admin/truth-registry");
    return { success: true };
  } catch (error) {
    console.error("Alignment error:", error);
    return { error: "فشل تحديث ومواءمة رقم البطاقة" };
  }
}

/**
 * مواءمة وتوحيد كافة البطاقات المتضاربة دفعة واحدة
 */
export async function alignAllCardNumbersAction() {
  const session = await getSessionWithFreshPermissions();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح لك بالعملية" };
  }

  try {
    // جلب كافة المتضاربين
    const discrepancies = await prisma.$queryRaw<DiscrepancyRow[]>`
      SELECT
        b.id as beneficiary_id,
        b.card_number as current_card_number,
        r.card_number as registry_card_number
      FROM "Beneficiary" b
      JOIN "CardIssuanceRegistry" r ON
        REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
        REGEXP_REPLACE(r.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
      WHERE b.deleted_at IS NULL
        AND UPPER(BTRIM(b.card_number)) <> r.card_number_upper
    `;

    let successCount = 0;
    let skipCount = 0;

    for (const row of discrepancies) {
      const targetUpper = row.registry_card_number.trim().toUpperCase();

      // فحص التكرار لمنع تصادم المفتاح الفريد
      const duplicate = await prisma.beneficiary.findFirst({
        where: {
          card_number: { equals: targetUpper, mode: "insensitive" },
          deleted_at: null,
          id: { not: row.beneficiary_id }
        },
        select: { id: true }
      });

      if (duplicate) {
        skipCount++;
        continue;
      }

      await prisma.beneficiary.update({
        where: { id: row.beneficiary_id },
        data: { card_number: targetUpper }
      });
      successCount++;
    }

    revalidatePath("/admin/truth-registry");
    return { success: true, successCount, skipCount };
  } catch (error) {
    console.error("Bulk alignment error:", error);
    return { error: "فشل إجراء التوحيد الجماعي للبطاقات" };
  }
}
