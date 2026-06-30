"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { emitNotification } from "@/lib/sse-notifications";
import { formatCurrency, roundCurrency } from "@/lib/money";
import { normalizeCardInput } from "@/lib/card-number";
import { extractBaseCard } from "@/lib/normalize";
import { assertBeneficiariesBalanceInvariant, buildIdempotencyKey } from "@/lib/tx-balance-guard";
import { Prisma } from "@prisma/client";
import { InsuranceEngine } from "@/lib/insurance/engine";
import { getServiceTypeMapping } from "@/lib/insurance/company-matcher";
import { WAHDA_BANK_COMPANY_ID } from "@/lib/constants";

// ─── نوع بيانات عضو العائلة ─────────────────────────────────────────
export type FamilyMember = {
  id: string;
  card_number: string;
  name: string;
  remaining_balance: number;
  status: string;
  eligible: boolean; // هل مؤهل للتوزيع (نشط + رصيد > 0)
};

// ─── البحث عن أفراد العائلة ──────────────────────────────────────────
export async function lookupFamily(query: string): Promise<{
  error?: string;
  members?: FamilyMember[];
  baseCard?: string;
}> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "cash_claim")) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    return { error: "أدخل اسم المستفيد أو رقم البطاقة" };
  }

  const rateLimitError = await checkRateLimit(`cash-lookup:${session.id}`, "deduct");
  if (rateLimitError) return { error: rateLimitError };

  const normalized = normalizeCardInput(trimmed);

  // البحث عن المستفيد بالاسم أو رقم البطاقة مقيداً بمصرف الوحدة أو بدون شركة
  const beneficiary = await prisma.beneficiary.findFirst({
    where: {
      deleted_at: null,
      AND: [
        {
          OR: [
            {
              card_number: {
                equals: normalized,
                mode: "insensitive",
              },
            },
            {
              name: {
                contains: trimmed,
                mode: "insensitive",
              },
            },
          ],
        },
        {
          OR: [
            { company_id: WAHDA_BANK_COMPANY_ID },
            { company_id: null }
          ]
        }
      ]
    },
    select: { id: true, card_number: true, name: true },
  });

  if (!beneficiary) {
    return { error: "لا يوجد مستفيد مطابق" };
  }

  // استخراج رقم العائلة الأساسي
  const baseCard = extractBaseCard(beneficiary.card_number.toUpperCase());

  // PERF-01 FIX: استعلام مباشر بدل جلب كل المستفيدين وتصفيتهم في الذاكرة
  // يستخدم LIKE على أول N حرف لتصفية أفراد العائلة مباشرة في قاعدة البيانات
  const familyMembers = (await prisma.$queryRaw<Array<{
    id: string;
    card_number: string;
    name: string;
    remaining_balance: number;
    status: string;
  }>>`
    SELECT id, card_number, name, remaining_balance::float8, status
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND ("company_id" = '${WAHDA_BANK_COMPANY_ID}' OR "company_id" IS NULL)
      AND UPPER(card_number) LIKE ${baseCard + "%"}
    ORDER BY remaining_balance DESC
    LIMIT 50
  `).map((m) => ({
    id: m.id,
    card_number: m.card_number,
    name: m.name,
    remaining_balance: Number(m.remaining_balance),
    status: m.status,
    eligible: m.status === "ACTIVE" && Number(m.remaining_balance) > 0,
  }));

  if (familyMembers.length === 0) {
    return { error: "لم يتم العثور على أفراد العائلة" };
  }

  return { members: familyMembers, baseCard };
}

// ─── نوع بيانات التوزيع ─────────────────────────────────────────────
export type ClaimAllocation = {
  beneficiary_id: string;
  amount: number;
};

