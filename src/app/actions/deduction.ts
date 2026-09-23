"use server";

import prisma from "@/lib/prisma";
import { deductionSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { emitNotification } from "@/lib/sse-notifications";
import { formatCurrency } from "@/lib/money";
import { normalizeCardInput } from "@/lib/card-number";
import { assertBeneficiaryBalanceInvariant, buildIdempotencyKey, calculateBeneficiaryBalance, settleBeneficiaryBalance } from "@/lib/tx-balance-guard";
import { InsuranceEngine } from "@/lib/insurance/engine";
import { findCompanyByCardNumber, getServiceTypeMapping } from "@/lib/insurance/company-matcher";
import type { TpaValidation } from "@/lib/insurance/shadow-mode";
import { WAHDA_BANK_COMPANY_ID } from "@/lib/constants";
import { calculatePhysiotherapySessions } from "@/lib/physiotherapy-sessions";
import { assertWithinCeiling, assertWithinSessionLimit, isCeilingExceeded, ceilingRejectionMessage } from "@/lib/insurance/ceiling-guard";
import { getCappedConsumption, type WalletType } from "@/lib/insurance/consumption";
import { getFiscalYear } from "@/lib/insurance/fiscal-year";
import { resolveWalletPolicy } from "@/lib/insurance/policy";

export async function deductBalance(formData: {
  beneficiary_id?: string;
  card_number: string;
  amount: number;
  type: "MEDICINE" | "SUPPLIES" | "GENERAL" | "DENTAL" | "OPTICS" | "PHYSIOTHERAPY" | "EQUESTRIAN";
  transactionDate?: Date;
  facilityId?: string;
  requestId?: string;
  dentalSubCategory?: string;
}) {
  const session = await requireActiveFacilitySession();
  const canDeduct = !!session && !session.is_employee && (!session.is_manager || hasPermission(session, "deduct_balance"));
  if (!canDeduct) {
    return { error: "غير مصرح لك بهذه العملية (خصم الرصيد)" };
  }

  let effectiveFacilityId = session.id;
  let effectiveFacilityName = session.name;
  const requestedFacilityId = typeof formData.facilityId === "string" ? formData.facilityId.trim() : "";

  if (requestedFacilityId) {
    if (!session.is_admin && !session.is_manager && requestedFacilityId !== session.id) {
      return { error: "غير مصرح لك باختيار هذا المرفق" };
    }

    const targetFacility = await prisma.facility.findFirst({
      where: { id: requestedFacilityId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!targetFacility) {
      return { error: "المرفق المحدد غير موجود" };
    }

    effectiveFacilityId = targetFacility.id;
    effectiveFacilityName = targetFacility.name;
  }

  const rateLimitError = await checkRateLimit(`deduct:${session.id}`, "deduct");
  if (rateLimitError) return { error: rateLimitError };

  const normalizedCard = normalizeCardInput(formData.card_number ?? "");
  const beneficiaryIdInput = typeof formData.beneficiary_id === "string" ? formData.beneficiary_id.trim() : "";

  const validated = deductionSchema.safeParse({
    ...formData,
    card_number: normalizedCard,
  });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { card_number, amount, type } = validated.data;
  const dentalSubCategory = formData.dentalSubCategory;

  if (!session.is_admin) {
    if (session.facility_type === "PHARMACY" && type !== "MEDICINE") {
      return { error: "حسابات الصيدليات لا يمكنها تنفيذ سوى خدمة صرف الدواء" };
    }
    if (session.facility_type === "DENTAL" && type !== "DENTAL") {
      return { error: "حسابات عيادات الأسنان لا يمكنها تنفيذ سوى خدمات الأسنان" };
    }
    if (session.facility_type === "OPTICS" && type !== "OPTICS" && type !== "PHYSIOTHERAPY") {
      return { error: "حسابات مراكز البصريات لا يمكنها تنفيذ سوى خدمات العيون والبصريات" };
    }
    if (session.facility_type === "PHYSIOTHERAPY" && type !== "PHYSIOTHERAPY") {
      return { error: "حسابات مراكز العلاج الطبيعي لا يمكنها تنفيذ سوى خدمات العلاج الطبيعي" };
    }
    if (session.facility_type === "EQUESTRIAN" && type !== "EQUESTRIAN") {
      return { error: "حسابات الفروسية لا يمكنها تنفيذ سوى خدمات الفروسية" };
    }
  }

  const manualTransactionDate =
    formData.transactionDate instanceof Date && !Number.isNaN(formData.transactionDate.getTime())
      ? formData.transactionDate
      : null;

  if (manualTransactionDate && !session.is_admin && !session.is_manager) {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(0, 0, 0, 0);
    if (manualTransactionDate.getTime() < threeDaysAgo.getTime()) {
      return { error: "لا يمكن تسجيل حركات بتاريخ قديم يتجاوز 3 أيام لغير المشرفين" };
    }
  }

  const idempotencyKey = buildIdempotencyKey("deduct", session.id, formData.requestId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.transaction.findUnique({
          where: { idempotency_key: idempotencyKey },
          select: { id: true, beneficiary_id: true },
        });

        if (existing) {
          const beneficiary = await tx.beneficiary.findUnique({
            where: { id: existing.beneficiary_id },
            select: { remaining_balance: true },
          });

          return {
            success: true,
            duplicated: true,
            newBalance: Number(beneficiary?.remaining_balance ?? 0),
            beneficiaryId: existing.beneficiary_id,
            notificationId: "",
            transaction: undefined,
          };
        }
      }

      // 1. Get beneficiary with row-level lock (using raw sql as Prisma interactive tx isn't always enough for specific locking locks)
      // On PostgreSQL, we can use SELECT ... FOR UPDATE
      const beneficiaries = beneficiaryIdInput
        ? await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; company_id: string | null; remaining_balance: number; total_balance: number; status: string; custom_ceilings: any }>>`
          SELECT id, name, card_number, company_id, remaining_balance, total_balance::float8, status, custom_ceilings FROM "Beneficiary"
          WHERE id = ${beneficiaryIdInput}
            AND "deleted_at" IS NULL
          LIMIT 1
          FOR UPDATE
        `
        : await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; company_id: string | null; remaining_balance: number; total_balance: number; status: string; custom_ceilings: any }>>`
          SELECT id, name, card_number, company_id, remaining_balance, total_balance::float8, status, custom_ceilings FROM "Beneficiary"
          WHERE TRANSLATE(
            REGEXP_REPLACE(UPPER(card_number), '[^A-Z0-9٠-٩۰-۹]+', '', 'g'),
            '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
            '01234567890123456789'
          ) = TRANSLATE(
            REGEXP_REPLACE(UPPER(${card_number}), '[^A-Z0-9٠-٩۰-۹]+', '', 'g'),
            '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
            '01234567890123456789'
          )
          AND "deleted_at" IS NULL
          ORDER BY created_at DESC
          LIMIT 2
          FOR UPDATE
        `;

      if (beneficiaries.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      if (!beneficiaryIdInput && beneficiaries.length > 1) {
        throw new Error("يوجد أكثر من سجل بنفس رقم البطاقة. يرجى دمج التكرار أولاً قبل الخصم.");
      }

      const beneficiary = beneficiaries[0];

      // [TPA] Identify Company via card pattern matching
      let companyId = beneficiary.company_id;
      if (!companyId) {
        const companyMatch = await findCompanyByCardNumber(beneficiary.card_number);
        companyId = companyMatch?.id || null;
      }

      // قيد عزل صارم: الخدمات الطبية العامة (دواء وكشف عام) مقصورة على منتسبي مصرف الوحدة فقط
      if (!["DENTAL", "OPTICS", "PHYSIOTHERAPY", "EQUESTRIAN"].includes(type) && companyId && companyId !== WAHDA_BANK_COMPANY_ID) {
        throw new Error("هذا المستفيد يتبع شركة تأمين خاصة بالأسنان والبصريات فقط. الخدمات العامة مقصورة على مصرف الوحدة.");
      }

      // [TPA] Calculate Annual Consumption for this Category
      const fiscalYear = getFiscalYear(manualTransactionDate || new Date());

      // Resolve service type mapping (e.g. MEDICINE → GENERAL for shared ceiling)
      const policyServiceType = companyId
        ? await getServiceTypeMapping(companyId, type)
        : type;

      const consumedThisYear = await getCappedConsumption(tx, {
        beneficiaryId: beneficiary.id,
        walletType: policyServiceType as WalletType,
        fiscalYear,
      });

      // [TPA] Fetch Company (Policy consolidated on InsuranceCompany)
      const company = companyId ? await tx.insuranceCompany.findUnique({
        where: { id: companyId },
        include: {
          service_policies: {
            include: { service_type: true }
          }
        }
      }) : null;

      // رفض الخصم إذا كانت الشركة غير فعالة
      if (company && !company.is_active) {
        throw new Error("شركة التأمين التابع لها هذا المستفيد غير مفعلة حالياً");
      }

      const policyRecord = company
        ? resolveWalletPolicy({
            company,
            customCeilings: beneficiary.custom_ceilings,
            walletType: policyServiceType as WalletType,
            dentalSubCategory,
          })
        : null;

      if (type === "DENTAL" && !policyRecord) {
        throw new Error("لا توجد سياسة أسنان (DENTAL) نشطة ومُعرّفة لهذه الشركة. لا يمكن إتمام الخصم.");
      }

      if (type === "OPTICS" && !policyRecord) {
        throw new Error("لا توجد سياسة بصريات (OPTICS) نشطة ومُعرّفة لهذه الشركة. لا يمكن إتمام الخصم.");
      }
      if (type === "PHYSIOTHERAPY" && !policyRecord) {
        throw new Error("لا توجد سياسة علاج طبيعي (PHYSIOTHERAPY) نشطة ومُعرّفة لهذه الشركة. لا يمكن إتمام الخصم.");
      }
      if (type === "EQUESTRIAN" && !policyRecord) {
        throw new Error("لا توجد سياسة فروسية (EQUESTRIAN) نشطة ومُعرّفة لهذه الشركة. لا يمكن إتمام الخصم.");
      }

      let tpaData: Record<string, unknown> = {};
      if (policyRecord) {
        const effectiveCeiling = policyRecord.annual_ceiling;

        if (type === "PHYSIOTHERAPY") {
          const sessionResult = calculatePhysiotherapySessions({
            sessions: amount,
            consumedBefore: consumedThisYear,
            limit: effectiveCeiling,
          });

          assertWithinSessionLimit(sessionResult);

          tpaData = {
            company_id: companyId,
            service_category: "PHYSIOTHERAPY",
            original_company_share: amount,
            original_patient_share: 0,
            actual_company_share: amount,
            actual_patient_share: 0,
            remaining_ceiling_before: sessionResult.remainingBefore,
            ceiling_consumed: sessionResult.sessions,
            remaining_ceiling_after: sessionResult.remainingAfter,
            consumed_before: sessionResult.consumedBefore,
            consumed_after: sessionResult.consumedAfter,
            policy_snapshot: JSON.parse(JSON.stringify(policyRecord)),
            calc_metadata: {
              calculationUnit: "SESSION",
              financialCoverageApplied: false,
              sessionLimit: sessionResult.limit,
              exceededSessions: sessionResult.exceededSessions,
            },
          };
        } else {
          const calcResult = InsuranceEngine.calculate({
            amount,
            consumedThisYear,
            policy: {
              serviceType: policyRecord.service_type,
              annualCeiling: effectiveCeiling,
              copayPercentage: policyRecord.copay_percentage,
              allowPartialCoverage: true
            }
          });

          assertWithinCeiling(calcResult, policyRecord.service_type);

          // Validate: patient share must not exceed remaining balance
          const patientShare = Number(calcResult.actualPatientShare);
          const remainingBalance = Number(beneficiary.remaining_balance);
          const tpaValidation: TpaValidation = {
            patientShareAffordable: patientShare <= remainingBalance,
            patientShare,
            remainingBalance,
            amount,
          };

          tpaData = {
            company_id: companyId,
            service_category: type === "DENTAL" && dentalSubCategory ? dentalSubCategory : policyServiceType,
            original_company_share: calcResult.originalCompanyShare,
            original_patient_share: calcResult.originalPatientShare,
            actual_company_share: calcResult.actualCompanyShare,
            actual_patient_share: calcResult.actualPatientShare,
            remaining_ceiling_before: calcResult.remainingCeilingBefore,
            ceiling_consumed: calcResult.ceilingConsumed,
            remaining_ceiling_after: calcResult.remainingCeilingAfter,
            consumed_before: calcResult.consumedBefore,
            consumed_after: calcResult.consumedAfter,
            policy_snapshot: JSON.parse(JSON.stringify(policyRecord)),
            calc_metadata: { ...calcResult.metadata, tpaValidation },
          };
        }
      } else if (companyId) {
        // Silent fallback tracked: company found but no policy — store basic info
        tpaData = {
          company_id: companyId,
          service_category: type === "DENTAL" && dentalSubCategory ? dentalSubCategory : policyServiceType,
          calc_metadata: { tpaApplied: false, reason: "no_policy" },
        };
      }

      // FIX: منع الخصم من المستفيدين الموقوفين (SUSPENDED) أيضاً
      if (beneficiary.status === "SUSPENDED") {
        throw new Error("حساب المستفيد موقوف ولا يمكن إجراء خصم عليه");
      }
      if (beneficiary.status === "FINISHED" && !["DENTAL", "OPTICS", "PHYSIOTHERAPY", "EQUESTRIAN"].includes(type)) {
        throw new Error("حساب المستفيد مكتمل ولا يمكن الخصم من الرصيد الأساسي");
      }

      // المبلغ الفعلي الذي تتكفل به الشركة (Company Share)
      const companyShare = tpaData.actual_company_share != null
        ? Number(tpaData.actual_company_share)
        : amount;

      // خصم الخدمات ذات السياسات المستقلة معزول تماماً عن الرصيد الأساسي (remaining_balance)
      const touchesBaseBalance = !["DENTAL", "OPTICS", "PHYSIOTHERAPY", "EQUESTRIAN"].includes(type);

      // الرصيد المتاح يُقرأ من الدفتر لا من الحقل المخزَّن، حتى لا يُبنى قرار على قيمة منجرفة.
      const ledgerBefore = touchesBaseBalance
        ? (await calculateBeneficiaryBalance(tx, beneficiary.id)).remaining_balance
        : Number(beneficiary.remaining_balance);
      if (touchesBaseBalance && companyShare > ledgerBefore) {
        throw new Error(`القيمة المطلوبة من الشركة (${formatCurrency(companyShare)}) أكبر من الرصيد المتاح للمخصص (${formatCurrency(ledgerBefore)} د.ل)`);
      }

      if (companyId && !beneficiary.company_id) {
        await tx.beneficiary.update({
          where: { id: beneficiary.id },
          data: { company_id: companyId },
        });
      }

      // 3. Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          beneficiary_id: beneficiary.id,
          facility_id: effectiveFacilityId,
          amount,
          type,
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
          ...(manualTransactionDate ? { created_at: manualTransactionDate } : {}),
          ...tpaData // Inject TPA financial details
        },
      });

      // 3.0 تسوية الرصيد من الدفتر (الخدمات المعزولة لا تغيّره، فتعود بنفس القيمة)
      const settled = touchesBaseBalance
        ? await settleBeneficiaryBalance(tx, beneficiary.id, { completedVia: "MANUAL" })
        : { balanceBefore: ledgerBefore, balanceAfter: ledgerBefore, statusBefore: beneficiary.status, statusAfter: beneficiary.status };
      const balanceBefore = settled.balanceBefore;
      const newBalance = settled.balanceAfter;
      const newStatus = settled.statusAfter;

      // 3.1 Create in-app notification
      const notificationTitle = type === "PHYSIOTHERAPY" ? "تم تسجيل جلسات علاج طبيعي" : "تم خصم من رصيدك";
      const notificationMessage = type === "PHYSIOTHERAPY"
        ? `تم تسجيل ${Number(amount).toLocaleString("ar-LY")} جلسة علاج طبيعي لدى ${effectiveFacilityName}`
        : `تم خصم ${formatCurrency(Number(amount))} د.ل من رصيدك لدى ${effectiveFacilityName}`;
      const notification = await tx.notification.create({
        data: {
          beneficiary_id: beneficiary.id,
          title: notificationTitle,
          message: notificationMessage,
          amount,
        },
      });

      // 4. Create audit log
      await tx.auditLog.create({
        data: {
          facility_id: effectiveFacilityId,
          user: session.username,
          action: "DEDUCT_BALANCE",
          metadata: {
            beneficiary_name: beneficiary.name,
            card_number,
            amount,
            type,
            balance_before: balanceBefore,
            balance_after: newBalance,
            transaction_id: transaction.id,
            facility_id: effectiveFacilityId,
            facility_name: effectiveFacilityName,
            ...(manualTransactionDate ? { transaction_date: manualTransactionDate.toISOString() } : {}),
            ...(newStatus === "FINISHED" ? { beneficiary_completed: true } : {}),
          },
        },
      });

      await assertBeneficiaryBalanceInvariant(tx, beneficiary.id, "deductBalance");

      return {
        success: true,
        duplicated: false,
        newBalance,
        beneficiaryId: beneficiary.id,
        notificationId: notification.id,
        companyId: transaction.company_id,
        transaction: {
          id: transaction.id,
          amount: Number(transaction.amount),
          type: transaction.type,
          created_at: transaction.created_at.toISOString(),
          facility_name: effectiveFacilityName,
        },
      };
    });

    if (!result.duplicated) {
      const notificationTitle = type === "PHYSIOTHERAPY" ? "تم تسجيل جلسات علاج طبيعي" : "تم خصم من رصيدك";
      const notificationMessage = type === "PHYSIOTHERAPY"
        ? `تم تسجيل ${Number(amount).toLocaleString("ar-LY")} جلسة علاج طبيعي لدى ${effectiveFacilityName}`
        : `تم خصم ${formatCurrency(Number(amount))} د.ل من رصيدك لدى ${effectiveFacilityName}`;
      emitNotification(result.beneficiaryId, {
        id: result.notificationId,
        title: notificationTitle,
        message: notificationMessage,
        amount,
        remaining_balance: result.newBalance,
        created_at: new Date().toISOString(),
        transaction: result.transaction,
      });
    }

    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    return {
      success: true,
      newBalance: result.newBalance,
      isTpa: result.companyId != null,
    };
  } catch (error: unknown) {
    logger.error("Deduction error", { error: String(error) });

    const msg = error instanceof Error ? error.message : "";
    const mapDeductionError = (rawMessage: string): string => {
      if (!rawMessage) return "تعذر تنفيذ عملية الخصم";

      // يظهر عندما لا تتطابق الأرصدة المخزنة مع دفتر الحركات
      if (rawMessage.includes("BALANCE_GUARD_INVARIANT_FAILED")) {
        return "فشل التحقق من سلامة الرصيد (عدم تطابق بين الرصيد المخزن والحركات). يلزم مراجعة/إعادة احتساب الأرصدة.";
      }
      if (rawMessage.includes("BASE_BALANCE_OVERDRAWN")) {
        return "دفتر حركات هذا المستفيد يتجاوز رصيده الكلي أصلاً؛ لا يمكن الخصم قبل مراجعة حركاته.";
      }

      // السماح بتمرير جميع رسائل الأخطاء الخاصة بالمنظومة (التي كتبناها باللغة العربية)
      const isArabicMessage = /[\u0600-\u06FF]/.test(rawMessage);
      if (isArabicMessage && !rawMessage.includes("PrismaClient") && !rawMessage.includes("Invalid `prisma")) {
        return rawMessage;
      }

      // سباق تزامن على idempotency_key (طلب مكرر بنفس requestId)
      if (rawMessage.includes("P2002")) {
        return "تم اكتشاف طلب مكرر أو تعارض تزامن. أعد المحاولة بنفس requestId أو حدّث الصفحة.";
      }

      return "تعذر تنفيذ عملية الخصم";
    };

    // سجل الخطأ في AuditLog
    let sessionForAudit: Awaited<ReturnType<typeof requireActiveFacilitySession>> | null = null;
    let auditErrorId: string | null = null;
    try {
      sessionForAudit = await requireActiveFacilitySession();
      const audit = await prisma.auditLog.create({
        data: {
          facility_id: sessionForAudit?.id ?? null,
          user: sessionForAudit?.username ?? "anonymous",
          action: "DEDUCT_BALANCE_ERROR",
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            // SEC-B FIX: Removed stack trace logging to prevent leaking internal file paths
            card_number: formData.card_number,
            beneficiary_id: beneficiaryIdInput || undefined,
            amount: formData.amount,
            type: formData.type,
            transactionDate: formData.transactionDate,
            facilityId: formData.facilityId,
            requestId: formData.requestId,
          },
        },
      });
      auditErrorId = audit.id;
    } catch (auditError) {
      logger.error("Failed to write deduction error to audit log", { error: String(auditError) });
    }

    const detailedReason = mapDeductionError(msg);

    // للمشرف: أعرض السبب الحقيقي + مرجع السجل للتتبع السريع
    if (sessionForAudit?.is_admin) {
      const withRef = auditErrorId
        ? `${detailedReason} (مرجع التتبع: ${auditErrorId})`
        : detailedReason;
      return { error: withRef };
    }

    // لغير المشرف: نحافظ على رسالة آمنة، مع مرجع داخلي عند توفره
    const publicMessage = detailedReason === "تعذر تنفيذ عملية الخصم"
      ? (auditErrorId ? `تعذر تنفيذ عملية الخصم (مرجع: ${auditErrorId})` : detailedReason)
      : detailedReason;

    return { error: publicMessage };
  }
}

