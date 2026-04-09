"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { updateBeneficiarySchema, createBeneficiarySchema } from "@/lib/validation";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { getLedgerRemainingByBeneficiaryId, getLedgerRemainingByBeneficiaryIds } from "@/lib/ledger-balance";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { normalizePersonName } from "@/lib/normalize";

function normalizeCardNumber(value: string) {
  return value.trim().toUpperCase();
}

function canonicalizeCardNumber(value: string) {
  const c = normalizeCardNumber(value);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;

  const normalizedDigits = m[1].replace(/^0+/, "") || "0";
  const suffix = m[2] ?? "";
  return `WAB2025${normalizedDigits}${suffix}`;
}

function leadingZeroScoreAfterPrefix(value: string) {
  const c = normalizeCardNumber(value);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return 0;
  const z = m[1].match(/^0+/);
  return z ? z[0].length : 0;
}

// FIX #findCanonicalDuplicate: يستخدم SQL مباشرةً بدلاً من جلب كل بطاقات WAB2025 في الذاكرة.
// يعتمد على الـ unique index الموجود على UPPER(BTRIM(card_number)) في قاعدة البيانات.
async function findCanonicalDuplicate(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  inputCard: string,
  excludeId?: string,
) {
  const normalizedInput = normalizeCardNumber(inputCard);
  const canonicalInput = canonicalizeCardNumber(normalizedInput);

  // للبطاقات غير القياسية: مطابقة مباشرة
  if (!normalizedInput.startsWith("WAB2025")) {
    return tx.beneficiary.findFirst({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        card_number: { equals: normalizedInput, mode: "insensitive" },
      },
      select: { id: true, card_number: true },
    });
  }

  // FIX: استخدام SQL نظيف لتوحيد البطاقات مباشرةً في قاعدة البيانات
  // بدلاً من جلب كل بطاقات WAB2025 في الذاكرة (O(N) → O(1))
  // المنطق: WAB202500123 و WAB2025123 يُعطيان نفس الـ canonical
  if (excludeId) {
    const results = await tx.$queryRaw<Array<{ id: string; card_number: string }>>`
      SELECT id, card_number
      FROM "Beneficiary"
      WHERE card_number ILIKE 'WAB2025%'
        AND id != ${excludeId}
        AND (
          regexp_replace(
            UPPER(BTRIM(card_number)),
            E'^WAB2025(0*)([0-9])',
            'WAB2025\2'
          ) = ${canonicalInput}
          OR UPPER(BTRIM(card_number)) = ${canonicalInput}
        )
      LIMIT 1
    `;
    return results[0] ?? null;
  }

  const results = await tx.$queryRaw<Array<{ id: string; card_number: string }>>`
    SELECT id, card_number
    FROM "Beneficiary"
    WHERE card_number ILIKE 'WAB2025%'
      AND (
        regexp_replace(
          UPPER(BTRIM(card_number)),
          E'^WAB2025(0*)([0-9])',
          'WAB2025\2'
        ) = ${canonicalInput}
        OR UPPER(BTRIM(card_number)) = ${canonicalInput}
      )
    LIMIT 1
  `;

  return results[0] ?? null;
}

// normalizePersonName مستوردة من @/lib/normalize لضمان التطابق مع الاستيراد وكشف التكرارات
// (الفارق الحرج: النسخة القديمة لم تستخدم toUpperCase())

function parseBirthDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function groupIdsBySource(rows: Array<{ id: string; beneficiary_id: string }>) {
  const bySource = new Map<string, string[]>();
  for (const row of rows) {
    const arr = bySource.get(row.beneficiary_id) ?? [];
    arr.push(row.id);
    bySource.set(row.beneficiary_id, arr);
  }
  return [...bySource.entries()].map(([from_beneficiary_id, ids]) => ({ from_beneficiary_id, ids }));
}

type MergeStrategy = "ZERO_PRIORITY" | "LOWEST_BALANCE" | "HIGHEST_TRANSACTIONS";

function pickKeepByStrategy(
  matches: Array<{ id: string; card_number: string; remaining_balance: number; tx_count?: number }>,
  strategy: MergeStrategy,
  fallbackKeepId?: string,
) {
  if (matches.length === 0) return null;

  if (fallbackKeepId && matches.some((m) => m.id === fallbackKeepId)) {
    return matches.find((m) => m.id === fallbackKeepId) ?? matches[0];
  }

  if (strategy === "LOWEST_BALANCE") {
    return [...matches].sort((a, b) => Number(a.remaining_balance) - Number(b.remaining_balance))[0];
  }

  if (strategy === "HIGHEST_TRANSACTIONS") {
    return [...matches].sort((a, b) => (b.tx_count ?? 0) - (a.tx_count ?? 0))[0];
  }

  const maxZeroScore = Math.max(...matches.map((m) => leadingZeroScoreAfterPrefix(m.card_number)));
  return (
    matches.find((m) => leadingZeroScoreAfterPrefix(m.card_number) === maxZeroScore) ??
    matches[0]
  );
}

