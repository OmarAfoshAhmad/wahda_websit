import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { revalidateTag } from "next/cache";
import { Prisma, RestoreJobStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decryptBackup } from "@/lib/backup-crypto";
import { backupSchema } from "@/lib/backup-validation";
import { normalizeCardNumber, normalizePersonName } from "@/lib/normalize";
import { roundCurrency } from "@/lib/money";

const MAX_BACKUP_SIZE = 100 * 1024 * 1024; // 100 MB
const BATCH_SIZE = 100;
const PROCESSING_STALE_MS = 90_000;
const USER_CANCEL_MESSAGE = "تم إلغاء مهمة الاستعادة بواسطة المستخدم.";

type RestoreJobSnapshot = {
  id: string;
  status: RestoreJobStatus;
  progress: number;
  totalSteps: number;
  completedSteps: number;
  currentPhase: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  summary: {
    users: { added: number; updated: number; addedAdmins: number; updatedAdmins: number };
    providers: { added: number; updated: number; removed: number };
    transactions: { added: number; skipped: number };
    audit_logs: { added: number };
    notifications: { added: number; skipped: number };
  };
};

type CreateRestoreJobInput = {
  username: string;
  payload: Buffer;
};

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

function buildSummary(job: {
  added_facilities: number;
  updated_facilities: number;
  added_admins: number;
  updated_admins: number;
  added_beneficiaries: number;
  updated_beneficiaries: number;
  removed_beneficiaries: number;
  added_transactions: number;
  skipped_transactions: number;
  added_audit_logs: number;
  added_notifications: number;
  skipped_notifications: number;
}) {
  return {
    users: { added: job.added_facilities, updated: job.updated_facilities, addedAdmins: job.added_admins, updatedAdmins: job.updated_admins },
    providers: { added: job.added_beneficiaries, updated: job.updated_beneficiaries, removed: job.removed_beneficiaries },
    transactions: { added: job.added_transactions, skipped: job.skipped_transactions },
    audit_logs: { added: job.added_audit_logs },
    notifications: { added: job.added_notifications, skipped: job.skipped_notifications },
  };
}

function toSnapshot(job: {
  id: string;
  status: RestoreJobStatus;
  total_steps: number;
  completed_steps: number;
  current_phase: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  added_facilities: number;
  updated_facilities: number;
  added_admins: number;
  updated_admins: number;
  added_beneficiaries: number;
  updated_beneficiaries: number;
  removed_beneficiaries: number;
  added_transactions: number;
  skipped_transactions: number;
  added_audit_logs: number;
  added_notifications: number;
  skipped_notifications: number;
}): RestoreJobSnapshot {
  const progress = job.total_steps === 0 ? 0 : Math.min(100, Math.round((job.completed_steps / job.total_steps) * 100));

  return {
    id: job.id,
    status: job.status,
    progress,
    totalSteps: job.total_steps,
    completedSteps: job.completed_steps,
    currentPhase: job.current_phase,
    errorMessage: job.error_message,
    createdAt: job.created_at.toISOString(),
    startedAt: job.started_at?.toISOString() ?? null,
    completedAt: job.completed_at?.toISOString() ?? null,
    summary: buildSummary(job),
  };
}

function isTerminalStatus(status: RestoreJobStatus) {
  return status === "COMPLETED" || status === "FAILED";
}

function isUserCancelledError(message: string | null | undefined) {
  return message === USER_CANCEL_MESSAGE;
}

function sanitizeBeneficiaryBalances(totalBalanceRaw: unknown, remainingBalanceRaw: unknown) {
  const totalBalance = roundCurrency(Math.max(0, Number(totalBalanceRaw) || 0));
  const remainingBalance = roundCurrency(
    Math.min(totalBalance, Math.max(0, Number(remainingBalanceRaw) || 0)),
  );
  return { totalBalance, remainingBalance };
}

function normalizeBeneficiaryStatus(statusRaw: unknown, remainingBalance: number): "ACTIVE" | "FINISHED" | "SUSPENDED" {
  if (statusRaw === "SUSPENDED") return "SUSPENDED";
  return remainingBalance <= 0 ? "FINISHED" : "ACTIVE";
}

