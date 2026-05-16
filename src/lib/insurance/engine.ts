import { Decimal } from "@prisma/client/runtime/library";

/**
 * محرك حسابات التأمين (Stateless Insurance Engine)
 * =============================================
 * إصدار: 1.0.0
 * مبني وفق مبادئ SOLID لضمان الدقة المالية وتعدد السياسات.
 */

export interface PolicySnapshot {
  serviceType: string;
  annualCeiling: number | null;
  copayPercentage: number;
  allowPartialCoverage: boolean;
}

export interface CalculationInput {
  amount: number;
  consumedThisYear: number;
  policy: PolicySnapshot;
}

export interface CalculationResult {
  originalCompanyShare: number;
  originalPatientShare: number;
  actualCompanyShare: number;
  actualPatientShare: number;
  remainingCeilingBefore: number;
  ceilingConsumed: number;
  remainingCeilingAfter: number;
  consumedBefore: number;
  consumedAfter: number;
  isPartialCoverage: boolean;
  metadata: {
    engineVersion: string;
    timestamp: string;
  };
}

export class InsuranceEngine {
  private static VERSION = "1.0.0";

  /**
   * حساب توزيع المبالغ بناءً على السياسة والسقف السنوي
   */
  static calculate(input: CalculationInput): CalculationResult {
    const { amount, consumedThisYear, policy } = input;
    const grossAmount = new Decimal(amount);
    const consumed = new Decimal(consumedThisYear);
    const copayFactor = new Decimal(policy.copayPercentage).div(100);

    // 1. حساب الحصص الأصلية (قبل تطبيق السقف)
    const originalPatientShare = grossAmount.mul(copayFactor);
    const originalCompanyShare = grossAmount.minus(originalPatientShare);

    // 2. حساب الرصيد المتبقي في السقف
    // إذا كان السقف null فإنه يعتبر غير محدود (Infinity)
    const isUnlimited = policy.annualCeiling === null;
    const ceiling = isUnlimited ? new Decimal(999999999) : new Decimal(policy.annualCeiling!);
    const remainingBefore = isUnlimited ? new Decimal(999999999) : Decimal.max(0, ceiling.minus(consumed));
    
    let actualCompanyShare = new Decimal(0);
    let isPartialCoverage = false;

    // 3. تطبيق السقف على حصة الشركة
    if (isUnlimited) {
      actualCompanyShare = originalCompanyShare;
    } else if (remainingBefore.gt(0)) {
      if (originalCompanyShare.lte(remainingBefore)) {
        // السقف يغطي كامل حصة الشركة الأصلية
        actualCompanyShare = originalCompanyShare;
      } else {
        // السقف يغطي جزء فقط من حصة الشركة
        actualCompanyShare = remainingBefore;
        isPartialCoverage = true;
      }
    }

    // 4. المؤمن يتحمل (حصة التحمل الأصلية + أي مبالغ لم تغطها الشركة بسبب السقف)
    const actualPatientShare = grossAmount.minus(actualCompanyShare);

    // 5. تحديث بيانات السقف المستهلك
    const ceilingConsumed = actualCompanyShare;
    const remainingAfter = isUnlimited ? new Decimal(999999999) : remainingBefore.minus(ceilingConsumed);

    return {
      originalCompanyShare: originalCompanyShare.toNumber(),
      originalPatientShare: originalPatientShare.toNumber(),
      actualCompanyShare: actualCompanyShare.toNumber(),
      actualPatientShare: actualPatientShare.toNumber(),
      remainingCeilingBefore: remainingBefore.toNumber(),
      ceilingConsumed: ceilingConsumed.toNumber(),
      remainingCeilingAfter: remainingAfter.toNumber(),
      consumedBefore: consumed.toNumber(),
      consumedAfter: consumed.add(ceilingConsumed).toNumber(),
      isPartialCoverage,
      metadata: {
        engineVersion: this.VERSION,
        timestamp: new Date().toISOString(),
      }
    };
  }

  /**
   * تحديد السنة المالية من تاريخ الخدمة
   */
  static getFiscalYear(date: Date): number {
    return date.getFullYear();
  }
}
