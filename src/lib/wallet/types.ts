export interface DeductClaimInput {
  beneficiaryId: string;
  companyId: string | null;
  serviceType: string;
  amount: number;
  fiscalYear: number;
  facilityId: string;
  requestId?: string | null;
}

export interface ClaimResult {
  claimId: string;
  status: "APPROVED" | "PARTIAL" | "REJECTED";
  walletType: string;
  requestedAmount: number;
  approvedAmount: number;
  limitAnnual: number | null;
  consumedBefore: number;
  consumedAfter: number;
  remainingBefore: number;
  remainingAfter: number;
}

export interface WalletState {
  walletType: string;
  limitAnnual: number | null;
  consumedBefore: number;
  consumedAfter: number;
  remainingBefore: number;
  remainingAfter: number;
}

export interface PolicyLimitRow {
  annual_ceiling: number | null;
  copay_percentage: number;
  allow_partial_coverage: boolean;
}

export interface WalletConsumptionRow {
  consumed_amount: number;
  version: number;
}
