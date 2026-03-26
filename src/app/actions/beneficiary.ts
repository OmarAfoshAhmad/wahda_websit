"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { updateBeneficiarySchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

export async function getBeneficiaryByCard(card_number: string) {
  const session = await getSession();
  if (!session) {
    return { error: "غير مصرح" };
  }

  if (!card_number || card_number.length > 50) {
    return { error: "رقم البطاقة غير صالح" };
  }

  const rateLimitError = checkRateLimit(`search:${session.id}`, "search");
  if (rateLimitError) return { error: rateLimitError };

  try {
    const beneficiary = await prisma.beneficiary.findFirst({
      where: { card_number, deleted_at: null },
    });

    if (!beneficiary) {
      return { error: "المستفيد غير موجود" };
    }

    return {
      beneficiary: {
        ...beneficiary,
        total_balance: Number(beneficiary.total_balance),
        remaining_balance: Number(beneficiary.remaining_balance),
      },
    };
  } catch {
    return { error: "تعذر جلب بيانات المستفيد" };
  }
}

export async function searchBeneficiaries(query: string) {
  const session = await getSession();
  if (!session) {
    return { error: "غير مصرح", items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };
  }

  const rateLimitError = checkRateLimit(`search:${session.id}`, "search");
  if (rateLimitError) return { error: rateLimitError, items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };

  const q = query.trim();
  if (q.length < 2 || q.length > 100) {
    return { items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };
  }

  try {
    const items = await prisma.beneficiary.findMany({
      where: {
        deleted_at: null,
        OR: [
          { card_number: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        card_number: true,
        remaining_balance: true,
        status: true,
      },
      orderBy: [{ name: "asc" }],
      take: 8,
    });

    return {
      items: items.map((item) => ({
        ...item,
        remaining_balance: Number(item.remaining_balance),
      })),
    };
  } catch {
    return { error: "تعذر تنفيذ البحث", items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };
  }
}

export async function updateBeneficiary(data: {
  id: string;
  name: string;
  card_number: string;
  birth_date?: string;
  status: "ACTIVE" | "FINISHED";
}) {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const parsed = updateBeneficiarySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const payload = parsed.data;

  try {
    // البحث فقط بين السجلات غير المحذوفة لتجنب التعارض مع الحذف الناعم
    const existing = await prisma.beneficiary.findFirst({
      where: { card_number: payload.card_number, deleted_at: null },
      select: { id: true },
    });

    if (existing && existing.id !== payload.id) {
      return { error: "رقم البطاقة مستخدم لمستفيد آخر" };
    }

    await prisma.beneficiary.update({
      where: { id: payload.id },
      data: {
        name: payload.name,
        card_number: payload.card_number,
        birth_date: (() => {
          if (!payload.birth_date) return null;
          const d = new Date(payload.birth_date);
          if (isNaN(d.getTime())) return null;
          return d;
        })(),
        status: payload.status,
      },
    });

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "UPDATE_BENEFICIARY",
        metadata: {
          beneficiary_id: payload.id,
          card_number: payload.card_number,
        },
      },
    });

    revalidatePath("/beneficiaries");
    revalidatePath("/deduct");
    return { success: true };
  } catch {
    return { error: "تعذر تحديث بيانات المستفيد" };
  }
}

export async function deleteBeneficiary(id: string) {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id },
      select: {
        id: true,
        card_number: true,
        deleted_at: true,
        _count: { select: { transactions: true } },
      },
    });

    if (!beneficiary || beneficiary.deleted_at !== null) {
      return { error: "المستفيد غير موجود" };
    }

    // منع الحذف إذا كان للمستفيد حركات مالية مسجلة
    if (beneficiary._count.transactions > 0) {
      return { error: "لا يمكن حذف مستفيد لديه حركات مالية مسجلة" };
    }

    await prisma.beneficiary.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "DELETE_BENEFICIARY",
        metadata: { beneficiary_id: id, card_number: beneficiary.card_number },
      },
    });

    revalidatePath("/beneficiaries");
    return { success: true };
  } catch {
    return { error: "تعذر حذف المستفيد" };
  }
}

export async function restoreBeneficiary(id: string) {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id },
      select: { id: true, card_number: true, name: true, deleted_at: true },
    });

    if (!beneficiary || beneficiary.deleted_at === null) {
      return { error: "المستفيد غير موجود أو ليس محذوفاً" };
    }

    // تحقق من عدم وجود مستفيد نشط بنفس رقم البطاقة
    const duplicate = await prisma.beneficiary.findFirst({
      where: { card_number: beneficiary.card_number, deleted_at: null },
      select: { id: true },
    });
    if (duplicate) {
      return { error: "يوجد مستفيد نشط بنفس رقم البطاقة، لا يمكن الاسترجاع" };
    }

    await prisma.beneficiary.update({
      where: { id },
      data: { deleted_at: null },
    });

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "RESTORE_BENEFICIARY",
        metadata: { beneficiary_id: id, card_number: beneficiary.card_number },
      },
    });

    revalidatePath("/beneficiaries");
    return { success: true };
  } catch {
    return { error: "تعذر استرجاع المستفيد" };
  }
}

export async function permanentDeleteBeneficiary(id: string) {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id },
      select: {
        id: true,
        card_number: true,
        name: true,
        deleted_at: true,
        _count: { select: { transactions: true } },
      },
    });

    if (!beneficiary || beneficiary.deleted_at === null) {
      return { error: "المستفيد غير موجود أو لم يُحذف ناعماً بعد" };
    }

    if (beneficiary._count.transactions > 0) {
      return { error: "لا يمكن الحذف النهائي لمستفيد لديه حركات مالية" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "PERMANENT_DELETE_BENEFICIARY",
          metadata: { beneficiary_id: id, card_number: beneficiary.card_number },
        },
      });
      await tx.beneficiary.delete({ where: { id } });
    });

    revalidatePath("/beneficiaries");
    return { success: true };
  } catch {
    return { error: "تعذر الحذف النهائي للمستفيد" };
  }
}