/**
 * جلب أنواع الخدمات المفعلة لشركة المستفيد
 */
export async function getAvailableServiceTypes(beneficiaryId: string) {
  const session = await requireActiveFacilitySession();
  if (!session) return { serviceTypes: [] };

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { company_id: true, card_number: true }
    });
    if (!beneficiary) return { serviceTypes: [] };

    let companyId = beneficiary.company_id;
    if (!companyId) {
      const companyMatch = await findCompanyByCardNumber(beneficiary.card_number);
      companyId = companyMatch?.id || null;
    }
    if (!companyId) return { serviceTypes: [] };

    const company = await prisma.insuranceCompany.findUnique({
      where: { id: companyId },
      select: {
        service_type_mappings: true,
      }
    });
    if (!company) return { serviceTypes: [] };

    // All companies support GENERAL, MEDICINE, and DENTAL under consolidated model
    const policyTypes = new Set<string>(["DENTAL", "EQUESTRIAN", "GENERAL", "MEDICINE"]);
    const mappings = company.service_type_mappings as Record<string, string> | null;
    const allTypes = ["GENERAL", "MEDICINE", "DENTAL", "OPTICS", "PHYSIOTHERAPY", "EQUESTRIAN", "SUPPLIES"];
    let available = allTypes.filter(st => {
      const mapped = mappings?.[st] ?? st;
      return policyTypes.has(mapped);
    });

    if (!session.is_admin) {
      if (session.facility_type === "PHARMACY") {
        available = available.filter(t => t === "MEDICINE");
      } else if (session.facility_type === "DENTAL") {
        available = available.filter(t => t === "DENTAL");
      } else if (session.facility_type === "OPTICS") {
        available = available.filter(t => t === "OPTICS");
      } else if (session.facility_type === "PHYSIOTHERAPY") {
        available = ["PHYSIOTHERAPY"];
      } else if (session.facility_type === "EQUESTRIAN") {
        available = ["EQUESTRIAN"];
      }
    }

    return { serviceTypes: available };
  } catch {
    return { serviceTypes: [] };
  }
}

