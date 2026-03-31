"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { getArabicSearchTerms } from "@/lib/search";
import { updateBeneficiarySchema, createBeneficiarySchema } from "@/lib/validation";
import { INITIAL_BALANCE } from "@/lib/config";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

function normalizeCardNumber(value: string) {
  return value.trim().toUpperCase();
}

function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseBirthDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

export async function getBeneficiaryByCard(card_number: string) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح" };
  }

  const normalizedCardNumber = normalizeCardNumber(card_number);

  if (!normalizedCardNumber || normalizedCardNumber.length > 50) {
    return { error: "رقم البطاقة غير صالح" };
  }

  const rateLimitError = await checkRateLimit(`search:${session.id}`, "search");
  if (rateLimitError) return { error: rateLimitError };

  try {
    const beneficiary = await prisma.beneficiary.findFirst({
      where: {
        card_number: { equals: normalizedCardNumber, mode: "insensitive" },
        deleted_at: null,
      },
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
  } catch (error: unknown) {
    logger.error("Get beneficiary by card error", { error: String(error) });
    return { error: "تعذر جلب بيانات المستفيد" };
  }
}

export async function searchBeneficiaries(query: string) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح", items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };
  }

  const rateLimitError = await checkRateLimit(`search:${session.id}`, "search");
  if (rateLimitError) return { error: rateLimitError, items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };

  const q = query.trim();
  if (q.length < 2 || q.length > 100) {
    return { items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };
  }

  try {
    // pg_trgm: ILIKE مع GIN index للسرعة + word_similarity للترتيب حسب الأولوية
    const likePattern = `%${q}%`;
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
      remaining_balance: number;
      status: string;
    }>>`
      SELECT
        id,
        name,
        card_number,
        remaining_balance::float8,
        status
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND (
          name ILIKE ${likePattern}
          OR card_number ILIKE ${likePattern}
        )
      ORDER BY GREATEST(
        word_similarity(${q}, name),
        word_similarity(${q}, card_number)
      ) DESC
      LIMIT 20
    `;

    return { items: rows };
  } catch (error: unknown) {
    logger.error("Search beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ البحث", items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };
  }
}

export async function createBeneficiary(data: {
  name: string;
  card_number: string;
  birth_date?: string;
}) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, 'add_beneficiary')) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const parsed = createBeneficiarySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const payload = parsed.data;
  const normalizedCardNumber = normalizeCardNumber(payload.card_number);
  const normalizedName = normalizePersonName(payload.name);
  const parsedBirthDate = parseBirthDate(payload.birth_date);

  try {
    await prisma.$transaction(async (tx) => {
      // قفل استشاري لمنع الإنشاء المتزامن بنفس رقم البطاقة
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedCardNumber}))`;

      const existing = await tx.beneficiary.findFirst({
        where: {
          card_number: { equals: normalizedCardNumber, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (existing) {
        throw new Error("CARD_EXISTS");
      }

      if (parsedBirthDate) {
        const existingPerson = await tx.beneficiary.findFirst({
          where: {
            deleted_at: null,
            name: { equals: normalizedName, mode: "insensitive" },
            birth_date: parsedBirthDate,
          },
          select: { id: true, card_number: true },
        });

        if (existingPerson) {
          throw new Error("PERSON_EXISTS");
        }
      }

      const beneficiary = await tx.beneficiary.create({
        data: {
          name: normalizedName,
          card_number: normalizedCardNumber,
          birth_date: parsedBirthDate,
          total_balance: INITIAL_BALANCE,
          remaining_balance: INITIAL_BALANCE,
          status: "ACTIVE",
        },
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "CREATE_BENEFICIARY",
          metadata: {
            beneficiary_id: beneficiary.id,
            card_number: normalizedCardNumber,
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidatePath("/deduct");
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "CARD_EXISTS") return { error: "رقم البطاقة مستخدم مسبقاً ولا يمكن استخدامه لشخص آخر" };
      if (error.message === "PERSON_EXISTS") return { error: "هذا المستفيد (نفس الاسم وتاريخ الميلاد) مسجل مسبقاً برقم بطاقة آخر" };
    }
    logger.error("Create beneficiary error", { error: String(error) });
    return { error: "تعذر إنشاء المستفيد" };
  }
}

export async function updateBeneficiary(data: {
  id: string;
  name: string;
  card_number: string;
  birth_date?: string;
  status: "ACTIVE" | "FINISHED" | "SUSPENDED";
}) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin && !session.is_manager) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const parsed = updateBeneficiarySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const payload = parsed.data;
  const normalizedCardNumber = normalizeCardNumber(payload.card_number);
  const normalizedName = normalizePersonName(payload.name);
  const parsedBirthDate = parseBirthDate(payload.birth_date);

  try {
    await prisma.$transaction(async (tx) => {
      // قفل استشاري لمنع التحديث المتزامن بنفس رقم البطاقة
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedCardNumber}))`;

      const existing = await tx.beneficiary.findFirst({
        where: {
          card_number: { equals: normalizedCardNumber, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (existing && existing.id !== payload.id) {
        throw new Error("CARD_EXISTS");
      }

      if (parsedBirthDate) {
        const existingPerson = await tx.beneficiary.findFirst({
          where: {
            id: { not: payload.id },
            deleted_at: null,
            name: { equals: normalizedName, mode: "insensitive" },
            birth_date: parsedBirthDate,
          },
          select: { id: true, card_number: true },
        });

        if (existingPerson) {
          throw new Error("PERSON_EXISTS");
        }
      }

      await tx.beneficiary.update({
        where: { id: payload.id },
        data: {
          name: normalizedName,
          card_number: normalizedCardNumber,
          birth_date: parsedBirthDate,
          status: payload.status,
        },
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "UPDATE_BENEFICIARY",
          metadata: {
            beneficiary_id: payload.id,
            card_number: normalizedCardNumber,
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidatePath("/deduct");
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "CARD_EXISTS") return { error: "رقم البطاقة مستخدم مسبقاً ولا يمكن استخدامه لشخص آخر" };
      if (error.message === "PERSON_EXISTS") return { error: "لا يمكن إعطاء بطاقتين لنفس المستفيد (تطابق الاسم وتاريخ الميلاد)" };
    }
    logger.error("Update beneficiary error", { error: String(error) });
    return { error: "تعذر تحديث بيانات المستفيد" };
  }
}

export async function deleteBeneficiary(id: string) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, 'delete_beneficiary')) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
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
        metadata: { beneficiary_name: beneficiary.name, beneficiary_id: id, card_number: beneficiary.card_number },
      },
    });

    revalidatePath("/beneficiaries");
    return { success: true };
  } catch (error: unknown) {
    logger.error("Delete beneficiary error", { error: String(error) });
    return { error: "تعذر حذف المستفيد" };
  }
}