async function updateProgress(jobId: string, input: {
  completedSteps?: number;
  currentPhase?: string;
  addedFacilities?: number;
  updatedFacilities?: number;
  addedAdmins?: number;
  updatedAdmins?: number;
  addedBeneficiaries?: number;
  updatedBeneficiaries?: number;
  removedBeneficiaries?: number;
  addedTransactions?: number;
  skippedTransactions?: number;
  addedAuditLogs?: number;
  addedNotifications?: number;
  skippedNotifications?: number;
}) {
  const updates: Prisma.RestoreJobUpdateInput = {};

  if (input.completedSteps !== undefined) updates.completed_steps = input.completedSteps;
  if (input.currentPhase !== undefined) updates.current_phase = input.currentPhase;
  if (input.addedFacilities !== undefined) updates.added_facilities = input.addedFacilities;
  if (input.updatedFacilities !== undefined) updates.updated_facilities = input.updatedFacilities;
  if (input.addedAdmins !== undefined) updates.added_admins = input.addedAdmins;
  if (input.updatedAdmins !== undefined) updates.updated_admins = input.updatedAdmins;
  if (input.addedBeneficiaries !== undefined) updates.added_beneficiaries = input.addedBeneficiaries;
  if (input.updatedBeneficiaries !== undefined) updates.updated_beneficiaries = input.updatedBeneficiaries;
  if (input.removedBeneficiaries !== undefined) updates.removed_beneficiaries = input.removedBeneficiaries;
  if (input.addedTransactions !== undefined) updates.added_transactions = input.addedTransactions;
  if (input.skippedTransactions !== undefined) updates.skipped_transactions = input.skippedTransactions;
  if (input.addedAuditLogs !== undefined) updates.added_audit_logs = input.addedAuditLogs;
  if (input.addedNotifications !== undefined) updates.added_notifications = input.addedNotifications;
  if (input.skippedNotifications !== undefined) updates.skipped_notifications = input.skippedNotifications;

  if (Object.keys(updates).length === 0) return;

  await prisma.restoreJob.update({
    where: { id: jobId },
    data: updates,
  });
}

async function ensureNoActiveRestore(username: string): Promise<string | null> {
  const active = await prisma.restoreJob.findFirst({
    where: {
      created_by: username,
      status: {
        in: ["PENDING", "PROCESSING"],
      },
    },
    select: { id: true },
  });

  if (active) {
    return "توجد عملية استعادة قيد التنفيذ حالياً. انتظر حتى تكتمل.";
  }

  return null;
}

export async function createRestoreJob(input: CreateRestoreJobInput) {
  const activeRestoreError = await ensureNoActiveRestore(input.username);
  if (activeRestoreError) {
    return { error: activeRestoreError };
  }

  if (input.payload.length > MAX_BACKUP_SIZE) {
    return { error: "حجم الملف كبير جداً (الحد الأقصى 100MB)" as const };
  }

  const job = await prisma.restoreJob.create({
    data: {
      created_by: input.username,
      encrypted_payload: input.payload,
      status: "PENDING",
      current_phase: "PENDING",
    },
  });

  return { job: toSnapshot(job) };
}

export async function getRestoreJobSnapshot(jobId: string, username?: string) {
  const job = await prisma.restoreJob.findFirst({
    where: {
      id: jobId,
      ...(username ? { created_by: username } : {}),
    },
  });

  if (!job) return null;
  return toSnapshot(job);
}

async function throwIfCancelled(jobId: string) {
  const job = await prisma.restoreJob.findUnique({
    where: { id: jobId },
    select: { status: true, error_message: true },
  });

  if (job?.status === "FAILED" && isUserCancelledError(job.error_message)) {
    throw new Error(USER_CANCEL_MESSAGE);
  }
}

