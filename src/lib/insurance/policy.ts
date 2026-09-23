import { WAHDA_BANK_COMPANY_ID } from "@/lib/constants";
import type { WalletType } from "./consumption";

type ServicePolicyRow = {
  ceiling_amount: unknown;
  coverage_percent: unknown;
  service_type?: { code: string } | null;
};

export type CompanyForPolicy = {
  id: string;
  code: string;
  general_ceiling: unknown;
  general_coverage: unknown;
  medicine_ceiling: unknown;
  medicine_coverage: unknown;
  dental_settings?: unknown;
  service_policies?: ServicePolicyRow[] | null;
};

export type ResolvedWalletPolicy = {
  service_type: WalletType;
  annual_ceiling: number | null;
  copay_percentage: number;
  allow_partial_coverage: true;
};

function customCeilingOverride(customCeilings: unknown, walletType: WalletType): number | null | undefined {
  if (!customCeilings || typeof customCeilings !== "object" || !(walletType in customCeilings)) return undefined;
  const value = (customCeilings as Record<string, unknown>)[walletType];
  return value === null ? null : Number(value);
}

function isBaseBalanceCompany(company: CompanyForPolicy): boolean {
  return company.code === "WAB" || company.code === "WAAD" || company.id === WAHDA_BANK_COMPANY_ID;
}

/**
 * المصدر الوحيد لحلّ سياسة المحفظة (السقف ونسبة التحمل) لمستفيد.
 * تُستدعى من التنفيذ والمعاينة معاً حتى يرى الموظف نفس الأرقام التي ستُطبَّق.
 * يُعيد null عندما لا تكون المحفظة مُهيّأة لهذه الشركة.
 */
export function resolveWalletPolicy(input: {
  company: CompanyForPolicy;
  customCeilings: unknown;
  walletType: WalletType;
  dentalSubCategory?: string | null;
}): ResolvedWalletPolicy | null {
  const { company, customCeilings, walletType, dentalSubCategory } = input;
  const policies = company.service_policies ?? [];
  const override = customCeilingOverride(customCeilings, walletType);

  if (walletType === "DENTAL" || walletType === "OPTICS" || walletType === "PHYSIOTHERAPY" || walletType === "EQUESTRIAN") {
    const policy = policies.find((p) => p.service_type?.code === walletType);
    if (!policy) return null;

    const annual_ceiling = override !== undefined
      ? override
      : policy.ceiling_amount === null ? null : Number(policy.ceiling_amount);

    if (walletType === "PHYSIOTHERAPY") {
      // العلاج الطبيعي يُحاسب بالجلسات فقط، بلا نسبة تحمل مالية.
      return { service_type: walletType, annual_ceiling, copay_percentage: 0, allow_partial_coverage: true };
    }

    let coverage = Number(policy.coverage_percent);
    if (walletType === "DENTAL") {
      const settings = (company.dental_settings ?? null) as Record<string, { enabled?: boolean; coverage?: unknown }> | null;
      const sub = dentalSubCategory === "DENTAL_ORTHO" ? "ortho"
        : dentalSubCategory === "DENTAL_IMPLANT" ? "implant"
        : dentalSubCategory === "DENTAL_PROSTHETICS" ? "prosthetics"
        : null;
      if (sub && settings?.[sub]?.enabled) coverage = Number(settings[sub].coverage);
    }

    return { service_type: walletType, annual_ceiling, copay_percentage: Math.max(0, 100 - coverage), allow_partial_coverage: true };
  }

  // GENERAL / MEDICINE / SUPPLIES: مصرف الوحدة يعمل بالرصيد الأساسي لا بسقف شركة.
  if (isBaseBalanceCompany(company)) return null;

  const isGeneral = walletType === "GENERAL";
  const ceiling = isGeneral ? company.general_ceiling : company.medicine_ceiling;
  const coverage = isGeneral ? company.general_coverage : company.medicine_coverage;
  return {
    service_type: walletType,
    annual_ceiling: override !== undefined ? override : ceiling === null ? null : Number(ceiling),
    copay_percentage: Math.max(0, 100 - Number(coverage)),
    allow_partial_coverage: true,
  };
}
