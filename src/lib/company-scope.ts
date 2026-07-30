import type { ManagerPermissions, Session } from "./permissions";
import { hasPermission } from "./permissions";
import prisma from "./prisma";
import { requireActiveFacilitySession } from "./session-guard";

export class ScopeAccessError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 403) {
    super(message);
    this.name = "ScopeAccessError";
    this.status = status;
  }
}

export function resolveAllowedScope(
  allowedIds: ReadonlyArray<string>,
  requestedId?: string | null,
): { selectedId?: string; allowedIds: string[] } {
  const uniqueAllowedIds = [...new Set(allowedIds.filter(Boolean))];
  const selectedId = requestedId?.trim();
  if (selectedId && !uniqueAllowedIds.includes(selectedId)) {
    throw new ScopeAccessError("لا تملك صلاحية الوصول إلى النطاق المطلوب");
  }
  if (!selectedId && uniqueAllowedIds.length === 0) {
    throw new ScopeAccessError("لا يوجد نطاق مفوض لهذا الحساب");
  }
  return selectedId ? { selectedId, allowedIds: [selectedId] } : { allowedIds: uniqueAllowedIds };
}

export async function requireSession(): Promise<Session> {
  const session = await requireActiveFacilitySession();
  if (!session) throw new ScopeAccessError("يجب تسجيل الدخول", 401);
  return session;
}

export async function requirePermission(
  permission: keyof ManagerPermissions,
): Promise<Session> {
  const session = await requireSession();
  if (!hasPermission(session, permission)) {
    throw new ScopeAccessError("لا تملك الصلاحية المطلوبة");
  }
  return session;
}

async function getFreshAccountScope(accountId: string) {
  const account = await prisma.facility.findFirst({
    where: { id: accountId, deleted_at: null },
    select: {
      role_v2: true,
      role: true,
      is_admin: true,
      is_manager: true,
      is_employee: true,
      company_accesses: {
        where: { company: { deleted_at: null } },
        select: { company_id: true },
      },
      service_accesses: {
        where: { service_type: { is_active: true } },
        select: { service_type_id: true },
      },
    },
  });
  if (!account) throw new ScopeAccessError("الحساب غير موجود أو محذوف", 401);

  let computedRole = account.role_v2;
  if (!computedRole) {
    if (account.is_admin || account.role === "ADMIN" || account.role === "SUPER_ADMIN") computedRole = "SUPER_ADMIN";
    else if (account.is_manager || account.role === "MANAGER" || account.role === "COMPANY_ADMIN") computedRole = "MANAGER";
    else if (account.is_employee || account.role === "EMPLOYEE") computedRole = "EMPLOYEE";
    else computedRole = "FACILITY";
  }

  return { ...account, computedRole };
}

export async function getAllowedCompanyIds(session: Pick<Session, "id">): Promise<string[]> {
  const account = await getFreshAccountScope(session.id);
  
  const hasExplicitAccess = account.company_accesses.length > 0;
  
  if (
    account.computedRole === "SUPER_ADMIN" || 
    account.computedRole === "FACILITY" || 
    (account.computedRole === "MANAGER" && !hasExplicitAccess)
  ) {
    const companies = await prisma.insuranceCompany.findMany({
      where: { deleted_at: null },
      select: { id: true },
    });
    return companies.map((company) => company.id);
  }
  return account.company_accesses.map((access) => access.company_id);
}

export async function getAllowedServiceTypeIds(session: Pick<Session, "id">): Promise<string[]> {
  const account = await getFreshAccountScope(session.id);
  if (account.computedRole === "SUPER_ADMIN") {
    const services = await prisma.serviceType.findMany({
      where: { is_active: true },
      select: { id: true },
    });
    return services.map((service) => service.id);
  }
  return account.service_accesses.map((access) => access.service_type_id);
}

export async function requireCompanyAccess(
  companyId: string,
  permission?: keyof ManagerPermissions,
): Promise<Session> {
  const session = permission ? await requirePermission(permission) : await requireSession();
  resolveAllowedScope(await getAllowedCompanyIds(session), companyId);
  return session;
}

export async function assertCompanyAccessForSession(
  session: Pick<Session, "id">,
  companyId: string,
): Promise<void> {
  resolveAllowedScope(await getAllowedCompanyIds(session), companyId);
}

export async function requireImportJobAccess(
  session: Pick<Session, "id" | "role_v2">,
  jobId: string,
): Promise<{ companyId: string | null }> {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { company_id: true },
  });
  if (!job) throw new ScopeAccessError("مهمة الاستيراد غير موجودة", 404);
  if (!job.company_id) {
    if (session.role_v2 !== "SUPER_ADMIN") {
      throw new ScopeAccessError("مهمة تاريخية بلا شركة محددة؛ متاحة للمبرمج فقط");
    }
    return { companyId: null };
  }
  await assertCompanyAccessForSession(session, job.company_id);
  return { companyId: job.company_id };
}

export async function buildCompanyScope(
  session: Pick<Session, "id">,
  requestedCompanyId?: string | null,
): Promise<{ company_id: string | { in: string[] } }> {
  const scope = resolveAllowedScope(await getAllowedCompanyIds(session), requestedCompanyId);
  return scope.selectedId
    ? { company_id: scope.selectedId }
    : { company_id: { in: scope.allowedIds } };
}

export async function requireServiceAccess(
  serviceTypeId: string,
  permission?: keyof ManagerPermissions,
): Promise<Session> {
  const session = permission ? await requirePermission(permission) : await requireSession();
  resolveAllowedScope(await getAllowedServiceTypeIds(session), serviceTypeId);
  return session;
}

export async function buildFacilityVisibilityWhere(
  session: Pick<Session, "id">,
  requestedCompanyId?: string | null,
  requestedServiceTypeId?: string | null,
) {
  const companyScope = resolveAllowedScope(await getAllowedCompanyIds(session), requestedCompanyId);
  const serviceScope = resolveAllowedScope(await getAllowedServiceTypeIds(session), requestedServiceTypeId);
  return {
    deleted_at: null,
    company_accesses: { some: { company_id: { in: companyScope.allowedIds } } },
    service_capabilities: { some: { service_type_id: { in: serviceScope.allowedIds } } },
  };
}
