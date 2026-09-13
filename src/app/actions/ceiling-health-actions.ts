"use server";

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { resolveVerifiedSuperAdminActor } from "@/lib/super-admin-actor";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { roundCurrency } from "@/lib/money";
import { InsuranceEngine } from "@/lib/insurance/engine";
import { getFiscalYearBounds } from "@/lib/insurance/fiscal-year";

type BackgroundActor = {
  id: string;
  username: string;
  isAdmin: true;
};

/**
 * الفئات المشمولة بتصحيح آلي: خدمات ذات سقف مالي محسوب عبر InsuranceEngine
 * (وليست جلسات علاج طبيعي، ذات منطق عد مختلف تماماً).
 */
const DENTAL_CATEGORIES = ["DENTAL", "DENTAL_ORTHO", "DENTAL_IMPLANT", "DENTAL_PROSTHETICS"] as const;
const CAPPED_CATEGORIES_SCOPE = [...DENTAL_CATEGORIES, "OPTICS"] as const;

async function resolveServiceTypeIds(): Promise<{ dentalId: string | null; opticsId: string | null }> {
  const types = await prisma.serviceType.findMany({
    where: { code: { in: ["DENTAL", "OPTICS"] } },
    select: { id: true, code: true },
  });
  return {
    dentalId: types.find((t) => t.code === "DENTAL")?.id ?? null,
    opticsId: types.find((t) => t.code === "OPTICS")?.id ?? null,
  };
}

/**
 * يبني جزء SQL موحّد لاكتشاف حركات تجاوز السقف بثلاث فئات:
 * (أ) حركة طُبّق عليها سقف لكنها متناقضة داخلياً (حصة الشركة الفعلية ≠ المستهلك من السقف،
 *     أو المستهلك التراكمي تجاوز السقف المسجَّل وقتها).
 * (ب) حركة لم يُطبَّق عليها أي سقف إطلاقاً (policy_snapshot فارغ أو سقفه "بلا حدود")
 *     رغم وجود سياسة سقف فعلية للشركة الآن لنفس الخدمة.
 * (ج) حركة طُبّق عليها سقف "مسجَّل" في وقتها، لكنه لا يطابق سياسة السقف الفعلية الحالية
 *     للشركة لنفس الخدمة (سقف قديم/تالف محفوظ على الحركة اختلف عن السياسة المُحدَّثة لاحقاً —
 *     وهذا ما وقع فعلياً حين بقي total_balance/سقف قديم على مستفيد لم يُزامَن بعد تعديل السقف).
 * في كل الفئات: يُستثنى المستفيد الذي له سقف استثنائي صريح (custom_ceilings) لهذه الخدمة،
 * لأن ذلك تجاوز مقصود من الإدارة وليس عطلاً.
 */
function buildDetectionWhereFragment() {
  return Prisma.sql`
    t.is_cancelled = false
    AND t.service_category = ANY(${CAPPED_CATEGORIES_SCOPE as unknown as string[]}::text[])
    AND (
      (
        t.policy_snapshot IS NOT NULL
        AND (
          ABS(COALESCE(t.actual_company_share, 0) - COALESCE(t.ceiling_consumed, 0)) > 0.01
          OR (
            (t.policy_snapshot->>'annual_ceiling') IS NOT NULL
            AND COALESCE(t.consumed_after, 0) > (t.policy_snapshot->>'annual_ceiling')::numeric + 0.01
          )
        )
      )
      OR (
        (t.policy_snapshot IS NULL OR (t.policy_snapshot->>'annual_ceiling') IS NULL)
        AND (
          (
            t.service_category IN ('DENTAL', 'DENTAL_ORTHO', 'DENTAL_IMPLANT', 'DENTAL_PROSTHETICS')
            AND dp.ceiling_amount IS NOT NULL
            AND NOT (COALESCE(b.custom_ceilings, '{}'::jsonb) ? 'DENTAL')
          )
          OR (
            t.service_category = 'OPTICS'
            AND op.ceiling_amount IS NOT NULL
            AND NOT (COALESCE(b.custom_ceilings, '{}'::jsonb) ? 'OPTICS')
          )
        )
      )
      OR (
        t.policy_snapshot IS NOT NULL
        AND (t.policy_snapshot->>'annual_ceiling') IS NOT NULL
        AND (
          (
            t.service_category IN ('DENTAL', 'DENTAL_ORTHO', 'DENTAL_IMPLANT', 'DENTAL_PROSTHETICS')
            AND dp.ceiling_amount IS NOT NULL
            AND NOT (COALESCE(b.custom_ceilings, '{}'::jsonb) ? 'DENTAL')
            AND ABS((t.policy_snapshot->>'annual_ceiling')::numeric - dp.ceiling_amount) > 0.01
          )
          OR (
            t.service_category = 'OPTICS'
            AND op.ceiling_amount IS NOT NULL
            AND NOT (COALESCE(b.custom_ceilings, '{}'::jsonb) ? 'OPTICS')
            AND ABS((t.policy_snapshot->>'annual_ceiling')::numeric - op.ceiling_amount) > 0.01
          )
        )
      )
    )
  `;
}

