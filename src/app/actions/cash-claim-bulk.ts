"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { formatCurrency, roundCurrency } from "@/lib/money";
import { assertBeneficiariesBalanceInvariant, buildIdempotencyKey } from "@/lib/tx-balance-guard";
import { normalizeCardInput } from "@/lib/card-number";
import { MAX_DEDUCTION_AMOUNT } from "@/lib/validation";
import { emitNotification, type NotificationPayload } from "@/lib/sse-notifications";
import { Prisma } from "@prisma/client";
import { extractBaseCard } from "@/lib/normalize";

const MAX_BULK_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BULK_ROWS = 5_000;
const ALLOWED_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);

export type BulkImportResult = {
  success: boolean;
  message: string;
  successfulRows: number;
  failedRows: number;
  errors: Array<{
    row: number;
    cardNumber: string;
    beneficiaryName: string;
    amount: number | string;
    serviceType: string;
    reason: string;
    errorCode: "INVALID_CARD" | "INVALID_AMOUNT" | "INVALID_SERVICE" | "CARD_NOT_FOUND" | "SUSPENDED" | "BALANCE_EXHAUSTED" | "AMOUNT_EXCEEDS_BALANCE" | "FILE_TOTAL_EXCEEDS_BALANCE";
  }>;
};

export async function processBulkCashClaim(formData: FormData): Promise<BulkImportResult> {
  const session = await requireActiveFacilitySession();
  if (!session || (!session.is_admin && !hasPermission(session, "cash_claim_import"))) {
    return { success: false, message: "غير مصرح لك بهذه العملية", successfulRows: 0, failedRows: 0, errors: [] };
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    return { success: false, message: "لم يتم العثور على ملف", successfulRows: 0, failedRows: 0, errors: [] };
  }
  const file = fileValue;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, message: "نوع الملف غير مدعوم؛ المسموح XLSX أو XLS أو CSV", successfulRows: 0, failedRows: 0, errors: [] };
  }
  if (file.size <= 0 || file.size > MAX_BULK_FILE_BYTES) {
    return { success: false, message: "حجم الملف غير صالح أو يتجاوز 5 ميجابايت", successfulRows: 0, failedRows: 0, errors: [] };
  }

  const rateLimitError = await checkRateLimit(`bulk-cash-claim:${session.id}`, "import");
  if (rateLimitError) {
    return { success: false, message: rateLimitError, successfulRows: 0, failedRows: 0, errors: [] };
  }

  const buffer = await file.arrayBuffer();
  const fileHash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  let rows: Record<string, unknown>[];
  try {
    const wb = XLSX.read(buffer, { type: "array", dense: true });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) throw new Error("EMPTY_WORKBOOK");
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], { defval: "", raw: true });
  } catch {
    return { success: false, message: "تعذر قراءة الملف؛ تأكد أنه ملف Excel أو CSV سليم", successfulRows: 0, failedRows: 0, errors: [] };
  }

  if (!rows || rows.length === 0) {
    return { success: false, message: "الملف فارغ أو لا يحتوي على بيانات صحيحة", successfulRows: 0, failedRows: 0, errors: [] };
  }
  if (rows.length > MAX_BULK_ROWS) {
    return { success: false, message: `عدد الصفوف يتجاوز الحد المسموح (${MAX_BULK_ROWS})`, successfulRows: 0, failedRows: rows.length, errors: [] };
  }

  // مفتاح التكرار لتجنب إعادة رفع نفس الملف مرتين بالخطأ
  const cashClaimKey = buildIdempotencyKey("cash-claim-bulk", session.id, fileHash)!;
  const alreadyImported = await prisma.transaction.findFirst({
    where: { idempotency_key: { startsWith: `${cashClaimKey}:` } },
    select: { id: true },
  });
  if (alreadyImported) {
    return { success: false, message: "تم استيراد هذا الملف مسبقاً؛ لم يُنفذ أي خصم جديد", successfulRows: 0, failedRows: 0, errors: [] };
  }

  const errors: BulkImportResult["errors"] = [];
  let successfulRows = 0;

  // استخراج البطاقات للاستعلام المسبق (لتحسين الأداء)
  const requiredCards = [...new Set(rows.map(r => normalizeCardInput(String(r["رقم البطاقة"] || r["رقم بطاقة العائلة"] || ""))))].filter(Boolean);

  const beneficiaries = await prisma.beneficiary.findMany({
    where: {
      card_number: { in: requiredCards },
      deleted_at: null
    },
    select: { id: true, card_number: true, remaining_balance: true, status: true, name: true }
  });

  const benMap = new Map(beneficiaries.map(b => [b.card_number.toUpperCase(), b]));

  // تجهيز البيانات
  const validTransactions: Array<{
    beneficiary_id: string;
    card_number: string;
    amount: number;
    type: "GENERAL" | "MEDICINE";
    idempotency_key: string;
    rowNumber: number;
    beneficiary_name: string;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // +1 for index, +1 for header

    const rawCard = String(row["رقم البطاقة"] || row["رقم بطاقة العائلة"] || "");
    const card = normalizeCardInput(rawCard);
    const sourceBeneficiaryName = String(row["اسم المستفيد"] || row["اسم صاحب البطاقة"] || "").trim();
    
    // التعامل مع المبلغ من عدة قوالب محتملة (القالب المبسط أو الملف الذي أرسله المستخدم)
    const rawAmountValue = row["المبلغ"] !== undefined ? row["المبلغ"] : row["الدفعة"] !== undefined ? row["الدفعة"] : "";
    const rawAmount = typeof rawAmountValue === "number" || typeof rawAmountValue === "string" ? rawAmountValue : String(rawAmountValue ?? "");
    const amount = Number(rawAmountValue);
    
    const rawServiceType = String(row["نوع الخدمة (كشف/أدوية)"] || row["نوع الخدمة"] || "").trim().toUpperCase();

    let serviceType: "GENERAL" | "MEDICINE" | null = null;
    if (rawServiceType.includes("كشف") || rawServiceType.includes("GENERAL")) serviceType = "GENERAL";
    else if (rawServiceType.includes("دواء") || rawServiceType.includes("أدوية") || rawServiceType.includes("MEDICINE")) serviceType = "MEDICINE";

    if (!card) {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: sourceBeneficiaryName, amount: rawAmount, serviceType: rawServiceType, reason: "رقم البطاقة مفقود", errorCode: "INVALID_CARD" });
      continue;
    }

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_DEDUCTION_AMOUNT) {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: sourceBeneficiaryName, amount: rawAmount, serviceType: rawServiceType, reason: "المبلغ غير صالح", errorCode: "INVALID_AMOUNT" });
      continue;
    }
    if (!Number.isInteger(amount)) {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: sourceBeneficiaryName, amount: rawAmount, serviceType: rawServiceType, reason: "المبلغ يجب أن يكون عدداً صحيحاً بدون كسور", errorCode: "INVALID_AMOUNT" });
      continue;
    }

    if (!serviceType) {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: sourceBeneficiaryName, amount: rawAmount, serviceType: rawServiceType, reason: "نوع الخدمة غير معروف (يجب أن يكون 'كشف' أو 'أدوية')", errorCode: "INVALID_SERVICE" });
      continue;
    }

    const ben = benMap.get(card);
    if (!ben) {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: sourceBeneficiaryName, amount, serviceType: rawServiceType, reason: "رقم البطاقة غير موجود في النظام", errorCode: "CARD_NOT_FOUND" });
      continue;
    }

    if (ben.status === "SUSPENDED") {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: ben.name || sourceBeneficiaryName, amount, serviceType: rawServiceType, reason: "المستفيد موقوف", errorCode: "SUSPENDED" });
      continue;
    }

    if (ben.status === "FINISHED" || Number(ben.remaining_balance) <= 0) {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: ben.name || sourceBeneficiaryName, amount, serviceType: rawServiceType, reason: "رصيد المستفيد نفد", errorCode: "BALANCE_EXHAUSTED" });
      continue;
    }

    if (amount > Number(ben.remaining_balance)) {
      errors.push({ row: rowNumber, cardNumber: rawCard, beneficiaryName: ben.name || sourceBeneficiaryName, amount, serviceType: rawServiceType, reason: `المبلغ (${amount}) يتجاوز الرصيد المتبقي (${Number(ben.remaining_balance)})`, errorCode: "AMOUNT_EXCEEDS_BALANCE" });
      continue;
    }

    validTransactions.push({
      beneficiary_id: ben.id,
      card_number: ben.card_number,
      amount: roundCurrency(amount),
      type: serviceType,
      idempotency_key: `${cashClaimKey}:${rowNumber}`,
      rowNumber,
      beneficiary_name: ben.name || sourceBeneficiaryName,
    });
  }

  // تجميع الحركات للمستفيد الواحد لاكتشاف الرصيد السلبي المحتمل ضمن نفس الملف
  const balancesToDeduct = new Map<string, number>();
  for (const t of validTransactions) {
    const current = balancesToDeduct.get(t.beneficiary_id) || 0;
    balancesToDeduct.set(t.beneficiary_id, current + t.amount);
  }

  for (const t of validTransactions) {
    const ben = benMap.get(t.card_number.toUpperCase())!;
    const totalDeduction = balancesToDeduct.get(t.beneficiary_id) || 0;
    if (totalDeduction > Number(ben.remaining_balance)) {
      errors.push({ row: t.rowNumber, cardNumber: t.card_number, beneficiaryName: t.beneficiary_name, amount: t.amount, serviceType: t.type, reason: `مجموع حركات البطاقة بالملف (${totalDeduction}) يتجاوز الرصيد المتبقي (${Number(ben.remaining_balance)})`, errorCode: "FILE_TOTAL_EXCEEDS_BALANCE" });
      // Remove from valid
      t.amount = -1; // Flag for deletion
    }
  }

  const finalValid = validTransactions.filter(t => t.amount !== -1);

  if (finalValid.length === 0) {
    return { 
      success: false, 
      message: "جميع الصفوف تحتوي على أخطاء ولم يتم تنفيذ أي عملية.", 
      successfulRows: 0, 
      failedRows: errors.length, 
      errors 
    };
  }

  const emittedNotifications: Array<{ beneficiaryId: string; payload: NotificationPayload }> = [];

  // Execution Phase (Transaction)
  try {
    const executionResult = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.transaction.findFirst({
        where: { idempotency_key: { startsWith: `${cashClaimKey}:` } },
        select: { id: true },
      });
      if (duplicate) throw new Error("BULK_FILE_ALREADY_IMPORTED");

      // Lock beneficiaries
      const ids = [...new Set(finalValid.map(v => v.beneficiary_id))];
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string }>>`
        SELECT id, remaining_balance, status 
        FROM "Beneficiary" 
        WHERE id = ANY(${ids}::text[])
        AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      const lockedMap = new Map(locked.map(l => [l.id, l]));

      // إعادة التحقق بعد القفل لمنع الخصم المتزامن من إنتاج رصيد سالب.
      const lockedTotals = new Map<string, number>();
      for (const item of finalValid) {
        lockedTotals.set(item.beneficiary_id, roundCurrency((lockedTotals.get(item.beneficiary_id) ?? 0) + item.amount));
      }
      for (const [beneficiaryId, total] of lockedTotals) {
        const lockedBeneficiary = lockedMap.get(beneficiaryId);
        if (!lockedBeneficiary) throw new Error("BULK_BENEFICIARY_CHANGED");
        if (lockedBeneficiary.status === "SUSPENDED") throw new Error("BULK_BENEFICIARY_SUSPENDED");
        if (lockedBeneficiary.status === "FINISHED" || Number(lockedBeneficiary.remaining_balance) <= 0) {
          throw new Error("BULK_BENEFICIARY_FINISHED");
        }
        if (total > Number(lockedBeneficiary.remaining_balance)) throw new Error("BULK_BALANCE_CHANGED");
      }

      const notifications: Array<{ beneficiaryId: string; payload: NotificationPayload }> = [];
      let inserted = 0;

      for (const item of finalValid) {
        const ben = lockedMap.get(item.beneficiary_id);
        if (!ben) throw new Error("BULK_BENEFICIARY_CHANGED");

        const balanceBefore = Number(ben.remaining_balance);
        const newBalance = roundCurrency(balanceBefore - item.amount);
        const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

        // Update beneficiary
        await tx.beneficiary.update({
          where: { id: item.beneficiary_id },
          data: {
            remaining_balance: newBalance,
            status: newStatus,
            ...(newStatus === "FINISHED" ? { completed_via: "MANUAL" } : {}),
          }
        });

        // Update map to track changes for subsequent transactions in same block
        lockedMap.set(item.beneficiary_id, { ...ben, remaining_balance: newBalance, status: newStatus });

        // Create transaction
        const transaction = await tx.transaction.create({
          data: {
            beneficiary_id: item.beneficiary_id,
            facility_id: session.id,
            amount: item.amount,
            type: item.type,
            idempotency_key: item.idempotency_key
          }
        });

        const notification = await tx.notification.create({
          data: {
            beneficiary_id: item.beneficiary_id,
            title: "تم خصم من رصيدك",
            message: `تم خصم ${formatCurrency(item.amount)} د.ل (استيراد كاش كليم)`,
            amount: item.amount,
          },
        });
        notifications.push({
          beneficiaryId: item.beneficiary_id,
          payload: {
            id: notification.id,
            title: "تم خصم من رصيدك",
            message: `تم خصم ${formatCurrency(item.amount)} د.ل (استيراد كاش كليم)`,
            amount: item.amount,
            remaining_balance: newBalance,
            created_at: new Date().toISOString(),
            transaction: {
              id: transaction.id,
              amount: item.amount,
              type: item.type,
              created_at: transaction.created_at.toISOString(),
              facility_name: session.name,
            },
          },
        });
        inserted++;
      }

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_CASH_CLAIM_IMPORT",
          metadata: {
            source_file: file.name.slice(0, 255),
            file_sha256: fileHash,
            total_rows: rows.length,
            imported_rows: inserted,
            rejected_rows: errors.length,
            imported_total: roundCurrency(finalValid.reduce((sum, item) => sum + item.amount, 0)),
          },
        },
      });

      await assertBeneficiariesBalanceInvariant(tx, ids, "processBulkCashClaim");
      return { inserted, notifications };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    successfulRows = executionResult.inserted;
    emittedNotifications.push(...executionResult.notifications);
    for (const item of emittedNotifications) emitNotification(item.beneficiaryId, item.payload);

    revalidatePath("/transactions");
    revalidatePath("/cash-claim");

    return {
      success: true,
      message: `تم استيراد ${successfulRows} حركة بنجاح.`,
      successfulRows,
      failedRows: errors.length,
      errors
    };

  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "UNKNOWN";
    const safeMessage = detail === "BULK_FILE_ALREADY_IMPORTED"
      ? "تم استيراد هذا الملف مسبقاً؛ لم يُنفذ أي خصم جديد"
      : detail.startsWith("BULK_")
        ? "تغيرت حالة مستفيد أو رصيده أثناء الاستيراد؛ لم يُنفذ أي صف. حدّث الملف وحاول مجدداً"
        : "حدث خطأ أثناء حفظ البيانات في قاعدة البيانات؛ لم يُنفذ أي صف";
    return {
      success: false,
      message: safeMessage,
      successfulRows: 0,
      failedRows: errors.length,
      errors
    };
  }
}

const CALIBRATABLE_CODES = new Set<BulkImportResult["errors"][number]["errorCode"]>([
  "BALANCE_EXHAUSTED",
  "AMOUNT_EXCEEDS_BALANCE",
  "FILE_TOTAL_EXCEEDS_BALANCE",
]);

export async function calibrateBulkCashClaimErrors(
  submittedErrors: BulkImportResult["errors"],
  requestId: string,
): Promise<{ success?: string; error?: string; resolvedRows: number; resolvedSourceRows: number[]; unresolvedFamilies: string[] }> {
  const session = await requireActiveFacilitySession();
  if (!session || (!session.is_admin && !hasPermission(session, "cash_claim_import"))) {
    return { error: "غير مصرح لك بهذه العملية", resolvedRows: 0, resolvedSourceRows: [], unresolvedFamilies: [] };
  }

  const calibratable = submittedErrors
    .filter((item) => CALIBRATABLE_CODES.has(item.errorCode))
    .slice(0, MAX_BULK_ROWS);
  if (calibratable.length === 0) return { error: "لا توجد أخطاء رصيد قابلة للمعايرة", resolvedRows: 0, resolvedSourceRows: [], unresolvedFamilies: [] };

  const groups = new Map<string, { baseCard: string; type: "GENERAL" | "MEDICINE"; amount: number; rows: number[] }>();
  for (const item of calibratable) {
    const amount = Number(item.amount);
    const baseCard = extractBaseCard(normalizeCardInput(item.cardNumber));
    const normalizedService = item.serviceType.toUpperCase();
    const type = normalizedService.includes("كشف") || normalizedService.includes("GENERAL")
      ? "GENERAL"
      : normalizedService.includes("دواء") || normalizedService.includes("أدوية") || normalizedService.includes("MEDICINE")
        ? "MEDICINE"
        : null;
    if (!baseCard || !type || !Number.isInteger(amount) || amount <= 0 || amount > MAX_DEDUCTION_AMOUNT) {
      return { error: `بيانات الصف ${item.row} غير صالحة للمعايرة`, resolvedRows: 0, resolvedSourceRows: [], unresolvedFamilies: [] };
    }
    const key = `${baseCard}|${type}`;
    const current = groups.get(key) ?? { baseCard, type, amount: 0, rows: [] };
    current.amount += amount;
    current.rows.push(item.row);
    groups.set(key, current);
  }

  const calibrationKey = buildIdempotencyKey("cash-claim-calibration", session.id, requestId);
  if (!calibrationKey) return { error: "معرف طلب المعايرة غير صالح", resolvedRows: 0, resolvedSourceRows: [], unresolvedFamilies: [] };

  const resolvedSourceRows: number[] = [];
  const unresolvedFamilies: string[] = [];
  const allNotifications: Array<{ beneficiaryId: string; payload: NotificationPayload }> = [];

  for (const group of groups.values()) {
    const familyKey = `${calibrationKey}:${group.baseCard}:${group.type}`;
    try {
      const notifications = await prisma.$transaction(async (tx) => {
        const existing = await tx.transaction.findFirst({
          where: { idempotency_key: { startsWith: `${familyKey}:` } },
          select: { id: true },
        });
        if (existing) throw new Error("CALIBRATION_ALREADY_APPLIED");

        const possibleMembers = await tx.beneficiary.findMany({
        where: {
          deleted_at: null,
          status: "ACTIVE",
          card_number: { startsWith: group.baseCard, mode: "insensitive" },
        },
        select: { id: true, card_number: true, name: true, remaining_balance: true },
      });
      const memberIds = possibleMembers.map((member) => member.id);
      if (memberIds.length === 0) throw new Error("CALIBRATION_NO_BALANCE");

      const locked = await tx.$queryRaw<Array<{ id: string; card_number: string; name: string; remaining_balance: number; status: string }>>`
        SELECT id, card_number, name, remaining_balance, status
        FROM "Beneficiary"
        WHERE id = ANY(${memberIds}::text[]) AND deleted_at IS NULL
        FOR UPDATE
      `;
      const notifications: Array<{ beneficiaryId: string; payload: NotificationPayload }> = [];
      const affectedIds = new Set<string>();
      let allocationIndex = 0;

      const familyMembers = locked
          .filter((member) => member.status === "ACTIVE")
          .filter((member) => extractBaseCard(member.card_number) === group.baseCard)
          .filter((member) => Number(member.remaining_balance) > 0)
          .sort((a, b) => Number(b.remaining_balance) - Number(a.remaining_balance));
        const available = familyMembers.reduce((sum, member) => sum + Number(member.remaining_balance), 0);
        if (available < group.amount) throw new Error(`CALIBRATION_FAMILY_INSUFFICIENT|${group.baseCard}`);

        let remaining = group.amount;
        for (const member of familyMembers) {
          if (remaining <= 0) break;
          const currentBalance = Number(member.remaining_balance);
          const amount = Math.min(remaining, Math.floor(currentBalance));
          if (amount <= 0) continue;
          const newBalance = roundCurrency(currentBalance - amount);
          await tx.beneficiary.update({
            where: { id: member.id },
            data: { remaining_balance: newBalance, status: newBalance <= 0 ? "FINISHED" : "ACTIVE", ...(newBalance <= 0 ? { completed_via: "MANUAL" } : {}) },
          });
          const transaction = await tx.transaction.create({
            data: {
              beneficiary_id: member.id,
              facility_id: session.id,
              amount,
              type: group.type,
              idempotency_key: `${familyKey}:${allocationIndex++}`,
            },
          });
          const notification = await tx.notification.create({
            data: {
              beneficiary_id: member.id,
              title: "تم خصم من رصيدك",
              message: `تم خصم ${formatCurrency(amount)} د.ل بعد معايرة كاش كليم للعائلة`,
              amount,
            },
          });
          notifications.push({
            beneficiaryId: member.id,
            payload: {
              id: notification.id,
              title: "تم خصم من رصيدك",
              message: `تم خصم ${formatCurrency(amount)} د.ل بعد معايرة كاش كليم للعائلة`,
              amount,
              remaining_balance: newBalance,
              created_at: notification.created_at.toISOString(),
              transaction: { id: transaction.id, amount, type: group.type, created_at: transaction.created_at.toISOString(), facility_name: session.name },
            },
          });
          member.remaining_balance = newBalance;
          remaining -= amount;
          affectedIds.add(member.id);
        }
        if (remaining !== 0) throw new Error(`CALIBRATION_FAMILY_INSUFFICIENT|${group.baseCard}`);
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "CALIBRATE_BULK_CASH_CLAIM",
          metadata: {
            resolved_rows: group.rows.length,
            family: { base_card: group.baseCard, type: group.type, amount: group.amount, source_rows: group.rows },
          },
        },
      });
      await assertBeneficiariesBalanceInvariant(tx, [...affectedIds], "calibrateBulkCashClaimErrors");
        return notifications;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      resolvedSourceRows.push(...group.rows);
      allNotifications.push(...notifications);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "CALIBRATION_ALREADY_APPLIED") {
        resolvedSourceRows.push(...group.rows);
      } else {
        unresolvedFamilies.push(group.baseCard);
      }
    }
  }

  for (const item of allNotifications) emitNotification(item.beneficiaryId, item.payload);
  revalidatePath("/cash-claim");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  const resolvedRows = resolvedSourceRows.length;
  if (resolvedRows === 0) {
    return { error: `لم تنجح المعايرة؛ الأرصدة غير الكافية للعائلات: ${unresolvedFamilies.join("، ")}`, resolvedRows: 0, resolvedSourceRows: [], unresolvedFamilies };
  }
  const suffix = unresolvedFamilies.length > 0
    ? ` وبقيت ${unresolvedFamilies.length} عائلة غير كافية الرصيد`
    : "";
  return { success: `تمت معايرة ${resolvedRows} صف بنجاح${suffix}`, resolvedRows, resolvedSourceRows, unresolvedFamilies };
}
