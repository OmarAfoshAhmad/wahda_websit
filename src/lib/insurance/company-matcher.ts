import prisma from "@/lib/prisma";

let companiesCache: Array<{ id: string; name: string; code: string; card_pattern: string | null }> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

async function getActiveCompanies() {
  const now = Date.now();
  if (!companiesCache || now - cacheTimestamp > CACHE_TTL) {
    companiesCache = await prisma.insuranceCompany.findMany({
      where: { is_active: true, deleted_at: null, card_pattern: { not: null } },
      select: { id: true, name: true, code: true, card_pattern: true },
    });
    cacheTimestamp = now;
  }
  return companiesCache;
}

export function clearCompanyCache() {
  companiesCache = null;
  cacheTimestamp = 0;
}

export async function findCompanyByCardNumber(cardNumber: string) {
  const companies = await getActiveCompanies();
  return matchCompanyByCardNumber(cardNumber, companies);
}

export function matchCompanyByCardNumber(
  cardNumber: string,
  companies: Array<{ id: string; name: string; code: string; card_pattern: string | null }>,
) {
  if (!companies?.length) return null;

  const upper = cardNumber.toUpperCase();
  for (const company of companies) {
    if (!company.card_pattern) continue;
    try {
      const regex = new RegExp(company.card_pattern);
      if (regex.test(upper)) {
        return { id: company.id, name: company.name, code: company.code };
      }
    } catch (e) {
      continue;
    }
  }

  for (const company of companies) {
    if (company.card_pattern && upper.startsWith(company.code)) {
      return { id: company.id, name: company.name, code: company.code };
    }
  }

  return null;
}

interface CompanyWithMapping {
  id: string;
  name: string;
  code: string;
  card_pattern: string | null;
  service_type_mappings: Record<string, string> | null;
}

let companiesWithMappingCache: CompanyWithMapping[] | null = null;
let mappingCacheTimestamp = 0;

export async function getServiceTypeMapping(companyId: string, serviceType: string): Promise<string> {
  const now = Date.now();
  if (!companiesWithMappingCache || now - mappingCacheTimestamp > CACHE_TTL) {
    const rows = await prisma.insuranceCompany.findMany({
      where: { is_active: true, deleted_at: null },
      select: { id: true, name: true, code: true, card_pattern: true, service_type_mappings: true },
    });
    companiesWithMappingCache = rows as CompanyWithMapping[];
    mappingCacheTimestamp = now;
  }

  const company = companiesWithMappingCache.find(c => c.id === companyId);
  if (!company?.service_type_mappings) return serviceType;

  const mapped = (company.service_type_mappings as Record<string, string>)[serviceType];
  return mapped || serviceType;
}

export function clearAllCaches() {
  companiesCache = null;
  cacheTimestamp = 0;
  companiesWithMappingCache = null;
  mappingCacheTimestamp = 0;
}