export async function restoreBeneficiary(id: string) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, 'delete_beneficiary')) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id },
      select: { id: true, card_number: true, name: true, birth_date: true, deleted_at: true },
    });

    if (!beneficiary || beneficiary.deleted_at === null) {
      return { error: "المستفيد غير موجود أو ليس محذوفاً" };
    }

    // تحقق من عدم وجود مستفيد نشط بنفس رقم البطاقة
    const normalizedCardNumber = normalizeCardNumber(beneficiary.card_number);
    const duplicate = await prisma.beneficiary.findFirst({
      where: {
        id: { not: id },
        card_number: { equals: normalizedCardNumber, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      return { error: "رقم البطاقة مستخدم مسبقاً ولا يمكن ربطه بشخصين" };
    }

    if (beneficiary.birth_date) {
      const duplicatePerson = await prisma.beneficiary.findFirst({
        where: {
          id: { not: id },
          deleted_at: null,
          name: { equals: normalizePersonName(beneficiary.name), mode: "insensitive" },
          birth_date: beneficiary.birth_date,
        },
        select: { id: true },
      });

      if (duplicatePerson) {
        return { error: "لا يمكن استرجاع السجل لأن نفس المستفيد (الاسم وتاريخ الميلاد) موجود برقم بطاقة آخر" };
      }
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
        metadata: { beneficiary_name: beneficiary.name, beneficiary_id: id, card_number: beneficiary.card_number },
      },
    });

    revalidatePath("/beneficiaries");
    return { success: true };
  } catch (error: unknown) {
    logger.error("Restore beneficiary error", { error: String(error) });
    return { error: "تعذر استرجاع المستفيد" };
  }
}

export async function permanentDeleteBeneficiary(id: string) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, 'delete_beneficiary')) {
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
          metadata: { beneficiary_name: beneficiary.name, beneficiary_id: id, card_number: beneficiary.card_number },
        },
      });
      await tx.beneficiary.delete({ where: { id } });
    });

    revalidatePath("/beneficiaries");
    return { success: true };
  } catch (error: unknown) {
    logger.error("Permanent delete beneficiary error", { error: String(error) });
    return { error: "تعذر الحذف النهائي للمستفيد" };
  }
}
