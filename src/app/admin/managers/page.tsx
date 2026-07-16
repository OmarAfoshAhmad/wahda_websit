import { redirect } from "next/navigation";
import Link from "next/link";
import { UserCog } from "lucide-react";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { ManagerCreateForm } from "@/components/manager-create-form";
import { ManagerPermissionsModal } from "@/components/manager-permissions-modal";
import { ManagerDeleteButton } from "@/components/manager-delete-button";
import { ManagerRecycleActions } from "@/components/manager-recycle-actions";
import { ManagersSearch } from "@/components/managers-search";
import { ManagerResetPasswordButton } from "@/components/manager-reset-password-button";
import { PaginationButtons } from "@/components/pagination-buttons";
import { normalizeManagerPermissionsForRole, resolvePermissionRole } from "@/lib/permission-catalog";
import { formatDateTripoli } from "@/lib/datetime";

const PAGE_SIZE = 15;

export default async function ManagersPage({ searchParams }: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "manage_users")) redirect("/dashboard");

  const { view, q, page: pageRaw } = await searchParams;
  const isDeletedView = view === "deleted";
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);
  const query = q?.trim() ?? "";
  const where = {
    OR: [{ is_admin: true }, { is_manager: true }, { is_employee: true }],
    deleted_at: isDeletedView ? { not: null } : null,
    ...(query ? { AND: [{ OR: [
      { name: { contains: query, mode: "insensitive" as const } },
      { username: { contains: query, mode: "insensitive" as const } },
    ] }] } : {}),
  };

  const [accounts, total] = await Promise.all([
    prisma.facility.findMany({
      where,
      select: {
        id: true, name: true, username: true, is_admin: true, is_manager: true, is_employee: true,
        manager_permissions: true, must_change_password: true, created_at: true,
        _count: { select: { transactions: true } },
      },
      orderBy: [{ is_admin: "desc" }, { is_manager: "desc" }, { created_at: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.facility.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (nextPage: number) => `/admin/managers?${new URLSearchParams({
    ...(query ? { q: query } : {}), ...(isDeletedView ? { view: "deleted" } : {}), page: String(nextPage),
  })}`;

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/30"><UserCog className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-black text-slate-900 dark:text-white">المشرفون والمديرون والموظفون</h1><p className="text-xs text-slate-500">{total.toLocaleString("ar-LY")} حساب — منفصلة عن المرافق الصحية</p></div>
          <div className="flex w-full flex-col gap-2 sm:mr-auto sm:w-auto sm:flex-row">
            <ManagersSearch initialQuery={query} />
            <Link href={isDeletedView ? "/admin/managers" : "/admin/managers?view=deleted"} className="inline-flex h-10 items-center justify-center rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white!">{isDeletedView ? "العودة للنشطين" : "المحذوفات"}</Link>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="overflow-hidden rounded-xl border bg-white dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-245 text-right text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/60"><tr><th className="p-3">الاسم</th><th className="p-3">المستخدم</th><th className="p-3">الدور</th><th className="p-3">الحالة</th><th className="p-3">الحركات</th><th className="p-3">تاريخ الإنشاء</th><th className="p-3">الإجراءات</th></tr></thead>
                <tbody>
                  {accounts.length === 0 ? <tr><td colSpan={7} className="p-10 text-center text-slate-500">لا توجد حسابات مطابقة.</td></tr> : accounts.map((account) => {
                    const role = resolvePermissionRole(account);
                    const permissions = normalizeManagerPermissionsForRole(role, account.manager_permissions);
                    const roleLabel = account.is_admin ? "مشرف" : account.is_manager ? "مدير" : "موظف";
                    return <tr key={account.id} className="border-t dark:border-slate-800">
                      <td className="p-3 font-black">{account.name}</td><td className="p-3 font-mono" dir="ltr">@{account.username}</td>
                      <td className="p-3"><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950">{roleLabel}</span></td>
                      <td className="p-3">{account.must_change_password ? <span className="text-xs font-bold text-amber-700">كلمة مرور مؤقتة</span> : <span className="text-xs font-bold text-emerald-700">نشط</span>}</td>
                      <td className="p-3">{account._count.transactions.toLocaleString("ar-LY")}</td><td className="p-3 text-xs">{formatDateTripoli(account.created_at, "en-GB")}</td>
                      <td className="p-3"><div className="flex flex-wrap gap-2">
                        {!isDeletedView && !account.is_admin ? <ManagerPermissionsModal managerId={account.id} managerName={account.name} permissions={permissions} accountRole={role} /> : null}
                        {!isDeletedView ? <ManagerResetPasswordButton id={account.id} name={account.name} /> : null}
                        {!isDeletedView && account.id !== session.id ? <ManagerDeleteButton id={account.id} name={account.name} /> : null}
                        {isDeletedView && account.id !== session.id ? <ManagerRecycleActions id={account.id} name={account.name} transactionCount={account._count.transactions} /> : null}
                      </div></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 ? <div className="border-t p-3"><PaginationButtons page={page} totalPages={pages} hrefForPage={pageHref} /></div> : null}
          </div>
          {!isDeletedView ? <ManagerCreateForm /> : null}
        </div>
      </div>
    </Shell>
  );
}