/**
 * الحصول على معلومات سياسة TPA للمستفيد (خفيف، بدون حساب)
 */
export async function getPolicyInfo(beneficiaryId: string, serviceType: string, dentalSubCategory?: string) {
  const session = await requireActiveFacilitySession();
  if (!session) return { isTpa: false };

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
      include: { company: true }
    });
    if (!beneficiary) return { isTpa: false };

    let companyId = beneficiary.company_id;
    if (!companyId) {
      const companyMatch = await findCompanyByCardNumber(beneficiary.card_number);
      companyId = companyMatch?.id || null;
    }
    if (!companyId) return { isTpa: false };

    const policyServiceType = await getServiceTypeMapping(companyId, serviceType);
    // beneficiary.company لا يحمل service_policies، فتُقرأ الشركة دائماً بسياساتها كما في التنفيذ.
    const company = await prisma.insuranceCompany.findUnique({
      where: { id: companyId },
      include: { service_policies: { include: { service_type: true } } },
    });
    if (!company || !company.is_active || company.deleted_at !== null) return { isTpa: false };

    const resolved = resolveWalletPolicy({
      company,
      customCeilings: beneficiary.custom_ceilings,
      walletType: policyServiceType as WalletType,
      dentalSubCategory,
    });
    const isConfigured = resolved !== null;
    const ceiling = resolved?.annual_ceiling ?? null;
    const copayPercentage = resolved?.copay_percentage ?? 0;

    if (!isConfigured) return { isTpa: false };

    const consumed = await getCappedConsumption(prisma, {
      beneficiaryId,
      walletType: policyServiceType as WalletType,
      fiscalYear: getFiscalYear(new Date()),
    });

    return {
      isTpa: true,
      ceiling,
      consumed,
      companyName: company?.name || "",
      copayPercentage: ceiling === null ? 0 : copayPercentage,
    };
  } catch {
    return { isTpa: false };
  }
}