function buildPolicyJoinsFragment(dentalId: string | null, opticsId: string | null) {
  return Prisma.sql`
    LEFT JOIN "ServicePolicy" dp ON dp.company_id = t.company_id AND dp.is_active = true AND dp.service_type_id = ${dentalId}
    LEFT JOIN "ServicePolicy" op ON op.company_id = t.company_id AND op.is_active = true AND op.service_type_id = ${opticsId}
  `;
}

export type CeilingExceededRow = {
  id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  company_name: string | null;
  facility_name: string;
  service_category: string;
  amount: number;
  actual_company_share: number | null;
  actual_patient_share: number | null;
  ceiling_consumed: number | null;
  annual_ceiling: number | null;
  consumed_after: number | null;
  excess_amount: number;
  policy_applied: boolean;
  created_at: Date;
};

export type CeilingExceededCheckResult = {
  success: boolean;
  count: number;
  total_excess: number;
  error?: string;
};

export async function checkCeilingExceededAction(companyId?: string): Promise<CeilingExceededCheckResult> {
  const session = await resolveVerifiedSuperAdminActor();
  if (!session) {
    return { success: false, count: 0, total_excess: 0, error: "غير مصرح" };
  }

  try {
    const { dentalId, opticsId } = await resolveServiceTypeIds();
    const joins = buildPolicyJoinsFragment(dentalId, opticsId);
    const whereFragment = buildDetectionWhereFragment();

    const rows = await prisma.$queryRaw<Array<{ cnt: number; total_excess: number }>>`
      SELECT
        COUNT(*)::int AS cnt,
        COALESCE(SUM(
          GREATEST(
            ABS(COALESCE(t.actual_company_share, 0) - COALESCE(t.ceiling_consumed, 0)),
            GREATEST(0, COALESCE(t.consumed_after, 0) - COALESCE((t.policy_snapshot->>'annual_ceiling')::numeric, 999999999)),
            GREATEST(0, COALESCE(t.consumed_after, 0) - COALESCE(dp.ceiling_amount, op.ceiling_amount, 999999999))
          )
        ), 0)::float8 AS total_excess
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      ${joins}
      WHERE ${whereFragment}
        AND (${companyId ?? null}::text IS NULL OR t.company_id = ${companyId ?? null})
    `;

    return {
      success: true,
      count: Number(rows[0]?.cnt ?? 0),
      total_excess: roundCurrency(Number(rows[0]?.total_excess ?? 0)),
    };
  } catch (err) {
    console.error("[checkCeilingExceededAction]", err);
    return { success: false, count: 0, total_excess: 0, error: "تعذر فحص تجاوزات السقف" };
  }
}