// ─── تنفيذ الكاش (خصم من أفراد العائلة) ─────────────────────────────
export async function executeCashClaim(input: {
  allocations: ClaimAllocation[];
  invoiceTotal: number;
  facilityId?: string;
  requestId?: string;
}): Promise<{ error?: string; success?: string }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "cash_claim")) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  const { allocations, invoiceTotal } = input;
  const cashClaimKey = buildIdempotencyKey("cash-claim", session.id, input.requestId);

  // التحقق من صحة البيانات
  if (!allocations || allocations.length === 0) {
    return { error: "لا توجد مبالغ للخصم" };
  }

  if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) {
    return { error: "قيمة الفاتورة غير صالحة" };
  }

  // دمج التخصيصات المكررة لنفس المستفيد لمنع الخصم المزدوج بسبب خطأ إدخال.
  const mergedMap = new Map<string, number>();
  for (const alloc of allocations) {
    const id = String(alloc.beneficiary_id ?? "").trim();
    if (!id) {
      return { error: "يوجد مستفيد غير صالح في التوزيع" };
    }
    mergedMap.set(id, roundCurrency((mergedMap.get(id) ?? 0) + Number(alloc.amount ?? 0)));
  }
  const normalizedAllocations: ClaimAllocation[] = [...mergedMap.entries()].map(([beneficiary_id, amount]) => ({
    beneficiary_id,
    amount,
  }));

  // التحقق من أن كل المبالغ صحيحة
  for (const alloc of normalizedAllocations) {
    if (!Number.isFinite(alloc.amount) || alloc.amount <= 0) {
      return { error: "يوجد مبلغ غير صالح في التوزيع" };
    }
    // لا نسمح بأجزاء عشرية
    if (alloc.amount !== Math.floor(alloc.amount)) {
      return { error: "لا يُسمح بالمبالغ العشرية — يجب أن تكون أعدادًا صحيحة" };
    }
  }

  // التحقق من أن مجموع التوزيع = قيمة الفاتورة
  const allocationSum = roundCurrency(normalizedAllocations.reduce((s, a) => s + a.amount, 0));
  if (allocationSum !== roundCurrency(invoiceTotal)) {
    return { error: `مجموع التوزيع (${formatCurrency(allocationSum)}) لا يساوي قيمة الفاتورة (${formatCurrency(invoiceTotal)})` };
  }

  const rateLimitError = await checkRateLimit(`cash-claim:${session.id}`, "deduct");
  if (rateLimitError) return { error: rateLimitError };

  // تحديد المرفق الفعلي
  let effectiveFacilityId = session.id;
  let effectiveFacilityName = session.name;
  const requestedFacilityId = typeof input.facilityId === "string" ? input.facilityId.trim() : "";

  if (requestedFacilityId) {
    if (!session.is_admin && !session.is_manager && !session.is_employee && requestedFacilityId !== session.id) {
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (cashClaimKey && normalizedAllocations.length > 0) {
        const existing = await tx.transaction.findFirst({
          where: { idempotency_key: { startsWith: `${cashClaimKey}:` } },
          select: { id: true },
        });
        if (existing) {
          return [] as Array<{
            beneficiaryId: string;
            beneficiaryName: string;
            notificationId: string;
            transactionId: string;
            amount: number;
          }>;
        }
      }

      const beneficiaryIds = normalizedAllocations.map((a) => a.beneficiary_id);

      // قفل صفوف المستفيدين (FOR UPDATE)
      const locked = await tx.$queryRaw<
        Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string; company_id: string | null }>
      >`
        SELECT id, name, card_number, remaining_balance, status, company_id 
        FROM "Beneficiary" 
        WHERE id = ANY(${beneficiaryIds}::text[])
        AND "deleted_at" IS NULL
        FOR UPDATE
      `;

      const lockedMap = new Map(locked.map((b) => [b.id, b]));

      // التحقق من كل تخصيص
      for (const alloc of normalizedAllocations) {
        const ben = lockedMap.get(alloc.beneficiary_id);
        if (!ben) {
          throw new Error(`المستفيد غير موجود: ${alloc.beneficiary_id}`);
        }
        if (ben.status === "SUSPENDED") {
          throw new Error(`حساب ${ben.name} موقوف`);
        }
        if (ben.status === "FINISHED" || Number(ben.remaining_balance) <= 0) {
          throw new Error(`رصيد ${ben.name} صفر أو مكتمل`);
        }
        if (alloc.amount > Number(ben.remaining_balance)) {
          throw new Error(`المبلغ (${formatCurrency(alloc.amount)}) أكبر من رصيد ${ben.name} (${formatCurrency(Number(ben.remaining_balance))})`);
        }
      }

      const results: Array<{
        beneficiaryId: string;
        beneficiaryName: string;
        notificationId: string;
        transactionId: string;
        amount: number;
      }> = [];

      // خصم من كل عضو
      for (const alloc of normalizedAllocations) {
        const ben = lockedMap.get(alloc.beneficiary_id)!;
        const balanceBefore = Number(ben.remaining_balance);

        let actualPatientShare = alloc.amount;
        let tpaData: Record<string, unknown> = {};

        if (ben.company_id) {
          const type = "MEDICINE";
          const fiscalYear = InsuranceEngine.getFiscalYear(new Date());
          const startDate = new Date(fiscalYear, 0, 1);
          const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

          const policyServiceType = await getServiceTypeMapping(ben.company_id, type);

          const consumption = await tx.transaction.aggregate({
            where: {
              beneficiary_id: ben.id,
              is_cancelled: false,
              created_at: { gte: startDate, lte: endDate },
              OR: [
                { service_category: policyServiceType },
                { service_category: null, type: policyServiceType as unknown as import("@prisma/client").TransactionType }
              ]
            },
            _sum: { ceiling_consumed: true }
          });
          const consumedThisYear = Number(consumption._sum.ceiling_consumed || 0);

          const company = await tx.insuranceCompany.findUnique({
            where: { id: ben.company_id },
            include: { service_policies: { include: { service_type: true } } }
          });

          if (company && !company.is_active) {
            throw new Error(`شركة التأمين (${company.name}) غير مفعلة حالياً للعضو ${ben.name}`);
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
              const dentalPolicy = ((company as unknown) as { service_policies?: { service_type?: { code: string }, ceiling_amount?: number, coverage_percent?: number }[] }).service_policies?.find((p) => p.service_type?.code === "DENTAL");
              annual_ceiling = dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null;
              copay_percentage = Math.max(0, 100 - (dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100));
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

          if (policyRecord) {
            const effectiveCeiling = policyRecord.annual_ceiling;

            const calcResult = InsuranceEngine.calculate({
              amount: alloc.amount,
              consumedThisYear,
              policy: {
                serviceType: policyRecord.service_type,
                annualCeiling: effectiveCeiling,
                copayPercentage: policyRecord.copay_percentage,
                allowPartialCoverage: true
              }
            });

            actualPatientShare = Number(calcResult.actualPatientShare);

            tpaData = {
              company_id: ben.company_id,
              service_category: policyServiceType,
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
              calc_metadata: { ...calcResult.metadata },
            };
          } else {
            tpaData = {
              company_id: ben.company_id,
              service_category: policyServiceType,
              calc_metadata: { tpaApplied: false, reason: "no_policy" },
            };
          }
        }

        if (actualPatientShare > balanceBefore) {
          throw new Error(`حصة المستفيد (${formatCurrency(actualPatientShare)}) أكبر من رصيد ${ben.name} (${formatCurrency(balanceBefore)})`);
        }

        const newBalance = roundCurrency(balanceBefore - actualPatientShare);
        const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

        await tx.beneficiary.update({
          where: { id: alloc.beneficiary_id },
          data: {
            remaining_balance: newBalance,
            status: newStatus,
            ...(newStatus === "FINISHED" ? { completed_via: "MANUAL" } : {}),
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            beneficiary_id: alloc.beneficiary_id,
            facility_id: effectiveFacilityId,
            amount: alloc.amount,
            type: "MEDICINE",
            ...tpaData,
            ...(cashClaimKey
              ? { idempotency_key: `${cashClaimKey}:${alloc.beneficiary_id}:${alloc.amount}` }
              : {}),
          },
        });

        const notification = await tx.notification.create({
          data: {
            beneficiary_id: alloc.beneficiary_id,
            title: "تم خصم من رصيدك",
            message: `تم خصم ${formatCurrency(alloc.amount)} د.ل من رصيدك لدى ${effectiveFacilityName} (كاش عائلي)`,
            amount: alloc.amount,
          },
        });

        results.push({
          beneficiaryId: alloc.beneficiary_id,
          beneficiaryName: ben.name,
          notificationId: notification.id,
          transactionId: transaction.id,
          amount: alloc.amount,
        });
      }

      // سجل المراقبة
      await tx.auditLog.create({
        data: {
          facility_id: effectiveFacilityId,
          user: session.username,
          action: "CASH_CLAIM",
          metadata: {
            invoice_total: invoiceTotal,
            facility_id: effectiveFacilityId,
            facility_name: effectiveFacilityName,
            allocations: results.map((r) => ({
              beneficiary_id: r.beneficiaryId,
              beneficiary_name: r.beneficiaryName,
              amount: r.amount,
              transaction_id: r.transactionId,
            })),
          },
        },
      });

      await assertBeneficiariesBalanceInvariant(
        tx,
        normalizedAllocations.map((a) => a.beneficiary_id),
        "executeCashClaim",
      );

      return results;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // إرسال إشعارات لكل مستفيد
    for (const r of result) {
      emitNotification(r.beneficiaryId, {
        id: r.notificationId,
        title: "تم خصم من رصيدك",
        message: `تم خصم ${formatCurrency(r.amount)} د.ل من رصيدك لدى ${effectiveFacilityName} (كاش عائلي)`,
        amount: r.amount,
        created_at: new Date().toISOString(),
      });
    }

    revalidatePath("/cash-claim");
    revalidatePath("/transactions");
    revalidatePath("/dashboard");

    if (result.length === 0) {
      return { success: "تم تجاهل إعادة الإرسال: الطلب منفذ مسبقاً" };
    }

    return {
      success: `تم خصم الفاتورة بنجاح (${formatCurrency(invoiceTotal)} د.ل) من ${result.length} عضو`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "خطأ غير متوقع";
    logger.error("CASH_CLAIM_FAILED", {
      user: session.username,
      invoiceTotal,
      error: msg,
    });
    return { error: msg };
  }
}
