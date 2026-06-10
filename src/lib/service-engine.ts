import { ServicePolicy, Transaction, Prisma } from "@prisma/client";

/**
 * Represents the input required to calculate a service transaction's financial breakdown.
 */
export interface ServiceCalculationInput {
  grossAmount: number;
  policy: ServicePolicy | null;
  consumedCeilingBefore: number; // The amount the company has ALREADY paid for this service in the frequency window
}

/**
 * Represents the output of the calculation.
 */
export interface ServiceCalculationResult {
  actualCompanyShare: number;
  actualPatientShare: number;
  remainingCeilingBefore: number | null;
  remainingCeilingAfter: number | null;
  ceilingConsumedInThisTransaction: number;
  coverageApplied: number;
  isCeilingExceeded: boolean;
  isFullyPatientPaid: boolean;
}

/**
 * Core Business Logic Engine for all services (Dental, Optics, etc.)
 */
export function calculateServiceTransaction(input: ServiceCalculationInput): ServiceCalculationResult {
  const { grossAmount, policy, consumedCeilingBefore } = input;

  // 1. If there's no policy or policy is inactive, patient pays 100%
  if (!policy || !policy.is_active) {
    return {
      actualCompanyShare: 0,
      actualPatientShare: grossAmount,
      remainingCeilingBefore: null,
      remainingCeilingAfter: null,
      ceilingConsumedInThisTransaction: 0,
      coverageApplied: 0,
      isCeilingExceeded: false,
      isFullyPatientPaid: true,
    };
  }

  // 2. Parse Policy Rules
  const coveragePercent = Number(policy.coverage_percent || 0) / 100;
  const ceilingAmount = policy.ceiling_amount ? Number(policy.ceiling_amount) : null;

  // 3. Calculate Initial Shares (Based on Coverage ONLY)
  let calculatedCompanyShare = grossAmount * coveragePercent;

  // 4. Apply Financial Ceiling Rule
  let actualCompanyShare = calculatedCompanyShare;
  let remainingCeilingBefore: number | null = null;
  let remainingCeilingAfter: number | null = null;
  let ceilingConsumedInThisTransaction = 0;
  let isCeilingExceeded = false;

  if (ceilingAmount !== null) {
    // How much ceiling is left before this transaction?
    remainingCeilingBefore = Math.max(0, ceilingAmount - consumedCeilingBefore);

    // If the calculated company share exceeds the remaining ceiling, cap it
    if (calculatedCompanyShare > remainingCeilingBefore) {
      actualCompanyShare = remainingCeilingBefore;
      isCeilingExceeded = true;
    }

    ceilingConsumedInThisTransaction = actualCompanyShare;
    remainingCeilingAfter = Math.max(0, remainingCeilingBefore - ceilingConsumedInThisTransaction);
  }

  // 5. Patient pays whatever the company does not cover
  const actualPatientShare = grossAmount - actualCompanyShare;

  return {
    actualCompanyShare: roundToTwo(actualCompanyShare),
    actualPatientShare: roundToTwo(actualPatientShare),
    remainingCeilingBefore: remainingCeilingBefore !== null ? roundToTwo(remainingCeilingBefore) : null,
    remainingCeilingAfter: remainingCeilingAfter !== null ? roundToTwo(remainingCeilingAfter) : null,
    ceilingConsumedInThisTransaction: roundToTwo(ceilingConsumedInThisTransaction),
    coverageApplied: coveragePercent * 100,
    isCeilingExceeded,
    isFullyPatientPaid: actualPatientShare >= grossAmount,
  };
}

/**
 * Helper to compute the date threshold for frequency (e.g., 12 months ago).
 * Returns null if the frequency is unlimited.
 */
export function getFrequencyThresholdDate(frequencyMonths: number | null): Date | null {
  if (!frequencyMonths) return null;
  
  const threshold = new Date();
  threshold.setMonth(threshold.getMonth() - frequencyMonths);
  return threshold;
}

// Utility: Round to 2 decimal places to avoid floating point math errors
function roundToTwo(num: number) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