export async function listCeilingExceededAction(companyId: string, limit = 500): Promise<{
  success: boolean;
  rows: CeilingExceededRow[];
  error?: string;
}> {
  const session = await resolveVerifiedSuperAdminActor();
  if (!session) {
    return { success: false, rows: [], error: "غير مصرح" };
  }

  try {
    const { dentalId, opticsId } = await resolveServiceTypeIds();
    const joins = buildPolicyJoinsFragment(dentalId, opticsId);
    const whereFragment = buildDetectionWhereFragment();

    const rows = await prisma.$queryRaw<CeilingExceededRow[]>`
      SELECT
        t.id,
        t.beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        c.name AS company_name,
        f.name AS facility_name,
        t.service_category,
        t.amount::float8 AS amount,
        t.actual_company_share::float8 AS actual_company_share,
        t.actual_patient_share::float8 AS actual_patient_share,
        t.ceiling_consumed::float8 AS ceiling_consumed,
        COALESCE(dp.ceiling_amount::float8, op.ceiling_amount::float8, (t.policy_snapshot->>'annual_ceiling')::float8) AS annual_ceiling,
        t.consumed_after::float8 AS consumed_after,
        (t.policy_snapshot IS NOT NULL AND (t.policy_snapshot->>'annual_ceiling') IS NOT NULL) AS policy_applied,
        -- فرق الانجراف الحقيقي: هل تجاوز الاستهلاك التراكمي الفعلي السقف الحقيقي الحالي؟
        -- (وليس مجرد فارق بين الرقم المؤرشف على الحركة والسياسة الحالية، فقد يكون الأرشيف قديماً
        -- دون أن يترتب عليه أي تجاوز مالي فعلي).
        GREATEST(
          ABS(COALESCE(t.actual_company_share, 0) - COALESCE(t.ceiling_consumed, 0)),
          GREATEST(0, COALESCE(t.consumed_after, 0) - COALESCE((t.policy_snapshot->>'annual_ceiling')::numeric, 999999999)),
          GREATEST(0, COALESCE(t.consumed_after, 0) - COALESCE(dp.ceiling_amount, op.ceiling_amount, 999999999))
        )::float8 AS excess_amount,
        t.created_at
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      LEFT JOIN "InsuranceCompany" c ON c.id = t.company_id
      JOIN "Facility" f ON f.id = t.facility_id
      ${joins}
      WHERE ${whereFragment}
        AND t.company_id = ${companyId}
      ORDER BY excess_amount DESC, t.created_at DESC
      LIMIT ${limit}
    `;

    return { success: true, rows };
  } catch (err) {
    console.error("[listCeilingExceededAction]", err);
    return { success: false, rows: [], error: "تعذر جلب حركات تجاوز السقف" };
  }
}

export type FixCeilingExceededResult = {
  success: boolean;
  groups_processed: number;
  transactions_corrected: number;
  total_recovered: number;
  error?: string;
};

type ResolvedPolicy = { annualCeiling: number | null; copayPercentage: number } | null;