export async function resumeRestoreJobIfNeeded(jobId: string, username: string) {
  const job = await prisma.restoreJob.findFirst({
    where: {
      id: jobId,
      created_by: username,
    },
    select: { id: true, status: true, updated_at: true },
  });

  if (!job) return null;

  const isStaleProcessing =
    job.status === "PROCESSING" &&
    job.updated_at.getTime() < Date.now() - PROCESSING_STALE_MS;

  if (job.status === "PENDING" || isStaleProcessing) {
    await startRestoreJobInBackground(job.id, username);
  }

  return getRestoreJobSnapshot(job.id, username);
}

export async function resumeLatestRestoreJobIfNeeded(username: string) {
  const latest = await prisma.restoreJob.findFirst({
    where: { created_by: username },
    orderBy: { created_at: "desc" },
    select: { id: true },
  });

  if (!latest) return null;
  return resumeRestoreJobIfNeeded(latest.id, username);
}

export async function cancelRestoreJob(jobId: string, username: string) {
  const job = await prisma.restoreJob.findFirst({
    where: {
      id: jobId,
      created_by: username,
    },
  });

  if (!job) return null;
  if (isTerminalStatus(job.status)) return toSnapshot(job);

  const cancelled = await prisma.restoreJob.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      current_phase: "FAILED",
      error_message: USER_CANCEL_MESSAGE,
      completed_at: new Date(),
    },
  });

  return toSnapshot(cancelled);
}

