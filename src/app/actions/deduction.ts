"use server";

import prisma from "@/lib/prisma";
import { deductionSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { TransactionType } from "@prisma/client";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { emitNotification } from "@/lib/sse-notifications";
import { formatCurrency, roundCurrency } from "@/lib/money";
import { normalizeCardInput } from "@/lib/card-number";
import { assertBeneficiaryBalanceInvariant, buildIdempotencyKey } from "@/lib/tx-balance-guard";
import { InsuranceEngine } from "@/lib/insurance/engine";
import { findCompanyByCardNumber, getServiceTypeMapping } from "@/lib/insurance/company-matcher";
import type { TpaValidation } from "@/lib/insurance/shadow-mode";
import { WAHDA_BANK_COMPANY_ID } from "@/lib/constants";

export async function deductBalance(formData: {
  beneficiary_id?: string;
  card_number: string;
  amount: number;
  type: "MEDICINE" | "SUPPLIES" | "GENERAL" | "DENTAL" | "OPTICS";
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
    if (session.facility_type === "OPTICS" && type !== "OPTICS") {
      return { error: "حسابات مراكز البصريات لا يمكنها تنفيذ سوى خدمات العيون والبصريات" };
    }
  }

  const manualTransactionDate =
    formData.transactionDate instanceof Date && !Number.isNaN(formData.transactionDate.getTime())
      ? formData.transactionDate
      : null;

  if (manualTransactionDate && !session.is_admin) {
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
        ? await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; company_id: string | null; remaining_balance: number; total_balance: number; status: string }>>`
          SELECT id, name, card_number, company_id, remaining_balance, total_balance::float8, status FROM "Beneficiary"
          WHERE id = ${beneficiaryIdInput}
            AND "deleted_at" IS NULL
          LIMIT 1
          FOR UPDATE
        `
        : await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; company_id: string | null; remaining_balance: number; total_balance: number; status: string }>>`
          SELECT id, name, card_number, company_id, remaining_balance, total_balance::float8, status FROM "Beneficiary"
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
      if (type !== "DENTAL" && companyId && companyId !== WAHDA_BANK_COMPANY_ID) {
        throw new Error("هذا المستفيد يتبع شركة تأمين خاصة بالأسنان فقط. الخدمات العامة مقصورة على مصرف الوحدة.");
      }

      // [TPA] Calculate Annual Consumption for this Category
      const fiscalYear = InsuranceEngine.getFiscalYear(manualTransactionDate || new Date());
      const startDate = new Date(fiscalYear, 0, 1);
      const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

      // Resolve service type mapping (e.g. MEDICINE → GENERAL for shared ceiling)
      const policyServiceType = companyId
        ? await getServiceTypeMapping(companyId, type)
        : type;

      const dentalCategories = ["DENTAL", "DENTAL_ORTHO", "DENTAL_IMPLANT", "DENTAL_PROSTHETICS"];
      const targetServiceCategories = policyServiceType === "DENTAL"
        ? dentalCategories
        : [policyServiceType];

      const consumption = await tx.transaction.aggregate({
        where: {
          beneficiary_id: beneficiary.id,
          is_cancelled: false,
          created_at: { gte: startDate, lte: endDate },
          OR: [
            { service_category: { in: targetServiceCategories } },
            { service_category: null, type: policyServiceType as any }
          ]
        },
        _sum: { ceiling_consumed: true }
      });
      const consumedThisYear = Number(consumption._sum.ceiling_consumed || 0);

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

      let policyRecord: {
        service_type: string;
        annual_ceiling: number | null;
        copay_percentage: number;
        allow_partial_coverage: boolean;
      } | null = null;

      if (company) {
        let annual_ceiling: number | null = null;
        let copay_percentage = 0;
        let isConfigured = false;

        if (policyServiceType === "DENTAL") {
          const dentalPolicy = company.service_policies?.find((p: any) => p.service_type?.code === "DENTAL");
          annual_ceiling = dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null;
          
          const settings = (company as any).dental_settings ? ((company as any).dental_settings as any) : null;
          let categoryCoverage = dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100;

          if (dentalSubCategory === "DENTAL_ORTHO" && settings?.ortho?.enabled) {
            categoryCoverage = Number(settings.ortho.coverage);
          } else if (dentalSubCategory === "DENTAL_IMPLANT" && settings?.implant?.enabled) {
            categoryCoverage = Number(settings.implant.coverage);
          } else if (dentalSubCategory === "DENTAL_PROSTHETICS" && settings?.prosthetics?.enabled) {
            categoryCoverage = Number(settings.prosthetics.coverage);
          }
          
          copay_percentage = Math.max(0, 100 - categoryCoverage);
          isConfigured = !!dentalPolicy;
        } else if (policyServiceType === "GENERAL") {
          annual_ceiling = company.general_ceiling === null ? null : Number(company.general_ceiling);
          copay_percentage = Math.max(0, 100 - Number(company.general_coverage));
          isConfigured = true;
        } else if (policyServiceType === "MEDICINE") {
          annual_ceiling = company.medicine_ceiling === null ? null : Number(company.medicine_ceiling);
          copay_percentage = Math.max(0, 100 - Number(company.medicine_coverage));
          isConfigured = true;
        }

        if (isConfigured) {
          policyRecord = {
            service_type: policyServiceType,
            annual_ceiling,
            copay_percentage,
            allow_partial_coverage: true,
          };
        }
      }

      if (type === "DENTAL" && !policyRecord) {
        throw new Error("لا توجد سياسة أسنان (DENTAL) نشطة ومُعرّفة لهذه الشركة. لا يمكن إتمام الخصم.");
      }

      let tpaData: Record<string, unknown> = {};
      if (policyRecord) {
        const effectiveCeiling = policyRecord.annual_ceiling;

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
      if (beneficiary.status === "FINISHED" && type !== "DENTAL") {
        throw new Error("حساب المستفيد مكتمل ولا يمكن الخصم من الرصيد الأساسي");
      }

      // المبلغ الفعلي الذي تتكفل به الشركة (Company Share)
      const companyShare = tpaData.actual_company_share != null
        ? Number(tpaData.actual_company_share)
        : amount;

      const balanceBefore = Number(beneficiary.remaining_balance);
      let newBalance = balanceBefore;
      let newStatus: "ACTIVE" | "FINISHED" | "SUSPENDED" = beneficiary.status as any;

      // خصم الأسنان معزول تماماً عن الرصيد الأساسي للمستفيد (remaining_balance)
      // الرصيد الأساسي يخص المخصص العام للكشوفات والأدوية (مثل مصرف الوحدة)
      if (type !== "DENTAL") {
        if (companyShare > balanceBefore) {
          throw new Error(`القيمة المطلوبة من الشركة (${formatCurrency(companyShare)}) أكبر من الرصيد المتاح للمخصص (${formatCurrency(balanceBefore)} د.ل)`);
        }
        newBalance = roundCurrency(balanceBefore - companyShare);
        newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

        // 2. Update beneficiary balance (Only for non-dental)
        await tx.beneficiary.update({
          where: { id: beneficiary.id },
          data: {
            remaining_balance: newBalance,
            status: newStatus,
            ...(newStatus === "FINISHED" ? { completed_via: "MANUAL" } : {}),
            // Auto-link company if found during migration
            ...(companyId && !beneficiary.company_id ? { company_id: companyId } : {})
          },
        });
      } else {
        // للأسنان: نحدّث فقط ارتباط الشركة إن لزم الأمر دون المساس بالرصيد
        if (companyId && !beneficiary.company_id) {
          await tx.beneficiary.update({
            where: { id: beneficiary.id },
            data: { company_id: companyId },
          });
        }
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

      // 3.1 Create in-app notification
      const notification = await tx.notification.create({
        data: {
          beneficiary_id: beneficiary.id,
          title: "تم خصم من رصيدك",
          message: `تم خصم ${formatCurrency(Number(amount))} د.ل من رصيدك لدى ${effectiveFacilityName}`,
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
      emitNotification(result.beneficiaryId, {
        id: result.notificationId,
        title: "تم خصم من رصيدك",
        message: `تم خصم ${formatCurrency(Number(amount))} د.ل من رصيدك لدى ${effectiveFacilityName}`,
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

      const knownArabicMessages = [
        "المستفيد غير موجود",
        "رصيد المستفيد صفر أو مكتمل",
        "حساب المستفيد موقوف ولا يمكن إجراء خصم عليه",
        "يوجد أكثر من سجل بنفس رقم البطاقة. يرجى دمج التكرار أولاً قبل الخصم.",
      ];
      if (knownArabicMessages.includes(rawMessage)) return rawMessage;
      if (rawMessage.startsWith("المبلغ أكبر من الرصيد")) return rawMessage;

      // يظهر عندما لا تتطابق الأرصدة المخزنة مع دفتر الحركات
      if (rawMessage.startsWith("BALANCE_GUARD_INVARIANT_FAILED")) {
        return "فشل التحقق من سلامة الرصيد (عدم تطابق بين الرصيد المخزن والحركات). يلزم مراجعة/إعادة احتساب الأرصدة.";
      }

      // سباق تزامن على idempotency_key (طلب مكرر بنفس requestId)
      if (rawMessage.includes("P2002")) {
        return "تم اكتشاف طلب مكرر أو تعارض تزامن. أعد المحاولة بنفس requestId أو حدّث الصفحة.";
      }

      if (rawMessage.includes("رقم البطاقة") || rawMessage.includes("المبلغ") || rawMessage.includes("المرفق") || rawMessage.startsWith("حصة المستفيد")) {
        return rawMessage;
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
    const policyTypes = new Set<string>(["DENTAL", "GENERAL", "MEDICINE"]);
    const mappings = company.service_type_mappings as Record<string, string> | null;
    const allTypes = ["GENERAL", "MEDICINE", "DENTAL", "OPTICS", "SUPPLIES"];
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
    const company = (beneficiary.company_id && beneficiary.company) 
      ? beneficiary.company 
      : await prisma.insuranceCompany.findUnique({ 
          where: { id: companyId },
          include: { service_policies: { include: { service_type: true } } }
        });
    if (!company || !company.is_active || company.deleted_at !== null) return { isTpa: false };

    let ceiling: number | null = null;
    let copayPercentage = 0;
    let isConfigured = false;

    if (policyServiceType === "DENTAL") {
      const dentalPolicy = (company as any).service_policies?.find((p: any) => p.service_type?.code === "DENTAL");
      ceiling = dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null;
      
      const isJulian = company.code.toUpperCase() === "JULI" ||
                       company.code.toUpperCase() === "JULIANA" ||
                       company.name.includes("جوليانة") ||
                       company.name.toLowerCase().includes("julian");
      const isSpecialSubCategory = dentalSubCategory && ["DENTAL_ORTHO", "DENTAL_IMPLANT", "DENTAL_PROSTHETICS"].includes(dentalSubCategory);

      if (isJulian && isSpecialSubCategory) {
        copayPercentage = 50;
      } else {
        copayPercentage = Math.max(0, 100 - (dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100));
      }
      isConfigured = !!dentalPolicy;
    } else if (policyServiceType === "GENERAL") {
      ceiling = company.general_ceiling === null ? null : Number(company.general_ceiling);
      copayPercentage = Math.max(0, 100 - Number(company.general_coverage));
      isConfigured = true;
    } else if (policyServiceType === "MEDICINE") {
      ceiling = company.medicine_ceiling === null ? null : Number(company.medicine_ceiling);
      copayPercentage = Math.max(0, 100 - Number(company.medicine_coverage));
      isConfigured = true;
    }

    if (!isConfigured) return { isTpa: false };

    const now = new Date();
    const fiscalYear = InsuranceEngine.getFiscalYear(now);
    const startDate = new Date(fiscalYear, 0, 1);
    const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

    const dentalCategories = ["DENTAL", "DENTAL_ORTHO", "DENTAL_IMPLANT", "DENTAL_PROSTHETICS"];
    const targetServiceCategories = policyServiceType === "DENTAL"
      ? dentalCategories
      : [policyServiceType];

    const sum = await prisma.transaction.aggregate({
      where: {
        beneficiary_id: beneficiaryId,
        is_cancelled: false,
        created_at: { gte: startDate, lte: endDate },
        OR: [
          { service_category: { in: targetServiceCategories } },
          { service_category: null, type: policyServiceType as any },
        ]
      },
      _sum: { ceiling_consumed: true }
    });
    let consumed = Number(sum._sum.ceiling_consumed || 0);

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

    const company = beneficiary.company_id === companyId && beneficiary.company 
      ? beneficiary.company 
      : await prisma.insuranceCompany.findUnique({ 
          where: { id: companyId },
          include: { service_policies: { include: { service_type: true } } }
        });
    if (!company || !company.is_active || company.deleted_at !== null) {
      return { isLegacy: true, remainingBalance: Number(beneficiary.remaining_balance) };
    }

    let ceiling: number | null = null;
    let copayPercentage = 0;
    let isConfigured = false;

    if (policyServiceType === "DENTAL") {
      const dentalPolicy = (company as any).service_policies?.find((p: any) => p.service_type?.code === "DENTAL");
      ceiling = dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null;
      
      const isJulian = company.code.toUpperCase() === "JULI" ||
                       company.code.toUpperCase() === "JULIANA" ||
                       company.name.includes("جوليانة") ||
                       company.name.toLowerCase().includes("julian");
      const isSpecialSubCategory = data.dentalSubCategory && ["DENTAL_ORTHO", "DENTAL_IMPLANT", "DENTAL_PROSTHETICS"].includes(data.dentalSubCategory);

      if (isJulian && isSpecialSubCategory) {
        copayPercentage = 50;
      } else {
        copayPercentage = Math.max(0, 100 - (dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100));
      }
      isConfigured = !!dentalPolicy;
    } else if (policyServiceType === "GENERAL") {
      ceiling = company.general_ceiling === null ? null : Number(company.general_ceiling);
      copayPercentage = Math.max(0, 100 - Number(company.general_coverage));
      isConfigured = true;
    } else if (policyServiceType === "MEDICINE") {
      ceiling = company.medicine_ceiling === null ? null : Number(company.medicine_ceiling);
      copayPercentage = Math.max(0, 100 - Number(company.medicine_coverage));
      isConfigured = true;
    }

    if (!isConfigured) {
      return { isLegacy: true, remainingBalance: Number(beneficiary.remaining_balance) };
    }

    // Validate policy effective dates
    const serviceDate = data.transactionDate || new Date();

    const fiscalYear = InsuranceEngine.getFiscalYear(serviceDate);
    const startDate = new Date(fiscalYear, 0, 1);
    const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

    const dentalCategories = ["DENTAL", "DENTAL_ORTHO", "DENTAL_IMPLANT", "DENTAL_PROSTHETICS"];
    const targetServiceCategories = policyServiceType === "DENTAL"
      ? dentalCategories
      : [policyServiceType];

    const consumption = await prisma.transaction.aggregate({
      where: {
        beneficiary_id: beneficiary.id,
        is_cancelled: false,
        created_at: { gte: startDate, lte: endDate },
        OR: [
          { service_category: { in: targetServiceCategories } },
          { service_category: null, type: policyServiceType as any }
        ]
      },
      _sum: { ceiling_consumed: true }
    });

    const consumedThisYear = Number(consumption._sum.ceiling_consumed || 0);

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

    return {
      success: true,
      isTpa: true,
      calcResult,
      beneficiaryName: beneficiary.name,
      companyName: beneficiary.company?.name || ""
    };

  } catch (error) {
    return { error: "خطأ في المحاكاة" };
  }
}