/** يحل السياسة الحالية الفعلية (سقف الشركة أو السقف الاستثنائي للمستفيد) لفئة خدمة معينة. */
async function resolveCurrentPolicy(
  companyId: string,
  customCeilings: unknown,
  categoryGroup: string,
  policyCache: Map<string, ResolvedPolicy>,
): Promise<ResolvedPolicy> {
  const cacheKey = `${companyId}:${categoryGroup}`;
  if (policyCache.has(cacheKey)) return policyCache.get(cacheKey) ?? null;

  const servicePolicy = await prisma.servicePolicy.findFirst({
    where: {
      company_id: companyId,
      is_active: true,
      service_type: { code: categoryGroup },
    },
  });

  let annualCeiling: number | null = servicePolicy?.ceiling_amount != null ? Number(servicePolicy.ceiling_amount) : null;
  const copayPercentage = servicePolicy ? Math.max(0, 100 - Number(servicePolicy.coverage_percent)) : 0;

  if (customCeilings && typeof customCeilings === "object" && categoryGroup in (customCeilings as Record<string, unknown>)) {
    const cVal = (customCeilings as Record<string, unknown>)[categoryGroup];
    annualCeiling = cVal === null || cVal === undefined ? null : Number(cVal);
  }

  const resolved = servicePolicy || annualCeiling !== null ? { annualCeiling, copayPercentage } : null;
  policyCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * يعيد احتساب كل حركات الأسنان/البصريات المتأثرة لكل (مستفيد + فئة + سنة مالية)
 * بالترتيب الزمني عبر InsuranceEngine. يعتمد على policy_snapshot المحفوظ في كل حركة
 * وقت إنشائها متى وُجد؛ وعندما تكون الحركة قد نُفّذت أصلاً دون تطبيق أي سقف (عطل سابق
 * كان يحسبها "بلا حدود" افتراضياً)، يستخدم السياسة الفعلية الحالية للشركة/المستفيد
 * كأساس لإعادة الاحتساب ويُثبّتها في الحركة كـ policy_snapshot صحيح من الآن فصاعداً.
 * يُحدّث فقط الحقول المالية للحركة نفسها (لا تأثير على remaining_balance الأساسي؛
 * الأسنان/البصريات محفظة سقف منفصلة تماماً عن الرصيد الأساسي).
 */
export async function fixCeilingExceededAction(
  actor?: BackgroundActor,
  companyId?: string,
): Promise<FixCeilingExceededResult> {
  const session = await resolveVerifiedSuperAdminActor(actor);
  if (!session) {
    return { success: false, groups_processed: 0, transactions_corrected: 0, total_recovered: 0, error: "غير مصرح" };
  }

  try {
    const { dentalId, opticsId } = await resolveServiceTypeIds();
    const joins = buildPolicyJoinsFragment(dentalId, opticsId);
    const whereFragment = buildDetectionWhereFragment();

    const affected = await prisma.$queryRaw<Array<{ beneficiary_id: string; category_group: string; fiscal_year: number }>>`
      SELECT DISTINCT
        t.beneficiary_id,
        CASE
          WHEN t.service_category IN ('DENTAL', 'DENTAL_ORTHO', 'DENTAL_IMPLANT', 'DENTAL_PROSTHETICS') THEN 'DENTAL'
          ELSE t.service_category
        END AS category_group,
        EXTRACT(YEAR FROM (t.created_at AT TIME ZONE 'Africa/Tripoli'))::int AS fiscal_year
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      ${joins}
      WHERE ${whereFragment}
        AND (${companyId ?? null}::text IS NULL OR t.company_id = ${companyId ?? null})
    `;

    if (affected.length === 0) {
      return { success: true, groups_processed: 0, transactions_corrected: 0, total_recovered: 0 };
    }

    type PendingUpdate = { id: string; data: Record<string, unknown> };
    const updates: PendingUpdate[] = [];
    const scopesLog: Record<string, unknown>[] = [];
    let totalRecovered = 0;
    const policyCache = new Map<string, ResolvedPolicy>();

    for (const scope of affected) {
      const categories = scope.category_group === "DENTAL" ? [...DENTAL_CATEGORIES] : [scope.category_group];
      const { start, end } = getFiscalYearBounds(scope.fiscal_year);

      const txs = await prisma.transaction.findMany({
        where: {
          beneficiary_id: scope.beneficiary_id,
          is_cancelled: false,
          type: { not: "CANCELLATION" },
          service_category: { in: categories },
          created_at: { gte: start, lte: end },
        },
        include: { beneficiary: { select: { company_id: true, custom_ceilings: true } } },
        orderBy: { created_at: "asc" },
      });

      let runningConsumed = 0;
      const groupUpdates: PendingUpdate[] = [];

      for (const tx of txs) {
        let annualCeiling: number | null;
        let copayPercentage: number;
        let usedFallbackPolicy = false;

        const snapshot = tx.policy_snapshot as Record<string, unknown> | null;
        const snapshotCeiling =
          snapshot && snapshot.annual_ceiling !== undefined
            ? snapshot.annual_ceiling === null
              ? null
              : Number(snapshot.annual_ceiling)
            : undefined;

        // نحل السياسة الفعلية الحالية دائماً لنقارنها بما هو محفوظ على الحركة —
        // فالحركة قد تحمل سقفاً "مسجَّلاً" لكنه تالف أو أُهمِل تحديثه بعد تعديل سياسة الشركة.
        const companyIdForTx = tx.company_id ?? tx.beneficiary.company_id;
        const resolved = companyIdForTx
          ? await resolveCurrentPolicy(companyIdForTx, tx.beneficiary.custom_ceilings, scope.category_group, policyCache)
          : null;

        const snapshotDisagrees =
          resolved !== null &&
          resolved.annualCeiling !== null &&
          (snapshotCeiling === undefined || snapshotCeiling === null || Math.abs(snapshotCeiling - resolved.annualCeiling) > 0.01);

        if (snapshotDisagrees) {
          annualCeiling = resolved!.annualCeiling;
          copayPercentage = resolved!.copayPercentage;
          usedFallbackPolicy = true;
        } else if (snapshotCeiling !== undefined) {
          annualCeiling = snapshotCeiling;
          copayPercentage = Number(snapshot?.copay_percentage ?? 0);
        } else if (resolved) {
          annualCeiling = resolved.annualCeiling;
          copayPercentage = resolved.copayPercentage;
          usedFallbackPolicy = true;
        } else {
          continue; // لا يوجد سقف مسجَّل ولا سياسة حالية يمكن الاعتماد عليها؛ يُترك للمراجعة اليدوية.
        }

        const calcResult = InsuranceEngine.calculate({
          amount: Number(tx.amount),
          consumedThisYear: runningConsumed,
          policy: {
            serviceType: scope.category_group,
            annualCeiling,
            copayPercentage,
            allowPartialCoverage: true,
          },
        });

        runningConsumed += calcResult.ceilingConsumed;

        const prevCompanyShare = tx.actual_company_share != null ? Number(tx.actual_company_share) : 0;
        const prevCeilingConsumed = tx.ceiling_consumed != null ? Number(tx.ceiling_consumed) : 0;
        const prevConsumedAfter = tx.consumed_after != null ? Number(tx.consumed_after) : 0;

        const changed =
          usedFallbackPolicy ||
          Math.abs(prevCompanyShare - calcResult.actualCompanyShare) > 0.01 ||
          Math.abs(prevCeilingConsumed - calcResult.ceilingConsumed) > 0.01 ||
          Math.abs(prevConsumedAfter - calcResult.consumedAfter) > 0.01;

        if (changed) {
          groupUpdates.push({
            id: tx.id,
            data: {
              actual_company_share: calcResult.actualCompanyShare,
              actual_patient_share: calcResult.actualPatientShare,
              ceiling_consumed: calcResult.ceilingConsumed,
              remaining_ceiling_before: calcResult.remainingCeilingBefore,
              remaining_ceiling_after: calcResult.remainingCeilingAfter,
              consumed_before: calcResult.consumedBefore,
              consumed_after: calcResult.consumedAfter,
              ...(usedFallbackPolicy
                ? {
                    policy_snapshot: {
                      service_type: scope.category_group,
                      annual_ceiling: annualCeiling,
                      copay_percentage: copayPercentage,
                      allow_partial_coverage: true,
                    },
                  }
                : {}),
              calc_metadata: {
                ...(typeof tx.calc_metadata === "object" && tx.calc_metadata !== null ? tx.calc_metadata : {}),
                ceilingCorrection: {
                  correctedAt: new Date().toISOString(),
                  correctedBy: session.username,
                  previousActualCompanyShare: prevCompanyShare,
                  previousCeilingConsumed: prevCeilingConsumed,
                  usedFallbackPolicy,
                },
              },
            },
          });
          totalRecovered += prevCompanyShare - calcResult.actualCompanyShare;
        }
      }

      if (groupUpdates.length > 0) {
        updates.push(...groupUpdates);
        scopesLog.push({
          beneficiary_id: scope.beneficiary_id,
          category_group: scope.category_group,
          fiscal_year: scope.fiscal_year,
          corrected_count: groupUpdates.length,
        });
      }
    }

    if (updates.length === 0) {
      return { success: true, groups_processed: affected.length, transactions_corrected: 0, total_recovered: 0 };
    }

    // دفعات محدودة الحجم لتفادي تجاوز حد المعاملة الواحدة على قواعد بيانات كبيرة.
    const BATCH_SIZE = 200;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(
        batch.map((u) => prisma.transaction.update({ where: { id: u.id }, data: u.data })),
      );
    }

    await prisma.auditLog.create({
      data: {
        user: session.username,
        action: AUDIT_ACTIONS.CEILING_EXCEEDED_FIX,
        company_id: companyId ?? null,
        metadata: {
          groups_processed: affected.length,
          transactions_corrected: updates.length,
          total_recovered: roundCurrency(totalRecovered),
          scopes: scopesLog,
        },
      },
    });

    return {
      success: true,
      groups_processed: affected.length,
      transactions_corrected: updates.length,
      total_recovered: roundCurrency(totalRecovered),
    };
  } catch (err) {
    console.error("[fixCeilingExceededAction]", err);
    return {
      success: false,
      groups_processed: 0,
      transactions_corrected: 0,
      total_recovered: 0,
      error: "حدث خطأ أثناء تصحيح تجاوزات السقف",
    };
  }
}
