import { formatCurrency } from "@/lib/money";
import type { CalculationResult } from "./engine";
import type { PhysiotherapySessionCalculation } from "@/lib/physiotherapy-sessions";

/**
 * حارس السقف السنوي — يُستدعى في مسارات الكتابة الحية فقط.
 * أدوات إعادة الاحتساب والصيانة تعمل على حركات تاريخية متجاوزة أصلاً،
 * فلا يجوز استدعاؤه فيها وإلا تعطّلت.
 */

const CEILING_TOLERANCE = 0.01;

const SERVICE_LABELS: Record<string, string> = {
  DENTAL: "الأسنان",
  DENTAL_ORTHO: "تقويم الأسنان",
  DENTAL_IMPLANT: "زراعة الأسنان",
  DENTAL_PROSTHETICS: "تركيبات الأسنان",
  OPTICS: "البصريات",
  PHYSIOTHERAPY: "العلاج الطبيعي",
  EQUESTRIAN: "الفروسية",
  GENERAL: "الكشف العام",
  MEDICINE: "الدواء",
  SUPPLIES: "المستلزمات",
};

export function serviceLabel(serviceType: string): string {
  return SERVICE_LABELS[serviceType] ?? serviceType;
}

/**
 * السقف غير المحدود (null) يجعل المحرك يساوي بين الحصتين، فلا يتحقق الشرط أبداً.
 * لا نعتمد على isPartialCoverage لأنها تبقى false عندما يكون السقف مستهلكاً بالكامل
 * رغم سقوط المبلغ كاملاً على المستفيد.
 */
export function isCeilingExceeded(calc: CalculationResult): boolean {
  return calc.actualCompanyShare < calc.originalCompanyShare - CEILING_TOLERANCE;
}

export function ceilingRejectionMessage(calc: CalculationResult, serviceType: string): string {
  const shortfall = calc.originalCompanyShare - calc.actualCompanyShare;
  return (
    `تجاوز السقف السنوي لخدمة ${serviceLabel(serviceType)}: ` +
    `المتبقي من السقف ${formatCurrency(calc.remainingCeilingBefore)} د.ل، ` +
    `والمطلوب من الشركة ${formatCurrency(calc.originalCompanyShare)} د.ل ` +
    `(العجز ${formatCurrency(shortfall)} د.ل). لا يمكن إتمام العملية.`
  );
}

export function assertWithinCeiling(calc: CalculationResult, serviceType: string): void {
  if (isCeilingExceeded(calc)) {
    throw new Error(ceilingRejectionMessage(calc, serviceType));
  }
}

export function isSessionLimitExceeded(result: PhysiotherapySessionCalculation): boolean {
  return result.exceededSessions > 0;
}

export function sessionRejectionMessage(result: PhysiotherapySessionCalculation): string {
  return (
    `تجاوز السقف السنوي لجلسات العلاج الطبيعي: ` +
    `المتبقي ${result.remainingBefore ?? 0} جلسة، والمطلوب ${result.sessions} جلسة ` +
    `(تجاوز ${result.exceededSessions} جلسة). لا يمكن إتمام العملية.`
  );
}

export function assertWithinSessionLimit(result: PhysiotherapySessionCalculation): void {
  if (isSessionLimitExceeded(result)) {
    throw new Error(sessionRejectionMessage(result));
  }
}