export async function processRestoreJob(jobId: string, username: string) {
  const staleProcessingBefore = new Date(Date.now() - PROCESSING_STALE_MS);

  const lock = await prisma.restoreJob.updateMany({
    where: {
      id: jobId,
      created_by: username,
      OR: [
        {
          status: {
            in: ["PENDING", "FAILED"],
          },
        },
        {
          status: "PROCESSING",
          updated_at: { lt: staleProcessingBefore },
        },
      ],
    },
    data: {
      status: "PROCESSING",
      started_at: new Date(),
      completed_at: null,
      error_message: null,
      current_phase: "VALIDATING_BACKUP",
      completed_steps: 0,
      total_steps: 0,
      added_facilities: 0,
      updated_facilities: 0,
      added_admins: 0,
      updated_admins: 0,
      added_beneficiaries: 0,
      updated_beneficiaries: 0,
      removed_beneficiaries: 0,
      added_transactions: 0,
      skipped_transactions: 0,
      added_audit_logs: 0,
      added_notifications: 0,
      skipped_notifications: 0,
    },
  });

  const currentJob = await prisma.restoreJob.findFirst({
    where: {
      id: jobId,
      created_by: username,
    },
  });

  if (!currentJob) {
    return { error: "لم يتم العثور على مهمة الاستعادة." as const };
  }

  if (lock.count === 0) {
    return { job: toSnapshot(currentJob) };
  }

  try {
    let jsonString: string;
    try {
      jsonString = decryptBackup(Buffer.from(currentJob.encrypted_payload));
    } catch {
      throw new Error("تعذر فك تشفير الملف — تأكد أنه نسخة احتياطية صالحة ومن نفس النظام");
    }

    let rawData: unknown;
    try {
      rawData = JSON.parse(jsonString);
    } catch {
      throw new Error("ملف النسخة الاحتياطية غير صالح (ليس JSON)");
    }

    const parsed = backupSchema.safeParse(rawData);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      throw new Error(`بيانات النسخة غير صالحة: ${firstError.path.join(".")} — ${firstError.message}`);
    }

    const backup = parsed.data;
    const { users, providers, transactions, audit_logs, notifications } = backup.data;

    await throwIfCancelled(currentJob.id);

    const userChunks = chunkRows(users, BATCH_SIZE);
    const providerChunks = chunkRows(providers, BATCH_SIZE);
    const transactionChunks = chunkRows(transactions, BATCH_SIZE);
    const auditLogChunks = chunkRows(audit_logs, BATCH_SIZE);
    const notificationChunks = chunkRows(notifications, BATCH_SIZE);

    const totalSteps = userChunks.length + providerChunks.length + 1 + transactionChunks.length + auditLogChunks.length + notificationChunks.length + 1;

    await prisma.restoreJob.update({
      where: { id: currentJob.id },
      data: {
        total_steps: totalSteps,
        current_phase: "RESTORING_FACILITIES",
      },
    });

    const generatedSecret = randomBytes(24).toString("base64url");
    const defaultPasswordHash = await bcrypt.hash(generatedSecret, 10);
    const hasFacilityPasswordHashes = users.some((user) => Boolean(user.password_hash));

    let completedSteps = 0;
    let restoredFacilities = 0;
    let updatedFacilities = 0;
    let restoredAdmins = 0;
    let updatedAdmins = 0;
    let restoredBeneficiaries = 0;
    let updatedBeneficiaries = 0;
    let removedBeneficiaries = 0;
    let restoredTransactions = 0;
    let skippedTransactions = 0;
    let restoredAuditLogs = 0;
    let restoredNotifications = 0;
    let skippedNotifications = 0;

    const userIdMap = new Map<string, string>();
    const providerIdMap = new Map<string, string>();

    for (const chunk of userChunks) {
      await throwIfCancelled(currentJob.id);

      for (const user of chunk) {
        const existing = await prisma.facility.findUnique({ where: { username: user.username } });

        if (existing) {
          userIdMap.set(user.id, existing.id);
          await prisma.facility.update({
            where: { username: user.username },
            data: {
              name: user.name,
              ...(user.password_hash ? { password_hash: user.password_hash } : {}),
              is_admin: user.is_admin,
              is_manager: user.is_manager,
              ...(user.manager_permissions ? { manager_permissions: user.manager_permissions } : {}),
              must_change_password: user.password_hash ? user.must_change_password : true,
              deleted_at: user.deleted_at ? new Date(user.deleted_at) : null,
            },
          });
          if (user.is_admin || user.is_manager) updatedAdmins++; else updatedFacilities++;
        } else {
          userIdMap.set(user.id, user.id);
          await prisma.facility.create({
            data: {
              id: user.id,
              name: user.name,
              username: user.username,
              password_hash: user.password_hash ?? defaultPasswordHash,
              is_admin: user.is_admin,
              is_manager: user.is_manager,
              manager_permissions: user.manager_permissions ?? null,
              must_change_password: user.password_hash ? user.must_change_password : true,
              deleted_at: user.deleted_at ? new Date(user.deleted_at) : null,
              created_at: new Date(user.created_at),
            },
          });
          if (user.is_admin || user.is_manager) restoredAdmins++; else restoredFacilities++;
        }
      }

      completedSteps++;
      await updateProgress(currentJob.id, {
        currentPhase: "RESTORING_FACILITIES",
        completedSteps,
        addedFacilities: restoredFacilities,
        updatedFacilities,
        addedAdmins: restoredAdmins,
        updatedAdmins,
      });
    }

    await updateProgress(currentJob.id, { currentPhase: "RESTORING_BENEFICIARIES" });

    for (const chunk of providerChunks) {
      await throwIfCancelled(currentJob.id);

      // استعلام دفعي بدل N+1 — ثلاث استعلامات لكل الدفعة بدل 3 لكل سجل
      const chunkIds = chunk.map((p) => p.id);
      const chunkCardNumbers = chunk.map((p) => normalizeCardNumber(p.card_number));
      const chunkBirthDates = chunk
        .filter((p) => p.birth_date)
        .map((p) => new Date(p.birth_date!));

      const [existingByIds, existingByCards, existingByPerson] = await Promise.all([
        prisma.beneficiary.findMany({
          where: { id: { in: chunkIds } },
          select: { id: true, pin_hash: true },
        }),
        prisma.beneficiary.findMany({
          where: { card_number: { in: chunkCardNumbers, mode: "insensitive" } },
          select: { id: true, card_number: true, pin_hash: true },
        }),
        chunkBirthDates.length > 0
          ? prisma.beneficiary.findMany({
            where: {
              deleted_at: null,
              birth_date: { in: chunkBirthDates },
            },
            select: { id: true, name: true, birth_date: true, pin_hash: true },
          })
          : Promise.resolve([]),
      ]);

      const idMap = new Map(existingByIds.map((b) => [b.id, b]));
      const cardMap = new Map(existingByCards.map((b) => [b.card_number.trim().toUpperCase(), b]));
      const personIndex = new Map<string, { id: string; pin_hash: string | null }>();
      for (const b of existingByPerson) {
        if (b.birth_date) {
          const key = `${b.name.trim().replace(/\s+/g, " ").toLowerCase()}|${b.birth_date.toISOString()}`;
          personIndex.set(key, { id: b.id, pin_hash: b.pin_hash });
        }
      }

      for (const provider of chunk) {
        const normalizedCardNumber = normalizeCardNumber(provider.card_number);
        const normalizedProviderName = normalizePersonName(provider.name);
        const providerBirthDate = provider.birth_date ? new Date(provider.birth_date) : null;
        const { totalBalance, remainingBalance } = sanitizeBeneficiaryBalances(
          provider.total_balance,
          provider.remaining_balance,
        );
        const normalizedStatus = normalizeBeneficiaryStatus(provider.status, remainingBalance);

        const matchedByCard = cardMap.get(normalizedCardNumber);
        const matchedByPerson = providerBirthDate
          ? personIndex.get(`${normalizedProviderName.toLowerCase()}|${providerBirthDate.toISOString()}`)
          : null;
        const matchedById = idMap.get(provider.id);

        const existing = matchedByCard ?? matchedByPerson ?? matchedById ?? null;

        if (existing) {
          providerIdMap.set(provider.id, existing.id);
          await prisma.beneficiary.update({
            where: { id: existing.id },
            data: {
              card_number: normalizedCardNumber,
              name: normalizedProviderName,
              birth_date: providerBirthDate,
              status: normalizedStatus,
              total_balance: totalBalance,
              remaining_balance: remainingBalance,
              ...(provider.pin_hash && !existing.pin_hash ? { pin_hash: provider.pin_hash } : {}),
              deleted_at: provider.deleted_at ? new Date(provider.deleted_at) : null,
            },
          });
          updatedBeneficiaries++;
        } else {
          providerIdMap.set(provider.id, provider.id);
          await prisma.beneficiary.create({
            data: {
              id: provider.id,
              card_number: normalizedCardNumber,
              name: normalizedProviderName,
              birth_date: providerBirthDate,
              total_balance: totalBalance,
              remaining_balance: remainingBalance,
              status: normalizedStatus,
              pin_hash: provider.pin_hash ?? null,
              failed_attempts: provider.failed_attempts ?? 0,
              locked_until: provider.locked_until ? new Date(provider.locked_until) : null,
              deleted_at: provider.deleted_at ? new Date(provider.deleted_at) : null,
              created_at: new Date(provider.created_at),
            },
          });
          restoredBeneficiaries++;
        }
      }

      completedSteps++;
      await updateProgress(currentJob.id, {
        currentPhase: "RESTORING_BENEFICIARIES",
        completedSteps,
        addedBeneficiaries: restoredBeneficiaries,
        updatedBeneficiaries,
      });
    }

    // ─── مرحلة التنظيف: حذف المستفيدين غير الموجودين في النسخة ─────
    await throwIfCancelled(currentJob.id);
    await updateProgress(currentJob.id, { currentPhase: "CLEANING_EXTRA_BENEFICIARIES" });

    // جمع IDs المستفيدين الذين تمت مطابقتهم أو إنشاؤهم من النسخة
    const restoredBeneficiaryIds = new Set(providerIdMap.values());

    // جلب جميع المستفيدين النشطين في قاعدة البيانات
    const allDbBeneficiaries = await prisma.beneficiary.findMany({
      where: { deleted_at: null },
      select: { id: true },
    });

    // حذف ناعم للمستفيدين غير الموجودين في النسخة
    const toRemoveIds = allDbBeneficiaries
      .filter((b) => !restoredBeneficiaryIds.has(b.id))
      .map((b) => b.id);

    if (toRemoveIds.length > 0) {
      // حذف الحركات المرتبطة بالمستفيدين المحذوفين
      await prisma.transaction.deleteMany({
        where: { beneficiary_id: { in: toRemoveIds } },
      });

      // حذف الإشعارات المرتبطة
      await prisma.notification.deleteMany({
        where: { beneficiary_id: { in: toRemoveIds } },
      });

      // حذف ناعم للمستفيدين
      await prisma.beneficiary.updateMany({
        where: { id: { in: toRemoveIds } },
        data: { deleted_at: new Date() },
      });

      removedBeneficiaries = toRemoveIds.length;
    }

    completedSteps++;
    await updateProgress(currentJob.id, {
      completedSteps,
      removedBeneficiaries,
    });

    await updateProgress(currentJob.id, { currentPhase: "RESTORING_TRANSACTIONS" });

    for (const chunk of transactionChunks) {
      await throwIfCancelled(currentJob.id);

      const mappedFacilityIds = [...new Set(chunk.map((t) => userIdMap.get(t.facility_id) ?? t.facility_id))];
      const mappedBeneficiaryIds = [...new Set(chunk.map((t) => providerIdMap.get(t.beneficiary_id) ?? t.beneficiary_id))];
      const transactionIds = chunk.map((t) => t.id);
      const originalIds = [...new Set(chunk.map((t) => t.original_transaction_id).filter(Boolean))] as string[];

      const [facilities, beneficiaries, existingTransactions, existingOriginals] = await Promise.all([
        prisma.facility.findMany({ where: { id: { in: mappedFacilityIds } }, select: { id: true } }),
        prisma.beneficiary.findMany({ where: { id: { in: mappedBeneficiaryIds } }, select: { id: true } }),
        prisma.transaction.findMany({ where: { id: { in: transactionIds } }, select: { id: true } }),
        originalIds.length > 0
          ? prisma.transaction.findMany({ where: { id: { in: originalIds } }, select: { id: true } })
          : Promise.resolve([]),
      ]);

      const facilitySet = new Set(facilities.map((item) => item.id));
      const beneficiarySet = new Set(beneficiaries.map((item) => item.id));
      const existingSet = new Set(existingTransactions.map((item) => item.id));
      const originalSet = new Set(existingOriginals.map((item) => item.id));

      const rowsToInsert: Prisma.TransactionCreateManyInput[] = [];

      for (const t of chunk) {
        const mappedFacilityId = userIdMap.get(t.facility_id) ?? t.facility_id;
        const mappedBeneficiaryId = providerIdMap.get(t.beneficiary_id) ?? t.beneficiary_id;

        if (!facilitySet.has(mappedFacilityId) || !beneficiarySet.has(mappedBeneficiaryId)) {
          skippedTransactions++;
          continue;
        }

        if (existingSet.has(t.id)) {
          continue;
        }

        let mappedOriginalTransactionId: string | null = t.original_transaction_id ?? null;
        if (mappedOriginalTransactionId && !originalSet.has(mappedOriginalTransactionId)) {
          mappedOriginalTransactionId = null;
        }

        rowsToInsert.push({
          id: t.id,
          beneficiary_id: mappedBeneficiaryId,
          facility_id: mappedFacilityId,
          amount: t.amount,
          type: t.type,
          is_cancelled: t.is_cancelled,
          original_transaction_id: mappedOriginalTransactionId,
          created_at: new Date(t.created_at),
        });
      }

      if (rowsToInsert.length > 0) {
        const result = await prisma.transaction.createMany({
          data: rowsToInsert,
          skipDuplicates: true,
        });
        restoredTransactions += result.count;
      }

      completedSteps++;
      await updateProgress(currentJob.id, {
        currentPhase: "RESTORING_TRANSACTIONS",
        completedSteps,
        addedTransactions: restoredTransactions,
        skippedTransactions,
      });
    }

    await updateProgress(currentJob.id, { currentPhase: "RESTORING_AUDIT_LOGS" });

    for (const chunk of auditLogChunks) {
      await throwIfCancelled(currentJob.id);

      const rowIds = chunk.map((a) => a.id);
      const existingRows = await prisma.auditLog.findMany({
        where: { id: { in: rowIds } },
        select: { id: true },
      });
      const existingSet = new Set(existingRows.map((row) => row.id));

      const rowsToInsert: Prisma.AuditLogCreateManyInput[] = [];
      for (const a of chunk) {
        if (existingSet.has(a.id)) continue;

        const mappedFacilityId = a.facility_id ? (userIdMap.get(a.facility_id) ?? a.facility_id) : null;
        rowsToInsert.push({
          id: a.id,
          facility_id: mappedFacilityId,
          user: a.user,
          action: a.action,
          metadata: a.metadata as Prisma.InputJsonValue,
          created_at: new Date(a.created_at),
        });
      }

      if (rowsToInsert.length > 0) {
        const result = await prisma.auditLog.createMany({
          data: rowsToInsert,
          skipDuplicates: true,
        });
        restoredAuditLogs += result.count;
      }

      completedSteps++;
      await updateProgress(currentJob.id, {
        currentPhase: "RESTORING_AUDIT_LOGS",
        completedSteps,
        addedAuditLogs: restoredAuditLogs,
      });
    }

    await updateProgress(currentJob.id, { currentPhase: "RESTORING_NOTIFICATIONS" });

    for (const chunk of notificationChunks) {
      await throwIfCancelled(currentJob.id);

      const rowIds = chunk.map((n) => n.id);
      const beneficiaryIds = [...new Set(chunk.map((n) => providerIdMap.get(n.beneficiary_id) ?? n.beneficiary_id))];
      const [existingRows, beneficiaries] = await Promise.all([
        prisma.notification.findMany({ where: { id: { in: rowIds } }, select: { id: true } }),
        prisma.beneficiary.findMany({ where: { id: { in: beneficiaryIds } }, select: { id: true } }),
      ]);

      const existingSet = new Set(existingRows.map((row) => row.id));
      const beneficiarySet = new Set(beneficiaries.map((b) => b.id));

      const rowsToInsert: Prisma.NotificationCreateManyInput[] = [];
      for (const n of chunk) {
        const mappedBeneficiaryId = providerIdMap.get(n.beneficiary_id) ?? n.beneficiary_id;
        if (!beneficiarySet.has(mappedBeneficiaryId)) {
          skippedNotifications++;
          continue;
        }
        if (existingSet.has(n.id)) continue;

        rowsToInsert.push({
          id: n.id,
          beneficiary_id: mappedBeneficiaryId,
          title: n.title,
          message: n.message,
          amount: n.amount,
          is_read: n.is_read,
          created_at: new Date(n.created_at),
        });
      }

      if (rowsToInsert.length > 0) {
        const result = await prisma.notification.createMany({
          data: rowsToInsert,
          skipDuplicates: true,
        });
        restoredNotifications += result.count;
      }

      completedSteps++;
      await updateProgress(currentJob.id, {
        currentPhase: "RESTORING_NOTIFICATIONS",
        completedSteps,
        addedNotifications: restoredNotifications,
        skippedNotifications,
      });
    }

    completedSteps++;

    const completedJob = await prisma.restoreJob.update({
      where: { id: currentJob.id },
      data: {
        status: "COMPLETED",
        current_phase: "COMPLETED",
        completed_steps: completedSteps,
        added_facilities: restoredFacilities,
        updated_facilities: updatedFacilities,
        added_admins: restoredAdmins,
        updated_admins: updatedAdmins,
        added_beneficiaries: restoredBeneficiaries,
        updated_beneficiaries: updatedBeneficiaries,
        removed_beneficiaries: removedBeneficiaries,
        added_transactions: restoredTransactions,
        skipped_transactions: skippedTransactions,
        added_audit_logs: restoredAuditLogs,
        added_notifications: restoredNotifications,
        skipped_notifications: skippedNotifications,
        completed_at: new Date(),
      },
    });

    const facility = await prisma.facility.findUnique({
      where: { username },
      select: { id: true },
    });

    await prisma.auditLog.create({
      data: {
        facility_id: facility?.id,
        user: username,
        action: "BACKUP_RESTORE_BACKGROUND",
        metadata: {
          backup_date: backup.exported_at,
          includes_sensitive: backup.includes_sensitive,
          restored_password_hashes: hasFacilityPasswordHashes,
          restored: buildSummary(completedJob),
          restore_job_id: completedJob.id,
        },
      },
    });

    // حذف ملف النسخة المشفّر بعد نجاح الاستعادة لتقليل أثر البيانات الحساسة
    await prisma.restoreJob.update({
      where: { id: currentJob.id },
      data: { encrypted_payload: Buffer.alloc(0) },
    });

    // إعادة حساب الأرصدة لضمان التطابق بين remaining_balance والحركات الفعلية
    try {
      await recalcBalancesAfterRestore();
    } catch (recalcErr) {
      logger.error("Recalc balances after restore failed", { error: String(recalcErr) });
    }

    try {
      revalidateTag("beneficiary-counts", "max");
    } catch { }

    return { job: toSnapshot(completedJob) };
  } catch (error) {
    if (error instanceof Error && isUserCancelledError(error.message)) {
      logger.warn("Restore job cancelled", { jobId });
    } else {
      logger.error("Restore job failed", { jobId, error: String(error) });
    }

    const failed = await prisma.restoreJob.update({
      where: { id: currentJob.id },
      data: {
        status: "FAILED",
        current_phase: "FAILED",
        error_message: error instanceof Error ? error.message : "تعذرت استعادة النسخة الاحتياطية",
        completed_at: new Date(),
      },
    });

    return { job: toSnapshot(failed), error: failed.error_message ?? "تعذرت استعادة النسخة الاحتياطية" };
  }
}