/**
 * محاكاة عملية الخصم (Preview)
 * ===========================
 * تستخدم لعرض النتائج المتوقعة للموظف قبل التنفيذ الفعلي.
 */
export async function simulateDeduction(data: {
  beneficiary_id: string;
  amount: number;
  service_type: string;
  transactionDate?: Date;
  dentalSubCategory?: string;
}) {
  const session = await requireActiveFacilitySession();
  if (!session) return { error: "انتهت الجلسة" };

  try {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id: data.beneficiary_id },
      include: { company: true }
    });

    if (!beneficiary) return { error: "المستفيد غير موجود" };

    let companyId = beneficiary.company_id;
    if (!companyId) {
      const companyMatch = await findCompanyByCardNumber(beneficiary.card_number);
      companyId = companyMatch?.id || null;
    }

    if (!companyId) return { isLegacy: true, remainingBalance: Number(beneficiary.remaining_balance) };

    const policyServiceType = companyId
      ? await getServiceTypeMapping(companyId, data.service_type)
      : data.service_type;

    const company = await prisma.insuranceCompany.findUnique({
      where: { id: companyId },
      include: { service_policies: { include: { service_type: true } } },
    });
    if (!company || !company.is_active || company.deleted_at !== null) {
      return { isLegacy: true, remainingBalance: Number(beneficiary.remaining_balance) };
    }

    const resolved = resolveWalletPolicy({
      company,
      customCeilings: beneficiary.custom_ceilings,
      walletType: policyServiceType as WalletType,
      dentalSubCategory: data.dentalSubCategory,
    });
    const isConfigured = resolved !== null;
    const ceiling = resolved?.annual_ceiling ?? null;
    const copayPercentage = resolved?.copay_percentage ?? 0;

    if (!isConfigured) {
      return { isLegacy: true, remainingBalance: Number(beneficiary.remaining_balance) };
    }

    // Validate policy effective dates
    const serviceDate = data.transactionDate || new Date();

    const consumedThisYear = await getCappedConsumption(prisma, {
      beneficiaryId: beneficiary.id,
      walletType: policyServiceType as WalletType,
      fiscalYear: getFiscalYear(serviceDate),
    });

    const calcResult = InsuranceEngine.calculate({
      amount: data.amount,
      consumedThisYear,
      policy: {
        serviceType: policyServiceType,
        annualCeiling: ceiling,
        copayPercentage,
        allowPartialCoverage: true
      }
    });

    // المعاينة لا ترمي خطأ؛ تُبلّغ الواجهة لتعطّل زر التأكيد قبل الإرسال.
    const blocked = isCeilingExceeded(calcResult);

    return {
      success: true,
      isTpa: true,
      calcResult,
      blocked,
      blockReason: blocked ? ceilingRejectionMessage(calcResult, policyServiceType) : undefined,
      beneficiaryName: beneficiary.name,
      companyName: beneficiary.company?.name || ""
    };

  } catch (_error) {
    return { error: "خطأ في المحاكاة" };
  }
}
