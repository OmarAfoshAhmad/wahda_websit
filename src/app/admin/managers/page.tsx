import { redirect } from "next/navigation";
import { UserCog } from "lucide-react";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { ManagerCreateForm } from "@/components/manager-create-form";
import { ManagerPermissionsModal } from "@/components/manager-permissions-modal";
import { ManagerDeleteButton } from "@/components/manager-delete-button";
import type { ManagerPermissions } from "@/lib/auth";

const PERMISSION_LABELS: Record<keyof ManagerPermissions, string> = {
  add_beneficiary: "إضافة مستفيد",
  delete_beneficiary: "حذف مستفيد",
  import_beneficiaries: "استيراد مستفيدين",
  add_facility: "إضافة مرفق",
  import_facilities: "استيراد مرافق",
  cancel_transactions: "إلغاء الحركات",
  correct_transactions: "تصحيح الحركات",
};

export default async function ManagersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const managers = await prisma.facility.findMany({
    where: { is_manager: true, deleted_at: null },
    select: {
      id: true,
      name: true,
      username: true,
      manager_permissions: true,
      must_change_password: true,
      created_at: true,
    },
    orderBy: { created_at: "desc" },
  });

  return (
    <Shell
      facilityName={session.name}
      isAdmin={session.is_admin}
      isManager={session.is_manager}
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* رأس الصفحة */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
            <UserCog className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 dark:text-white">إدارة المديرين</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {managers.length === 0
                ? "لا يوجد أي مدير مسجّل"
                : `${managers.length} مدير مسجّل`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* قائمة المديرين — تأخذ ثلثي العرض على الشاشات الكبيرة */}
          <div className="lg:col-span-2">
            {managers.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-16 text-center">
                <UserCog className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">لا يوجد مديرون بعد</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  استخدم النموذج لإنشاء أول حساب مدير
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {managers.map((mgr) => {
                  const perms = (mgr.manager_permissions ?? {}) as Partial<ManagerPermissions>;
                  const enabledKeys = (Object.keys(PERMISSION_LABELS) as Array<keyof ManagerPermissions>)
                    .filter((k) => perms[k] === true);
                  const disabledKeys = (Object.keys(PERMISSION_LABELS) as Array<keyof ManagerPermissions>)
                    .filter((k) => perms[k] !== true);

                  const fullPerms: ManagerPermissions = {
                    add_beneficiary: perms.add_beneficiary ?? false,
                    delete_beneficiary: perms.delete_beneficiary ?? false,
                    import_beneficiaries: perms.import_beneficiaries ?? false,
                    add_facility: perms.add_facility ?? false,
                    import_facilities: perms.import_facilities ?? false,
                    cancel_transactions: perms.cancel_transactions ?? false,
                    correct_transactions: perms.correct_transactions ?? false,
                  };

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
                        <div className="flex shrink-0 gap-2">
                          <ManagerPermissionsModal
                            managerId={mgr.id}
                            managerName={mgr.name}
                            permissions={fullPerms}
                          />
                          <ManagerDeleteButton id={mgr.id} name={mgr.name} />
                        </div>
                      </div>

                      {/* الصلاحيات الممنوحة */}
                      {enabledKeys.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {enabledKeys.map((k) => (
                            <span
                              key={k}
                              className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400"
                            >
                              ✓ {PERMISSION_LABELS[k]}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* الصلاحيات المحجوبة */}
                      {disabledKeys.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {disabledKeys.map((k) => (
                            <span
                              key={k}
                              className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-400 dark:text-slate-500"
                            >
                              {PERMISSION_LABELS[k]}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* تاريخ الإنشاء */}
                      <p className="mt-3 text-xs text-slate-400 dark:text-slate-600 text-end">
                        أُنشئ في{" "}
                        {new Date(mgr.created_at).toLocaleDateString("ar-SA", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* نموذج إنشاء مدير جديد */}
          <div>
            <ManagerCreateForm />
          </div>
        </div>
      </div>
    </Shell>
  );
}
