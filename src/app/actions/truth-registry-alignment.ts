"use server";

import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import { canonicalizeCardNumber } from "@/lib/normalize";

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
    // 1. جلب كل المستفيدين النشطين الذين تبدأ بطاقاتهم بـ WAB2025
    const beneficiaries = await prisma.beneficiary.findMany({
      where: {
        deleted_at: null,
        card_number: { startsWith: "WAB2025", mode: "insensitive" }
      },
      select: {
        id: true,
        name: true,
        card_number: true
      }
    });

    // 2. جلب كل سجلات جدول الحقيقة
    const registry = await prisma.cardIssuanceRegistry.findMany({
      select: {
        card_number: true,
        card_number_upper: true,
        canonical_card: true,
        city: true,
        batch_number: true
      }
    });

    // 3. مطابقة السجلات في الذاكرة لتفادي الـ Join البطيء جداً في دالة RegExp بقاعدة البيانات
    const beneficiaryMap = new Map<string, typeof beneficiaries[0]>();
    for (const b of beneficiaries) {
      const canonical = canonicalizeCardNumber(b.card_number);
      beneficiaryMap.set(canonical, b);
    }

    const discrepancies: DiscrepancyRow[] = [];
    for (const r of registry) {
      const b = beneficiaryMap.get(r.canonical_card);
      if (b) {
        const bCardUpper = b.card_number.trim().toUpperCase();
        const rCardUpper = r.card_number_upper;
        if (bCardUpper !== rCardUpper) {
          discrepancies.push({
            beneficiary_id: b.id,
            beneficiary_name: b.name,
            current_card_number: b.card_number,
            registry_card_number: r.card_number,
            city: r.city,
            batch_number: r.batch_number
          });
        }
      }
    }

    // ترتيب النتيجة حسب الاسم
    discrepancies.sort((a, b) => a.beneficiary_name.localeCompare(b.beneficiary_name, "ar"));
    const limitedDiscrepancies = discrepancies.slice(0, 200);

    return { success: true, discrepancies: limitedDiscrepancies };
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
    // 1. جلب كل المستفيدين النشطين
    const beneficiaries = await prisma.beneficiary.findMany({
      where: {
        deleted_at: null,
        card_number: { startsWith: "WAB2025", mode: "insensitive" }
      },
      select: {
        id: true,
        card_number: true
      }
    });

    // 2. جلب كل سجلات جدول الحقيقة
    const registry = await prisma.cardIssuanceRegistry.findMany({
      select: {
        card_number: true,
        card_number_upper: true,
        canonical_card: true
      }
    });

    // 3. مطابقة السجلات في الذاكرة لتفادي الـ Join البطيء جداً
    const beneficiaryMap = new Map<string, typeof beneficiaries[0]>();
    for (const b of beneficiaries) {
      const canonical = canonicalizeCardNumber(b.card_number);
      beneficiaryMap.set(canonical, b);
    }

    const discrepancies: { beneficiary_id: string; current_card_number: string; registry_card_number: string }[] = [];
    for (const r of registry) {
      const b = beneficiaryMap.get(r.canonical_card);
      if (b) {
        const bCardUpper = b.card_number.trim().toUpperCase();
        const rCardUpper = r.card_number_upper;
        if (bCardUpper !== rCardUpper) {
          discrepancies.push({
            beneficiary_id: b.id,
            current_card_number: b.card_number,
            registry_card_number: r.card_number
          });
        }
      }
    }

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
