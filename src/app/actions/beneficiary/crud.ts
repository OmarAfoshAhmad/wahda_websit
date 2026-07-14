"use server";

import { TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { updateBeneficiarySchema, createBeneficiarySchema } from "@/lib/validation";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { getLedgerRemainingByBeneficiaryId } from "@/lib/ledger-balance";
import { roundCurrency } from "@/lib/money";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { normalizePersonName } from "@/lib/normalize";
import * as utils from "./utils";

export async function getBeneficiaryByCard(card_number: string) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح" };
  }

  const normalizedCardNumber = utils.normalizeCardNumber(card_number);

  if (!normalizedCardNumber || normalizedCardNumber.length > 50) {
    return { error: "رقم البطاقة غير صالح" };
  }

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
  const normalizedCardNumber = utils.normalizeCardNumber(payload.card_number);
  const normalizedName = normalizePersonName(payload.name);
  const parsedBirthDate = utils.parseBirthDate(payload.birth_date);
  const initialBalance = await getCurrentInitialBalance();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedCardNumber}))`;

      await utils.ensureCardNumberAvailability(tx, normalizedCardNumber);

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

      const familyBaseCard = utils.extractFamilyBaseCard(normalizedCardNumber);
      const archiveRows = await tx.$queryRaw<Array<{
        family_count_from_file: number;
        total_balance_from_file: number;
        used_balance_from_file: number;
        last_imported_at: Date;
      }>>`
        SELECT
          "family_count_from_file"::int AS family_count_from_file,
          "total_balance_from_file"::float8 AS total_balance_from_file,
          "used_balance_from_file"::float8 AS used_balance_from_file,
          "last_imported_at"
        FROM "FamilyImportArchive"
        WHERE "family_base_card" = ${familyBaseCard}
        LIMIT 1
      `;

      const archive = archiveRows[0];
      if (archive) {
        const expectedCount = Math.max(0, Math.floor(Number(archive.family_count_from_file) || 0));

        if (expectedCount > 0) {
          const familyMembers = await tx.$queryRaw<Array<{
            id: string;
            card_number: string;
            status: string;
            remaining_balance: number;
          }>>`
            SELECT id, card_number, status::text, remaining_balance::float8
            FROM "Beneficiary"
            WHERE deleted_at IS NULL
              AND (
                card_number = ${familyBaseCard}
                OR card_number ~ ${utils.familySuffixRegex(familyBaseCard)}
              )
            ORDER BY card_number ASC
          `;

          const newMemberIndex = familyMembers.findIndex((m) => m.id === beneficiary.id);
          if (newMemberIndex >= 0 && familyMembers.length <= expectedCount) {
            const totalFromFile = Math.max(0, Math.round(Number(archive.total_balance_from_file) || 0));
            const usedFromFile = Math.max(0, Math.round(Number(archive.used_balance_from_file) || 0));

            const totalBaseShare = Math.floor(totalFromFile / expectedCount);
            const totalRemainder = totalFromFile - totalBaseShare * expectedCount;
            const totalRemainderRecipient = utils.chooseRemainderRecipientIndex(
              familyMembers.map((m) => ({
                status: String(m.status ?? ""),
                availableBalance: Number(m.remaining_balance ?? 0),
              })),
              totalRemainder,
            );

            const usedBaseShare = Math.floor(usedFromFile / expectedCount);
            const usedRemainder = usedFromFile - usedBaseShare * expectedCount;
            const usedRemainderRecipient = totalRemainderRecipient;

            const targetTotal =
              totalBaseShare + (newMemberIndex === totalRemainderRecipient ? totalRemainder : 0);
            const plannedUsed =
              usedBaseShare + (newMemberIndex === usedRemainderRecipient ? usedRemainder : 0);
            const importDeduction = roundCurrency(Math.min(targetTotal, Math.max(0, plannedUsed)));
            const newRemaining = roundCurrency(Math.max(0, targetTotal - importDeduction));
            const newStatus: "ACTIVE" | "FINISHED" = newRemaining <= 0 ? "FINISHED" : "ACTIVE";

            await tx.beneficiary.update({
              where: { id: beneficiary.id },
              data: {
                total_balance: targetTotal,
                remaining_balance: newRemaining,
                status: newStatus,
                completed_via: newStatus === "FINISHED" ? "IMPORT" : null,
              },
            });

            if (importDeduction > 0) {
              const idempotencyKey = `FAMILY_IMPORT_SHARE:${familyBaseCard}:${beneficiary.id}:${archive.last_imported_at.getTime()}`;
              await tx.transaction.upsert({
                where: { idempotency_key: idempotencyKey },
                update: {
                  amount: importDeduction,
                  is_cancelled: false,
                  facility_id: session.id,
                },
                create: {
                  beneficiary_id: beneficiary.id,
                  facility_id: session.id,
                  amount: importDeduction,
                  type: TransactionType.IMPORT,
                  idempotency_key: idempotencyKey,
                },
              });
            }
          }
        }
      }

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
  is_legacy_card?: boolean;
  total_balance?: number;
  remaining_balance?: number;
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
  const normalizedCardNumber = utils.normalizeCardNumber(payload.card_number);
  const normalizedName = normalizePersonName(payload.name);
  const parsedBirthDate = utils.parseBirthDate(payload.birth_date);

  try {
    await prisma.$transaction(async (tx) => {
      const oldRecord = await tx.beneficiary.findUnique({
        where: { id: payload.id },
        select: {
          name: true,
          card_number: true,
          birth_date: true,
          status: true,
          is_legacy_card: true,
          completed_via: true,
          total_balance: true,
          remaining_balance: true,
        },
      });

      if (!oldRecord) {
        throw new Error("NOT_FOUND");
      }

      const oldNormalizedCardNumber = utils.normalizeCardNumber(oldRecord.card_number);
      const cardChanged = oldNormalizedCardNumber !== normalizedCardNumber;

      if (cardChanged) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedCardNumber}))`;
        await utils.ensureCardNumberAvailability(tx, normalizedCardNumber, payload.id);
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

      const spentAggregate = await tx.transaction.aggregate({
        where: {
          beneficiary_id: payload.id,
          is_cancelled: false,
          type: { not: "CANCELLATION" },
        },
        _sum: { amount: true },
      });

      const spentAmount = Number(spentAggregate._sum.amount ?? 0);
      const nextRemaining = payload.remaining_balance !== undefined
        ? payload.remaining_balance
        : Number(oldRecord.remaining_balance);

      const nextTotal = payload.total_balance !== undefined
        ? payload.total_balance
        : (payload.remaining_balance !== undefined
          ? spentAmount + payload.remaining_balance
          : Number(oldRecord.total_balance));

      await tx.beneficiary.update({
        where: { id: payload.id },
        data: {
          name: normalizedName,
          card_number: normalizedCardNumber,
          birth_date: parsedBirthDate,
          status: payload.status,
          is_legacy_card: payload.is_legacy_card,
          completed_via: payload.status === "FINISHED" ? (oldRecord.completed_via ?? "MANUAL") : null,
          total_balance: nextTotal,
          remaining_balance: nextRemaining,
        },
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "UPDATE_BENEFICIARY",
          metadata: {
            beneficiary_id: payload.id,
            beneficiary_name: normalizedName,
            card_number: normalizedCardNumber,
            old_name: oldRecord?.name ?? null,
            old_card_number: oldRecord?.card_number ?? null,
            old_birth_date: oldRecord?.birth_date?.toISOString() ?? null,
            old_status: oldRecord?.status ?? null,
            old_is_legacy_card: oldRecord?.is_legacy_card ?? false,
            old_total_balance: oldRecord?.total_balance ?? null,
            old_remaining_balance: oldRecord?.remaining_balance ?? null,
            new_name: normalizedName,
            new_birth_date: parsedBirthDate?.toISOString() ?? null,
            new_status: payload.status,
            new_is_legacy_card: payload.is_legacy_card,
            spent_amount_at_edit: spentAmount,
            new_total_balance: nextTotal,
            new_remaining_balance: nextRemaining,
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
      if (error.message === "NOT_FOUND") return { error: "المستفيد غير موجود" };
      if (error.message.includes("AuditLog") || error.message.includes("audit")) {
        return { error: "تعذر حفظ سجل التدقيق أثناء تحديث المستفيد. يرجى إعادة المحاولة." };
      }
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
        _count: { select: { transactions: { where: { is_cancelled: false } } } },
      },
    });

    if (!beneficiary || beneficiary.deleted_at !== null) {
      return { error: "المستفيد غير موجود" };
    }

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

    const normalizedCardNumber = utils.normalizeCardNumber(beneficiary.card_number);
    await utils.ensureCardNumberAvailability(prisma, normalizedCardNumber, id);

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
