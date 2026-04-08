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
  import_beneficiaries: "استيراد مستفيدين",
  add_beneficiary: "إضافة مستفيد",
  edit_beneficiary: "تعديل مستفيد",
  delete_beneficiary: "حذف مستفيد",
  add_facility: "إضافة مرفق",
  edit_facility: "تعديل مرفق",
  delete_facility: "حذف مرفق",
  cancel_transactions: "إلغاء حركات",
  correct_transactions: "تصحيح حركات",
  manage_recycle_bin: "سلة المحذوفات",
  export_data: "تصدير بيانات",
  print_cards: "طباعة كروت",
  view_audit_log: "سجل المراقبة",
  view_reports: "التقارير",
  view_facilities: "المرافق",
  view_beneficiaries: "المستفيدون",
  deduct_balance: "نقطة بيع",
  delete_transaction: "حذف حركات",
};

export default async function ManagersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const managers = await prisma.facility.findMany({
    where: {
      OR: [{ is_manager: true }, { is_admin: true }],
      deleted_at: null,
    },
    select: {
      id: true,
      name: true,
      username: true,
      is_admin: true,
      is_manager: true,
      manager_permissions: true,
      must_change_password: true,
      created_at: true,
    },
    orderBy: { created_at: "desc" },
  });

  return (
    <Shell facilityName={session.name} session={session}>
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

                  const fullPerms: ManagerPermissions = {
                    import_beneficiaries: perms.import_beneficiaries ?? false,
                    add_beneficiary: perms.add_beneficiary ?? false,
                    edit_beneficiary: perms.edit_beneficiary ?? false,
                    delete_beneficiary: perms.delete_beneficiary ?? false,
                    add_facility: perms.add_facility ?? false,
                    edit_facility: perms.edit_facility ?? false,
                    delete_facility: perms.delete_facility ?? false,
                    cancel_transactions: perms.cancel_transactions ?? false,
                    correct_transactions: perms.correct_transactions ?? false,
                    manage_recycle_bin: perms.manage_recycle_bin ?? false,
                    export_data: perms.export_data ?? false,
                    print_cards: perms.print_cards ?? false,
                    view_audit_log: perms.view_audit_log ?? false,
                    view_reports: perms.view_reports ?? false,
                    view_facilities: perms.view_facilities ?? false,
                    view_beneficiaries: perms.view_beneficiaries ?? true,
                    deduct_balance: perms.deduct_balance ?? false,
                    delete_transaction: perms.delete_transaction ?? false,
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
                            {mgr.is_admin ? (
                              <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-400">
                                المبرمج
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-400">
                                مدير
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
                        <div className="flex shrink-0 gap-2">
                          {!mgr.is_admin && (
                            <ManagerPermissionsModal
                              managerId={mgr.id}
                              managerName={mgr.name}
                              permissions={fullPerms}
                            />
                          )}
                          {mgr.id !== session.id && (
                            <ManagerDeleteButton id={mgr.id} name={mgr.name} />
                          )}
                        </div>
                      </div>

                      {/* الصلاحيات الممنوحة */}
                      {/* الصلاحيات */}
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {mgr.is_admin ? (
                          /* المبرمج: كل الصلاحيات مفعلة + صلاحيات حصرية */
                          <>
                            {(Object.keys(PERMISSION_LABELS) as Array<keyof ManagerPermissions>).map((k) => (
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
                          (Object.keys(PERMISSION_LABELS) as Array<keyof ManagerPermissions>).map((k) => (
                            <span
                              key={k}
                              className={
                                perms[k] === true
                                  ? "inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400"
                                  : "inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-400 dark:text-slate-500 line-through"
                              }
                            >
                              {perms[k] === true ? "✓" : "✗"} {PERMISSION_LABELS[k]}
                            </span>
                          ))
                        )}
                      </div>

                      {/* تاريخ الإنشاء */}
                      <p className="mt-3 text-xs text-slate-400 dark:text-slate-600 text-end">
                        أُنشئ في {new Date(mgr.created_at).toLocaleDateString("en-GB")}
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
