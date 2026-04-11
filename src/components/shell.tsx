"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "./ui";
import { LayoutDashboard, ListOrdered, LogOut, Users, Building2, KeyRound, DatabaseBackup, ClipboardList, UserCog } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { ThemeSwitcher } from "./theme-switcher";
import type { ManagerPermissions, Session } from "@/lib/auth";

// تابع مساعد للتحقق من الصلاحيات (يُحاكي lib/session-guard)
function checkClientPerm(session: Session, key: keyof ManagerPermissions) {
  if (session.is_admin) return true;
  if (!session.is_manager) return false;
  return session.manager_permissions?.[key] === true;
}

const safeLogout = async () => {
  try { await logout(); } catch { window.location.href = "/login"; }
};

const baseNavigation = [
  { name: "الرئيسية", href: "/dashboard", icon: LayoutDashboard },
  { name: "الحركات", href: "/transactions", icon: ListOrdered },
];

const managerNavigation: Array<{ name: string; href: string; icon: typeof LayoutDashboard; perm: keyof ManagerPermissions }> = [
  { name: "المستفيدون", href: "/beneficiaries", icon: Users, perm: "view_beneficiaries" },
  { name: "المرافق الصحية", href: "/admin/facilities", icon: Building2, perm: "view_facilities" },
  { name: "سجل المراقبة", href: "/admin/audit-log", icon: ClipboardList, perm: "view_audit_log" },
];

const superAdminNavigation = [
  { name: "النسخ الاحتياطي", href: "/admin/backup", icon: DatabaseBackup },
  { name: "المديرون", href: "/admin/managers", icon: UserCog },
];

export function Shell({
  children,
  facilityName,
  session,
}: {
  children: React.ReactNode;
  facilityName: string;
  session: Session;
}) {
  const isAdmin = session.is_admin;
  const isManager = session.is_manager;
  const pathname = usePathname();

  const filteredManagerNav = managerNavigation.filter(item => {
    return checkClientPerm(session, item.perm);
  });

  const allNav = isAdmin
    ? [...baseNavigation, ...managerNavigation, ...superAdminNavigation]
    : isManager
      ? [...baseNavigation, ...filteredManagerNav]
      : baseNavigation;

  const roleLabel = isAdmin ? "المبرمج" : isManager ? "مدير" : "مرفق";

  return (
    <div suppressHydrationWarning className="page-shell min-h-screen pb-5 bg-slate-50 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100 transition-colors">
      <nav className="sticky top-0 z-50 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors">
        <div className="mx-auto max-w-7xl px-3 py-2.5 sm:px-5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Image src="/logo.png" alt="Waha Health Care" width={38} height={38} className="object-contain dark:brightness-110" style={{ width: 'auto', height: 'auto' }} />
                <div>
                  <h1 className="text-sm font-black leading-tight text-slate-900 dark:text-white">شركة الواحة</h1>
                  <h2 className="text-sm font-black leading-tight text-slate-900 dark:text-slate-300">Waha Health Care</h2>
                </div>
              </div>
              <div className="flex items-center gap-2 lg:hidden">
                <ThemeSwitcher />
                <button
                  onClick={() => safeLogout()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-red-600 dark:hover:text-red-400"
                  title="تسجيل الخروج"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex gap-1 overflow-x-auto pb-1 lg:pb-0 scrollbar-hide">
                {allNav.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "inline-flex min-w-fit items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-bold transition-colors",
                      pathname === item.href || pathname.startsWith(item.href + "/")
                        ? "border border-primary/20 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/20 dark:text-blue-400"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.name}
                  </Link>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 lg:min-w-48.75">
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{roleLabel}</p>
                  <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{facilityName}</p>
                </div>
                <div className="hidden items-center gap-1 lg:flex">
                  <ThemeSwitcher />
                  <Link
                    href="/settings"
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary dark:hover:text-primary-light"
                    title="تغيير كلمة المرور"
                  >
                    <KeyRound className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => safeLogout()}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-red-600 dark:hover:text-red-400"
                    title="تسجيل الخروج"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main suppressHydrationWarning className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6">
        {children}
      </main>
    </div>
  );
}
