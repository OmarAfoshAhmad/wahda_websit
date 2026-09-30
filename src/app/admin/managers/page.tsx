import { redirect } from "next/navigation";
import Link from "next/link";
import { UserCog } from "lucide-react";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { ManagerCreateForm } from "@/components/manager-create-form";
import { ManagerPermissionsModal } from "@/components/manager-permissions-modal";
import { ManagerDeleteButton } from "@/components/manager-delete-button";
import { ManagerResetPasswordButton } from "@/components/manager-reset-password-button";
import { ManagerRecycleActions } from "@/components/manager-recycle-actions";
import { ManagerEditNameModal } from "@/components/manager-edit-name-modal";
import type { ManagerPermissions } from "@/lib/permissions";
import { formatDateTripoli } from "@/lib/datetime";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  normalizeManagerPermissionsForRole,
  resolvePermissionRole,
} from "@/lib/permission-catalog";

export default async function ManagersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  const canView = hasPermission(session, "manage_users");
  if (!canView) redirect("/dashboard");

  const { view } = await searchParams;
  const isDeletedView = view === "deleted";

  const managers = await prisma.facility.findMany({
    where: {
      deleted_at: isDeletedView ? { not: null } : null,
      OR: [
        { role: { in: ["ADMIN", "MANAGER", "EMPLOYEE"] } },
        { is_admin: true },
        { is_manager: true },
        { is_employee: true },
      ],
    },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      is_admin: true,
      is_manager: true,
      is_employee: true,
      manager_permissions: true,
      must_change_password: true,
      created_at: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { created_at: "desc" },
  });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* رأس الصفحة */}
        <div className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
            <UserCog className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 dark:text-white">إدارة الحسابات</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {managers.length === 0
                ? isDeletedView
                  ? "لا يوجد أي حساب إدارة/موظف محذوف"
                  : "لا يوجد أي حساب إدارة مسجّل"
                : isDeletedView
                  ? `${managers.length} حساب إدارة/موظف محذوف`
                  : `${managers.length} حساب إدارة مسجّل`}
            </p>
          </div>
          <Link
            href={isDeletedView ? "/admin/managers" : "/admin/managers?view=deleted"}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#0f2a4a] px-4 py-2 text-sm font-black text-white! transition-colors hover:bg-[#0b1f38] sm:mr-auto sm:w-auto"
          >
            {isDeletedView ? "العودة للنشطين" : "المحذوفات"}
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* قائمة المديرين — تأخذ ثلثي العرض على الشاشات الكبيرة */}
          <div className="lg:col-span-2">
            {managers.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-16 text-center">
                <UserCog className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">لا توجد حسابات مدراء أو موظفين بعد</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  استخدم النموذج لإنشاء أول حساب (مدير أو موظف)
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {managers.map((mgr) => {
                  const perms = (mgr.manager_permissions ?? {}) as Partial<ManagerPermissions>;
                  const managerRole = resolvePermissionRole({
                    role: mgr.role,
                    is_admin: mgr.is_admin,
                    is_manager: mgr.is_manager,
                    is_employee: mgr.is_employee,
                  });
                  const fullPerms: ManagerPermissions = normalizeManagerPermissionsForRole(
                    managerRole,
                    perms,
                  );

                  return (
                    <div
                      key={mgr.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm"
                    >
                      {/* رأس بطاقة المدير */}
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-black text-sm text-slate-900 dark:text-white truncate">
                              {mgr.name}
                            </p>
                            {managerRole === "ADMIN" ? (
                              <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-400">
                                المبرمج
                              </span>
                            ) : managerRole === "MANAGER" ? (
                              <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-400">
                                مدير
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-teal-100 dark:bg-teal-900/30 px-2 py-0.5 text-xs font-bold text-teal-700 dark:text-teal-400">
                                موظف
                              </span>
                            )}
                            {mgr.must_change_password && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                                كلمة المرور مؤقتة
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                            @{mgr.username}
                          </p>
                        </div>
                        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                          {!isDeletedView && managerRole !== "ADMIN" && (
                            <ManagerEditNameModal managerId={mgr.id} managerName={mgr.name} />
                          )}
                          {!isDeletedView && managerRole !== "ADMIN" && (
                            <ManagerPermissionsModal
                              managerId={mgr.id}
                              managerName={mgr.name}
                              permissions={fullPerms}
                              accountRole={managerRole}
                            />
                          )}
                          {!isDeletedView && managerRole !== "ADMIN" && (
                            <ManagerResetPasswordButton id={mgr.id} name={mgr.name} />
                          )}
                          {!isDeletedView && mgr.id !== session.id && managerRole !== "ADMIN" && (
                            <ManagerDeleteButton id={mgr.id} name={mgr.name} />
                          )}
                          {isDeletedView && mgr.id !== session.id && managerRole !== "ADMIN" && (
                            <ManagerRecycleActions
                              id={mgr.id}
                              name={mgr.name}
                              transactionCount={mgr._count.transactions}
                            />
                          )}
                        </div>
                      </div>

                      {/* الصلاحيات الممنوحة */}
                      {/* الصلاحيات */}
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {managerRole === "ADMIN" ? (
                          /* المبرمج: كل الصلاحيات مفعلة + صلاحيات حصرية */
                          <>
                            {PERMISSION_KEYS.map((k) => (
                              <span
                                key={k}
                                className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400"
                              >
                                ✓ {PERMISSION_LABELS[k]}
                              </span>
                            ))}
                            <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-400">
                              ✓ نسخ احتياطي
                            </span>
                            <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-400">
                              ✓ استعادة احتياطي
                            </span>
                            <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-400">
                              ✓ استيراد حركات
                            </span>
                            <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-400">
                              ✓ إدارة المديرين
                            </span>
                          </>
                        ) : (
                          /* المدير: صلاحيات حسب التفعيل */
                          PERMISSION_KEYS.map((k) => (
                            <span
                              key={k}
                              className={
                                fullPerms[k] === true
                                  ? "inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400"
                                  : "inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-400 dark:text-slate-500 line-through"
                              }
                            >
                              {fullPerms[k] === true ? "✓" : "✗"} {PERMISSION_LABELS[k]}
                            </span>
                          ))
                        )}
                      </div>

                      {/* تاريخ الإنشاء */}
                      <p className="mt-3 text-xs text-slate-400 dark:text-slate-600 text-end">
                        أُنشئ في {formatDateTripoli(mgr.created_at, "en-GB")}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* نموذج إنشاء مدير جديد */}
          <div>
            {!isDeletedView && <ManagerCreateForm />}
          </div>
        </div>
      </div>
    </Shell>
  );
}