export async function startRestoreJobInBackground(jobId: string, username: string) {
  void Promise.resolve()
    .then(async () => {
      await processRestoreJob(jobId, username);
    })
    .catch((error: unknown) => {
      logger.error("Restore job uncaught error", { jobId, error: String(error) });
    });
}

export async function getLatestRestoreJob(username: string) {
  const job = await prisma.restoreJob.findFirst({
    where: { created_by: username },
    orderBy: { created_at: "desc" },
  });

  if (!job) return null;
  return toSnapshot(job);
}

export async function cleanupOldRestoreJobs(days = 14) {
  const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await prisma.restoreJob.deleteMany({
    where: {
      status: { in: ["COMPLETED", "FAILED"] },
      created_at: { lt: before },
    },
  });
}

export function canStartNewRestore(status: RestoreJobStatus | null) {
  if (!status) return true;
  return isTerminalStatus(status);
}

// ─── Recalc Balances After Restore ───────────────────────────────

async function recalcBalancesAfterRestore() {
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: { id: true, total_balance: true, remaining_balance: true, status: true, completed_via: true },
  });

  if (beneficiaries.length === 0) return;

  const spentRows = await prisma.transaction.groupBy({
    by: ["beneficiary_id"],
    where: {
      beneficiary_id: { in: beneficiaries.map((b) => b.id) },
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    _sum: { amount: true },
  });

  const spentById = new Map(spentRows.map((row) => [row.beneficiary_id, Number(row._sum.amount ?? 0)]));

  for (const ben of beneficiaries) {
    const total = Number(ben.total_balance);
    const spent = spentById.get(ben.id) ?? 0;
    const correctRemaining = roundCurrency(Math.max(0, total - spent));
    const currentRemaining = Number(ben.remaining_balance);

    const correctStatus =
      ben.status === "SUSPENDED" ? "SUSPENDED" : correctRemaining <= 0 ? "FINISHED" : "ACTIVE";

    const balanceDiff = Math.abs(correctRemaining - currentRemaining);
    if (balanceDiff < 0.005 && correctStatus === ben.status) continue;

    await prisma.beneficiary.update({
      where: { id: ben.id },
      data: {
        remaining_balance: correctRemaining,
        status: correctStatus,
        completed_via:
          correctStatus === "FINISHED"
            ? (ben.completed_via ?? "IMPORT")
            : null,
      },
    });
  }
}