async function recalculateBeneficiaryRemainingFromTransactions(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  beneficiaryId: string,
) {
  const beneficiary = await tx.beneficiary.findUnique({
    where: { id: beneficiaryId },
    select: { id: true, total_balance: true, status: true, completed_via: true },
  });
  if (!beneficiary) return;

  const activeTransactions = await tx.transaction.aggregate({
    where: {
      beneficiary_id: beneficiaryId,
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    _sum: { amount: true },
  });

  const spent = Number(activeTransactions._sum.amount ?? 0);
  const totalBalance = Number(beneficiary.total_balance);
  const remaining = Math.max(0, totalBalance - spent);

  let nextStatus: "ACTIVE" | "SUSPENDED" | "FINISHED";
  if (beneficiary.status === "SUSPENDED") {
    nextStatus = "SUSPENDED";
  } else if (remaining <= 0) {
    nextStatus = "FINISHED";
  } else {
    nextStatus = "ACTIVE";
  }

  await tx.beneficiary.update({
    where: { id: beneficiaryId },
    data: {
      remaining_balance: remaining,
      status: nextStatus,
      completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "IMPORT") : null,
    },
  });
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

    const derivedRemaining = await getLedgerRemainingByBeneficiaryId(
      beneficiary.id,
      Number(beneficiary.total_balance)
    );

    return {
      beneficiary: {
        ...beneficiary,
        total_balance: Number(beneficiary.total_balance),
        remaining_balance: derivedRemaining,
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

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { items: [] as Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }> };

    const remainingById = await getLedgerRemainingByBeneficiaryIds(ids);

    const items = rows.map((row) => {
      return {
        ...row,
        remaining_balance: remainingById.get(row.id) ?? 0,
      };
    });

    return { items };
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
  const initialBalance = await getCurrentInitialBalance();

  try {
    await prisma.$transaction(async (tx) => {
      // قفل استشاري لمنع الإنشاء المتزامن بنفس رقم البطاقة
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedCardNumber}))`;

      const existing = await findCanonicalDuplicate(tx, normalizedCardNumber);

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
          total_balance: initialBalance,
          remaining_balance: initialBalance,
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
    revalidateTag("beneficiary-counts", "max");
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
  if (!session || !hasPermission(session, "edit_beneficiary")) {
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

      const existing = await findCanonicalDuplicate(tx, normalizedCardNumber, payload.id);

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
    revalidateTag("beneficiary-counts", "max");
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
  if (!session || !hasPermission(session, "delete_beneficiary")) {
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
    revalidateTag("beneficiary-counts", "max");
    return { success: true };
  } catch (error: unknown) {
    logger.error("Delete beneficiary error", { error: String(error) });
    return { error: "تعذر حذف المستفيد" };
  }
}

export async function restoreBeneficiary(id: string) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_recycle_bin")) {
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
    const duplicate = await findCanonicalDuplicate(prisma, normalizedCardNumber, id);
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
    revalidateTag("beneficiary-counts", "max");
    return { success: true };
  } catch (error: unknown) {
    logger.error("Restore beneficiary error", { error: String(error) });
    return { error: "تعذر استرجاع المستفيد" };
  }
}

export async function permanentDeleteBeneficiary(id: string) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_recycle_bin")) {
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
    revalidateTag("beneficiary-counts", "max");
    return { success: true };
  } catch (error: unknown) {
    logger.error("Permanent delete beneficiary error", { error: String(error) });
    return { error: "تعذر الحذف النهائي للمستفيد" };
  }
}

export async function bulkDeleteBeneficiaries(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "delete_beneficiary")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        card_number: true,
        deleted_at: true,
        _count: { select: { transactions: true } },
      },
    });

    const deletableIds = beneficiaries
      .filter((b) => b.deleted_at === null && b._count.transactions === 0)
      .map((b) => b.id);

    const skippedCount = beneficiaries.length - deletableIds.length;

    if (deletableIds.length === 0) {
      return { error: "لا توجد سجلات قابلة للحذف ضمن المحدد" };
    }

    const deletedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.beneficiary.updateMany({
        where: { id: { in: deletableIds } },
        data: { deleted_at: deletedAt },
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_DELETE_BENEFICIARY",
          metadata: {
            selected_count: ids.length,
            deleted_count: deletableIds.length,
            skipped_count: skippedCount,
            beneficiary_ids: deletableIds,
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, deletedCount: deletableIds.length, skippedCount };
  } catch (error: unknown) {
    logger.error("Bulk delete beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ الحذف الجماعي" };
  }
}

export async function bulkPermanentDeleteBeneficiaries(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_recycle_bin")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        deleted_at: true,
        _count: { select: { transactions: true } },
      },
    });

    const deletableIds = beneficiaries
      .filter((b) => b.deleted_at !== null && b._count.transactions === 0)
      .map((b) => b.id);

    const skippedCount = beneficiaries.length - deletableIds.length;

    if (deletableIds.length === 0) {
      return { error: "لا توجد سجلات قابلة للحذف النهائي ضمن المحدد" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.beneficiary.deleteMany({ where: { id: { in: deletableIds } } });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_PERMANENT_DELETE_BENEFICIARY",
          metadata: {
            selected_count: ids.length,
            deleted_count: deletableIds.length,
            skipped_count: skippedCount,
            beneficiary_ids: deletableIds,
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, deletedCount: deletableIds.length, skippedCount };
  } catch (error: unknown) {
    logger.error("Bulk permanent delete beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ الحذف النهائي الجماعي" };
  }
}

export async function bulkRenewBalance(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  try {
    const initialBalance = await getCurrentInitialBalance();

    const result = await prisma.$transaction(async (tx) => {
      // قفل الصفوف أولاً باستخدام FOR UPDATE لمنع سباق التزامن
      const beneficiaries = await tx.$queryRaw<
        Array<{ id: string; name: string; card_number: string; total_balance: number; remaining_balance: number; status: string }>
      >`
        SELECT id, name, card_number, total_balance, remaining_balance, status
        FROM "Beneficiary"
        WHERE id = ANY(${ids}::text[]) AND "deleted_at" IS NULL
        FOR UPDATE
      `;

      if (beneficiaries.length === 0) {
        throw new Error("NO_VALID_RECORDS");
      }

      const beneficiaryIds = beneficiaries.map((b) => b.id);

      // حساب الرصيد الفعلي من السجلات داخل نفس الـ transaction
      const spentRows = await tx.transaction.groupBy({
        by: ["beneficiary_id"],
        where: {
          beneficiary_id: { in: beneficiaryIds },
          is_cancelled: false,
          type: { not: "CANCELLATION" },
        },
        _sum: { amount: true },
      });
      const spentById = new Map(spentRows.map((row) => [row.beneficiary_id, Number(row._sum.amount ?? 0)]));

      const renewalDetails = beneficiaries.map((b) => {
        const total = Number(b.total_balance);
        const spent = spentById.get(b.id) ?? 0;
        const ledgerRemaining = Math.max(0, total - spent);
        const total_after = total + initialBalance;
        const remaining_after = Math.min(ledgerRemaining + initialBalance, total_after);
        return {
          id: b.id,
          name: b.name,
          card_number: b.card_number,
          total_before: total,
          total_after,
          remaining_before: ledgerRemaining,
          remaining_after,
          status_before: b.status,
        };
      });

      for (const detail of renewalDetails) {
        await tx.beneficiary.update({
          where: { id: detail.id },
          data: {
            total_balance: detail.total_after,
            remaining_balance: detail.remaining_after,
            status: "ACTIVE",
            completed_via: null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_RENEW_BALANCE",
          metadata: {
            beneficiary_count: beneficiaryIds.length,
            renewal_amount: initialBalance,
            details: renewalDetails,
          },
        },
      });

      return { renewedCount: beneficiaryIds.length };
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, renewedCount: result.renewedCount };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "NO_VALID_RECORDS") {
      return { error: "لا توجد سجلات صالحة للتجديد" };
    }
    logger.error("Bulk renew balance error", { error: String(error) });
    return { error: "تعذر تنفيذ التجديد الجماعي" };
  }
}

export async function mergeDuplicateBeneficiaries(
  keepId: string,
  options?: {
    forceKeep?: boolean;
    explicitMergeIds?: string[];
    candidateIds?: string[];
    strategy?: MergeStrategy;
  },
) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  if (!keepId) {
    return { error: "معرف السجل الأساسي غير صالح" };
  }

  try {
    const keepBeneficiary = await prisma.beneficiary.findUnique({
      where: { id: keepId },
      select: {
        id: true,
        name: true,
        card_number: true,
        remaining_balance: true,
        total_balance: true,
        status: true,
        completed_via: true,
        deleted_at: true,
      },
    });

    if (!keepBeneficiary || keepBeneficiary.deleted_at !== null) {
      return { error: "السجل الأساسي غير موجود أو محذوف" };
    }

    const cardKey = normalizeCardNumber(keepBeneficiary.card_number);
    const canonicalCardKey = canonicalizeCardNumber(cardKey);

    const candidateIds = [...new Set((options?.candidateIds ?? []).filter(Boolean))];

    const matches = candidateIds.length > 0
      ? await prisma.beneficiary.findMany({
        where: {
          deleted_at: null,
          id: { in: [...new Set([keepId, ...candidateIds])] },
        },
        select: {
          id: true,
          name: true,
          card_number: true,
          remaining_balance: true,
          total_balance: true,
          status: true,
          completed_via: true,
        },
      }).then((rows) => rows.map((r) => ({
        ...r,
        remaining_balance: Number(r.remaining_balance),
        total_balance: Number(r.total_balance),
      })))
      : await prisma.$queryRaw<Array<{
        id: string;
        name: string;
        card_number: string;
        remaining_balance: number;
        total_balance: number;
        status: "ACTIVE" | "SUSPENDED" | "FINISHED";
        completed_via: string | null;
      }>>`
          SELECT
            id,
            name,
            card_number,
            remaining_balance::float8 AS remaining_balance,
            total_balance::float8 AS total_balance,
            status::text AS status,
            completed_via
          FROM "Beneficiary"
          WHERE deleted_at IS NULL
            AND UPPER(BTRIM(card_number)) LIKE 'WAB2025%'
        `
        .then((rows) => rows.filter((row) => canonicalizeCardNumber(row.card_number) === canonicalCardKey));

    if (matches.length <= 1) {
      return { error: "لا توجد سجلات مكررة قابلة للدمج لهذا المستفيد" };
    }

    const strategy = options?.strategy ?? "ZERO_PRIORITY";
    const preferredKeep = options?.forceKeep
      ? matches.find((m) => m.id === keepId) ?? null
      : pickKeepByStrategy(
        matches.map((m) => ({
          id: m.id,
          card_number: m.card_number,
          remaining_balance: Number(m.remaining_balance),
        })),
        strategy,
        keepId,
      );

    if (!preferredKeep) {
      return { error: "تعذر تحديد السجل الأساسي للدمج" };
    }

    const chosenKeepId = preferredKeep.id;
    // FIX: preferredKeep قد لا يحتوي على 'name' (عند ZERO_PRIORITY) — نجلبه من matches
    const chosenKeepName = matches.find((m) => m.id === chosenKeepId)?.name ?? "";
    const chosenKeepCard = normalizeCardNumber(preferredKeep.card_number);
    const explicitMergeIds = (options?.explicitMergeIds ?? []).filter((id) => id && id !== chosenKeepId);
    const mergeIds = explicitMergeIds.length > 0
      ? matches.map((m) => m.id).filter((id) => explicitMergeIds.includes(id))
      : matches.map((m) => m.id).filter((id) => id !== chosenKeepId);
    if (mergeIds.length === 0) {
      return { error: "لا توجد سجلات فرعية للدمج" };
    }

    const allRows = matches;
    const mergedTotal = Math.max(...allRows.map((r) => Number(r.total_balance)));
    const mergedRemaining = Math.min(
      Math.max(...allRows.map((r) => Number(r.remaining_balance))),
      mergedTotal,
    );
    const mergedStatus = allRows.some((r) => r.status === "ACTIVE")
      ? "ACTIVE"
      : allRows.some((r) => r.status === "SUSPENDED")
        ? "SUSPENDED"
        : "FINISHED";
    const mergedCompletedVia = keepBeneficiary.completed_via ?? allRows.find((r) => r.completed_via)?.completed_via ?? null;

    let mergeAuditId = "";

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${canonicalCardKey}))`;

      const keepBefore = await tx.beneficiary.findUnique({
        where: { id: chosenKeepId },
        select: {
          id: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
          deleted_at: true,
        },
      });

      const mergedBefore = await tx.beneficiary.findMany({
        where: { id: { in: mergeIds } },
        select: {
          id: true,
          name: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
          deleted_at: true,
        },
      });

      const movedTransactionRows = await tx.transaction.findMany({
        where: { beneficiary_id: { in: mergeIds } },
        select: { id: true, beneficiary_id: true },
      });
      const movedNotificationRows = await tx.notification.findMany({
        where: { beneficiary_id: { in: mergeIds } },
        select: { id: true, beneficiary_id: true },
      });

      const movedTransactions = await tx.transaction.updateMany({
        where: { id: { in: movedTransactionRows.map((r) => r.id) } },
        data: { beneficiary_id: chosenKeepId },
      });

      const movedNotifications = await tx.notification.updateMany({
        where: { id: { in: movedNotificationRows.map((r) => r.id) } },
        data: { beneficiary_id: chosenKeepId },
      });

      await tx.beneficiary.update({
        where: { id: chosenKeepId },
        data: {
          card_number: chosenKeepCard,
          total_balance: mergedTotal,
          remaining_balance: mergedRemaining,
          status: mergedStatus,
          completed_via: mergedCompletedVia,
        },
      });

      await tx.beneficiary.updateMany({
        where: { id: { in: mergeIds } },
        data: { deleted_at: new Date() },
      });

      // إعادة حساب الرصيد الفعلي بعد نقل الحركات لضمان دقة الرصيد المعتمد.
      await recalculateBeneficiaryRemainingFromTransactions(tx, chosenKeepId);

      const keepAfter = await tx.beneficiary.findUnique({
        where: { id: chosenKeepId },
        select: { remaining_balance: true },
      });

      const existingMergeLog = await tx.$queryRaw<Array<{ id: string; metadata: unknown }>>`
        SELECT id, metadata
        FROM "AuditLog"
        WHERE action = 'MERGE_DUPLICATE_BENEFICIARY'
          AND metadata ->> 'card_number' = ${canonicalCardKey}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const previousMetadata = (existingMergeLog[0]?.metadata ?? {}) as Record<string, unknown>;
      const previousMergeCount = Number(previousMetadata.merge_count ?? 0);

      const nextMetadata = {
        card_number: canonicalCardKey,
        keep_beneficiary_id: chosenKeepId,
        keep_beneficiary_name: chosenKeepName,
        requested_keep_beneficiary_id: keepId,
        chosen_keep_card_number: chosenKeepCard,
        merged_beneficiary_ids: mergeIds,
        moved_transactions: movedTransactions.count,
        moved_notifications: movedNotifications.count,
        strategy,
        undo_available: true,
        undo_reverted_at: null,
        case_status: "MERGED_APPROVED",
        case_status_label: "تمت معالجة الدمج واعتمد",
        last_merged_at: new Date().toISOString(),
        last_merged_by: session.username,
        merge_count: previousMergeCount + 1,
        approved_remaining_balance: Number(keepAfter?.remaining_balance ?? 0),
        undo_snapshot: {
          keep_before: keepBefore
            ? {
              id: keepBefore.id,
              card_number: keepBefore.card_number,
              total_balance: Number(keepBefore.total_balance),
              remaining_balance: Number(keepBefore.remaining_balance),
              status: keepBefore.status,
              completed_via: keepBefore.completed_via,
              deleted_at: keepBefore.deleted_at ? keepBefore.deleted_at.toISOString() : null,
            }
            : null,
          merged_before: mergedBefore.map((row) => ({
            id: row.id,
            name: row.name,
            card_number: row.card_number,
            total_balance: Number(row.total_balance),
            remaining_balance: Number(row.remaining_balance),
            status: row.status,
            completed_via: row.completed_via,
            deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
          })),
          moved_transactions: groupIdsBySource(movedTransactionRows),
          moved_notifications: groupIdsBySource(movedNotificationRows),
        },
      };

      if (existingMergeLog[0]?.id) {
        await tx.auditLog.update({
          where: { id: existingMergeLog[0].id },
          data: {
            user: session.username,
            metadata: nextMetadata,
          },
        });
        mergeAuditId = existingMergeLog[0].id;
      } else {
        const log = await tx.auditLog.create({
          data: {
            facility_id: session.id,
            user: session.username,
            action: "MERGE_DUPLICATE_BENEFICIARY",
            metadata: nextMetadata,
          },
        });
        mergeAuditId = log.id;
      }
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    revalidatePath("/transactions");
    revalidatePath("/admin/duplicates");
    return { success: true, mergedCount: mergeIds.length, keepId: chosenKeepId, keepCard: chosenKeepCard, mergeAuditId };
  } catch (error: unknown) {
    logger.error("Merge duplicate beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ دمج السجلات المكررة" };
  }
}

export async function mergeDuplicateGroupByCanonicalAction(formData: FormData) {
  const canonicalCardRaw = String(formData.get("canonical_card") ?? "").trim();
  if (!canonicalCardRaw) {
    return { error: "قيمة البطاقة المعيارية غير صالحة" };
  }

  const canonicalCard = canonicalizeCardNumber(canonicalCardRaw);
  const strategy = String(formData.get("strategy") ?? "ZERO_PRIORITY") as MergeStrategy;

  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const candidates = await prisma.beneficiary.findMany({
      where: {
        deleted_at: null,
        card_number: { startsWith: "WAB2025", mode: "insensitive" }
      },
      select: {
        id: true,
        card_number: true,
        remaining_balance: true,
        _count: { select: { transactions: true } },
      },
    });

    const matched = candidates.filter((c) => canonicalizeCardNumber(c.card_number) === canonicalCard);
    if (matched.length <= 1) {
      return { error: "لا توجد مجموعة مكررة قابلة للدمج" };
    }

    const picked = pickKeepByStrategy(
      matched.map((m) => ({
        id: m.id,
        card_number: m.card_number,
        remaining_balance: Number(m.remaining_balance),
        tx_count: m._count.transactions,
      })),
      strategy,
    );

    if (!picked) return { error: "تعذر تحديد سجل الإبقاء" };

    return mergeDuplicateBeneficiaries(picked.id, {
      forceKeep: true,
      strategy,
    });
  } catch (error: unknown) {
    logger.error("Merge duplicate group by canonical error", { error: String(error) });
    return { error: "تعذر تنفيذ دمج مجموعة التكرار" };
  }
}

export async function mergeDuplicateManualSelectionAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const memberIds = [...new Set(formData.getAll("member_ids").map((v) => String(v).trim()).filter(Boolean))];
  if (memberIds.length === 0) return { error: "لم يتم العثور على سجلات" };

  // خريطة لتجميع السجلات المراد دمجها حسب السجل المستهدف (المرجع)
  const targetMap = new Map<string, string[]>();

  for (const memberId of memberIds) {
    const targetId = String(formData.get(`action_${memberId}`) ?? "").trim();
    if (!targetId || !memberIds.includes(targetId)) return { error: "إجراء غير صحيح لأحد السجلات" };

    if (targetId !== memberId) {
      if (!targetMap.has(targetId)) targetMap.set(targetId, []);
      targetMap.get(targetId)!.push(memberId);
    }
  }

  let totalMerged = 0;

  for (const [keepId, explicitMergeIds] of targetMap.entries()) {
    if (explicitMergeIds.length > 0) {
      const res = await mergeDuplicateBeneficiaries(keepId, {
        forceKeep: true,
        explicitMergeIds,
        candidateIds: [keepId, ...explicitMergeIds],
        strategy: "ZERO_PRIORITY",
      });
      if (res.error) return res;
      totalMerged += (res.mergedCount ?? 0);
    }
  }

  // إذا قام المستخدم بتحديد إبقاء أكثر من سجل كأشخاص مستقلين، نعتبرهم غير متطابقين ونستبعدهم من بعض.
  const independentIds = memberIds.filter(m => String(formData.get(`action_${m}`) ?? "").trim() === m);
  if (independentIds.length > 1) {
    try {
      await prisma.auditLog.create({
        data: {
          action: "IGNORE_DUPLICATE_PAIR",
          user: session.username,
          facility_id: session.id,
          metadata: {
            ignore_ids: independentIds,
            timestamp: new Date().toISOString(),
            reason: "Manual exclusion via advanced merge (kept independent)",
          },
        },
      });
    } catch (err) {
      console.error("Failed to append IGNORE_DUPLICATE_PAIR:", err);
    }
  }

  return { mergedCount: totalMerged };
}

export const mergeNeedsReviewGroupAction = mergeDuplicateManualSelectionAction;

export async function mergeNeedsReviewBatchAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const payloads = formData
    .getAll("group_payload")
    .map((v) => String(v))
    .filter(Boolean);

  if (payloads.length === 0) {
    return { error: "لا توجد مجموعات محددة للمعالجة" };
  }

  let mergedGroups = 0;
  let mergedRows = 0;
  let firstAuditId: string | null = null;

  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as { keepId?: string; memberIds?: string[] };
      const keepId = String(parsed.keepId ?? "").trim();
      const memberIds = [...new Set((parsed.memberIds ?? []).map((x) => String(x).trim()).filter(Boolean))];
      if (!keepId || memberIds.length <= 1) continue;

      const result = await mergeDuplicateBeneficiaries(keepId, {
        forceKeep: true,
        explicitMergeIds: memberIds.filter((id) => id !== keepId),
        candidateIds: memberIds,
        strategy: "ZERO_PRIORITY",
      });

      if (!result.error) {
        mergedGroups += 1;
        mergedRows += Number(result.mergedCount ?? 0);
        if (!firstAuditId && (result as { mergeAuditId?: string }).mergeAuditId) {
          firstAuditId = (result as { mergeAuditId?: string }).mergeAuditId ?? null;
        }
      }
    } catch {
      continue;
    }
  }

  if (mergedGroups === 0) {
    return { error: "لم يتم دمج أي مجموعة بهذه الدفعة" };
  }

  return { success: true, mergedGroups, mergedRows, firstAuditId };
}

export async function mergeAllGlobalZeroVariantsAction() {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const rows = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      card_number: { startsWith: "WAB2025", mode: "insensitive" }
    },
    select: {
      id: true,
      name: true,
      card_number: true,
      birth_date: true,
      status: true,
      total_balance: true,
      remaining_balance: true,
      _count: { select: { transactions: true } },
    },
  });

  const { buildDuplicateGroups } = await import("@/lib/duplicate-groups");
  const { zeroVariantGroups } = buildDuplicateGroups(rows as Parameters<typeof buildDuplicateGroups>[0]);

  let mergedGroups = 0;
  let mergedRows = 0;
  let firstAuditId: string | null = null;

  for (const group of zeroVariantGroups) {
    try {
      const res = await mergeDuplicateBeneficiaries(group.preferredId, {
        forceKeep: true,
        candidateIds: group.members.map((m) => m.id),
        strategy: "ZERO_PRIORITY",
      });
      if (res && !res.error) {
        mergedGroups += 1;
        mergedRows += Number(res.mergedCount ?? 0);
        if (!firstAuditId && res.mergeAuditId) firstAuditId = res.mergeAuditId;
      }
    } catch {
      continue;
    }
  }

  if (mergedGroups === 0) {
    return { error: "لا توجد تكرارات صفرية آمنة متبقية للدمج الشامل" };
  }

  return { success: true, mergedGroups, mergedRows, firstAuditId };
}

export async function mergeDuplicateBatchByConditionAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const strategy = String(formData.get("strategy") ?? "ZERO_PRIORITY") as MergeStrategy;
  const canonicalCards = [...new Set(formData.getAll("canonical_card").map((v) => String(v).trim()).filter(Boolean))];
  const groupPayloads = formData.getAll("group_payload").map((v) => String(v).trim()).filter(Boolean);

  if (canonicalCards.length === 0 && groupPayloads.length === 0) {
    return { error: "لا توجد مجموعات محددة للدمج الجماعي" };
  }

  let mergedGroups = 0;
  let mergedRows = 0;
  let batchTotalRows = 0;
  let firstAuditId: string | null = null;

  // Process payloads (precise IDs)
  for (const payloadRaw of groupPayloads) {
    try {
      const { keepId, memberIds } = JSON.parse(payloadRaw) as { keepId: string; memberIds: string[] };
      const res = await mergeDuplicateBeneficiaries(keepId, {
        forceKeep: true,
        candidateIds: memberIds,
        strategy,
      });
      if (res && !res.error) {
        mergedGroups += 1;
        const currentMerged = Number(res.mergedCount ?? 0);
        mergedRows += currentMerged;
        batchTotalRows += (currentMerged + 1); // +1 is the keep_id beneficiary themselves
        if (!firstAuditId && res.mergeAuditId) firstAuditId = res.mergeAuditId;
      }
    } catch { continue; }
  }

  // Fallback to canonical re-discovery
  for (const canonical of canonicalCards) {
    const fd = new FormData();
    fd.set("canonical_card", canonical);
    fd.set("strategy", strategy);
    const result = await mergeDuplicateGroupByCanonicalAction(fd);
    if (result && !result.error) {
      const r = result as { mergedCount?: number; mergeAuditId?: string };
      mergedGroups += 1;
      mergedRows += Number(r.mergedCount ?? 0);
      if (!firstAuditId && r.mergeAuditId) firstAuditId = r.mergeAuditId;
    }
  }

  if (mergedGroups === 0) {
    return { error: "لم يتم دمج أي مجموعة بهذه الدفعة" };
  }

  return {
    success: true,
    mergedGroups,
    mergedRows,
    batchTotalRows,
    firstAuditId,
  };
}

export async function undoMergeDuplicateBeneficiariesByAuditId(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const auditId = String(formData.get("audit_id") ?? "").trim();
  if (!auditId) {
    return { error: "معرف عملية الدمج غير صالح" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const mergeLog = await tx.auditLog.findUnique({ where: { id: auditId } });
      if (!mergeLog || mergeLog.action !== "MERGE_DUPLICATE_BENEFICIARY") {
        throw new Error("MERGE_LOG_NOT_FOUND");
      }

      const metadata = (mergeLog.metadata ?? {}) as Record<string, unknown>;
      const undoSnapshot = (metadata.undo_snapshot ?? null) as
        | {
          keep_before?: {
            id: string;
            card_number: string;
            total_balance: number;
            remaining_balance: number;
            status: "ACTIVE" | "SUSPENDED" | "FINISHED";
            completed_via: string | null;
            deleted_at: string | null;
          } | null;
          merged_before?: Array<{
            id: string;
            card_number: string;
            total_balance: number;
            remaining_balance: number;
            status: "ACTIVE" | "SUSPENDED" | "FINISHED";
            completed_via: string | null;
            deleted_at: string | null;
          }>;
          moved_transactions?: Array<{ from_beneficiary_id: string; ids: string[] }>;
          moved_notifications?: Array<{ from_beneficiary_id: string; ids: string[] }>;
        }
        | null;

      if (!undoSnapshot || !undoSnapshot.keep_before) {
        throw new Error("UNDO_NOT_AVAILABLE");
      }

      if (metadata.undo_reverted_at) {
        throw new Error("UNDO_ALREADY_APPLIED");
      }

      const keepBefore = undoSnapshot.keep_before;
      const mergedBefore = undoSnapshot.merged_before ?? [];
      const movedTransactions = undoSnapshot.moved_transactions ?? [];
      const movedNotifications = undoSnapshot.moved_notifications ?? [];

      await tx.beneficiary.update({
        where: { id: keepBefore.id },
        data: {
          card_number: keepBefore.card_number,
          total_balance: keepBefore.total_balance,
          remaining_balance: keepBefore.remaining_balance,
          status: keepBefore.status,
          completed_via: keepBefore.completed_via,
          deleted_at: keepBefore.deleted_at ? new Date(keepBefore.deleted_at) : null,
        },
      });

      for (const row of mergedBefore) {
        await tx.beneficiary.update({
          where: { id: row.id },
          data: {
            card_number: row.card_number,
            total_balance: row.total_balance,
            remaining_balance: row.remaining_balance,
            status: row.status,
            completed_via: row.completed_via,
            deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
          },
        });
      }

      for (const batch of movedTransactions) {
        if (batch.ids.length === 0) continue;
        await tx.transaction.updateMany({
          where: { id: { in: batch.ids } },
          data: { beneficiary_id: batch.from_beneficiary_id },
        });
      }

      for (const batch of movedNotifications) {
        if (batch.ids.length === 0) continue;
        await tx.notification.updateMany({
          where: { id: { in: batch.ids } },
          data: { beneficiary_id: batch.from_beneficiary_id },
        });
      }

      const currentMeta = metadata;

      await tx.auditLog.update({
        where: { id: auditId },
        data: {
          metadata: {
            ...currentMeta,
            undo_reverted_at: new Date().toISOString(),
            undo_reverted_by: session.username,
            case_status: "UNDO_REVERTED",
            case_status_label: "تم التراجع",
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    revalidatePath("/transactions");
    revalidatePath("/admin/duplicates");
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "MERGE_LOG_NOT_FOUND") return { error: "عملية الدمج غير موجودة" };
      if (error.message === "UNDO_NOT_AVAILABLE") return { error: "لا يمكن التراجع عن هذه العملية لأنها لا تحتوي بيانات استرجاع" };
      if (error.message === "UNDO_ALREADY_APPLIED") return { error: "تم التراجع عن هذه العملية مسبقاً" };
    }
    logger.error("Undo merge duplicate beneficiaries error", { error: String(error), auditId });
    return { error: "تعذر التراجع عن عملية الدمج" };
  }
}

export async function ignoreDuplicatePairAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length < 2) return { error: "يجب تحديد معرفين على الأقل للاستبعاد" };

  try {
    await prisma.auditLog.create({
      data: {
        action: "IGNORE_DUPLICATE_PAIR",
        user: session.username,
        facility_id: session.id,
        metadata: {
          ignore_ids: ids,
          timestamp: new Date().toISOString(),
          reason: "Manual exclusion via admin (marked as different people)",
        },
      },
    });
    revalidatePath("/admin/duplicates");
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "خطأ غير معروف";
    return { error: "فشل تسجيل الاستبعاد: " + message };
  }
}
