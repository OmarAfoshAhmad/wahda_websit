"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/core";
import { 
  LogOut, 
  KeyRound, 
  Wrench
} from "lucide-react";
import { logout } from "@/app/actions/auth";
import { ThemeSwitcher } from "./theme-switcher";
import { hasPermission } from "@/lib/permissions";
import { 
  BASE_NAV, 
  MANAGER_NAV, 
  SUPER_ADMIN_NAV, 
  MAINTENANCE_NAV, 
  CASH_CLAIM_NAV, 
  EMPLOYEE_HOME_NAV,
  DENTAL_NAV,
  OPTICS_NAV
} from "@/lib/navigation";
import type { ManagerPermissions, Session } from "@/lib/permissions";

const safeLogout = async () => {
  try { await logout(); } catch { window.location.href = "/login"; }
};

function NavLink({ item, isActive }: { item: any, isActive: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "inline-flex min-w-fit items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-bold transition-colors",
        isActive
          ? "border border-primary/20 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/20 dark:text-blue-400"
          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {item.name}
    </Link>
  );
}

function filterNavByPermission<T extends { perm?: keyof ManagerPermissions }>(
  items: ReadonlyArray<T>,
  session: Session,
): T[] {
  return items.filter((item) => !item.perm || hasPermission(session, item.perm));
}

export function Shell({
  children,
  facilityName,
  session,
}: {
  children: React.ReactNode;
  facilityName: string;
  session: Session;
}) {
  const pathname = usePathname();
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);

  const isAdmin = session.role === "ADMIN";
  const isManager = session.role === "MANAGER";
  const isEmployee = session.role === "EMPLOYEE";
  const canUseCashClaim = hasPermission(session, "cash_claim");

  const permsHash = useMemo(() => JSON.stringify(session.manager_permissions), [session.manager_permissions]);

  const allNav = useMemo(() => {
    const rawMode = process.env.NEXT_PUBLIC_APP_MODE || "BOTH";
    const appMode = rawMode.replace(/["']/g, '').toUpperCase();

    const isSpecializedMode = appMode === "DENTAL" || appMode === "DENTAL_OPTICS";

    // 1. Base Nav (Dashboard/Transactions OR Dental as main)
    let currentBaseNav = BASE_NAV as ReadonlyArray<any>;
    if (appMode === "DENTAL") {
      currentBaseNav = [{ ...DENTAL_NAV, perm: "dental_services" as keyof ManagerPermissions }];
    } else if (appMode === "DENTAL_OPTICS") {
      currentBaseNav = [];
    }
    const filteredBaseNav = filterNavByPermission(currentBaseNav as typeof BASE_NAV, session);

    // 2. Manager Nav (Hide global Beneficiaries in specialized modes)
    const currentManagerNav = isSpecializedMode
      ? MANAGER_NAV.filter(item => item.name !== "المستفيدون")
      : MANAGER_NAV;
    const filteredManagerNav = currentManagerNav.filter(item => hasPermission(session, item.perm));

    const filteredSuperAdminNav = SUPER_ADMIN_NAV.filter(item => hasPermission(session, item.perm));
    
    // 3. Extra Tabs
    const showDentalTab = (appMode === "BOTH" || appMode === "DENTAL_OPTICS") && hasPermission(session, "dental_services");
    const showOpticsTab = (appMode === "BOTH" || appMode === "DENTAL_OPTICS") && hasPermission(session, "optics_services");
    const showCashClaim = !isSpecializedMode && canUseCashClaim;

    if (isAdmin) {
      return [
        ...filteredBaseNav, 
        ...filteredManagerNav, 
        ...(showCashClaim ? [CASH_CLAIM_NAV] : []), 
        ...filteredSuperAdminNav, 
        ...(showDentalTab ? [DENTAL_NAV] : []),
        ...(showOpticsTab ? [OPTICS_NAV] : [])
      ];
    }

    if (isManager || isEmployee) {
      return [
        ...(isEmployee && showCashClaim
          ? [EMPLOYEE_HOME_NAV, ...filteredBaseNav.filter((item) => item.href === "/transactions")]
          : filteredBaseNav),
        ...filteredManagerNav,
        ...(isManager && showCashClaim ? [CASH_CLAIM_NAV] : []),
        ...filteredSuperAdminNav,
        ...(showDentalTab ? [DENTAL_NAV] : []),
        ...(showOpticsTab ? [OPTICS_NAV] : []),
      ];
    }

    return [
      ...filteredBaseNav,
      ...(showCashClaim ? [CASH_CLAIM_NAV] : []),
      ...(showDentalTab ? [DENTAL_NAV] : []),
      ...(showOpticsTab ? [OPTICS_NAV] : []),
    ];
  }, [isAdmin, isManager, isEmployee, canUseCashClaim, permsHash, session]);

  const filteredMaintenanceNav = useMemo(() => {
    return MAINTENANCE_NAV.filter(item => {
      if (isAdmin) return true;
      if (item.perms.length === 0) return false;
      return item.perms.some(p => hasPermission(session, p));
    });
  }, [isAdmin, permsHash, session]);

  const showMaintenance = filteredMaintenanceNav.length > 0;
  const roleLabel = isAdmin ? "المبرمج" : isManager ? "مدير" : isEmployee ? "موظف" : "مرفق";

  return (
    <div className="page-shell min-h-screen pb-5 bg-slate-50 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100 transition-colors" suppressHydrationWarning>
      <nav className="sticky top-0 z-50 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors" suppressHydrationWarning>
        <div className="mx-auto max-w-7xl px-3 py-2.5 sm:px-5" suppressHydrationWarning>
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between" suppressHydrationWarning>
            <div className="flex items-center justify-between gap-4" suppressHydrationWarning>
              <div className="flex items-center gap-3" suppressHydrationWarning>
                <Image src="/logo.png" alt="Waha Health Care" width={38} height={38} priority className="object-contain dark:brightness-110" />
                <div suppressHydrationWarning>
                  <h1 className="text-sm font-black leading-tight text-slate-900 dark:text-white">شركة الواحة</h1>
                  <h2 className="text-sm font-black leading-tight text-slate-900 dark:text-slate-300">Waha Health Care</h2>
                </div>
              </div>
              <div className="flex items-center gap-2 lg:hidden" suppressHydrationWarning>
                <ThemeSwitcher />
                {/* قائمة الصيانة (موبايل) */}
                {showMaintenance && (
                  <div className="relative" suppressHydrationWarning>
                    <button
                      onClick={() => setIsMaintenanceOpen(!isMaintenanceOpen)}
                      className={cn(
                        "inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors",
                        isMaintenanceOpen || pathname.includes("/admin/")
                          ? "border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-200"
                          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                      )}
                      title="الصيانة"
                    >
                      <Wrench className="h-4 w-4" />
                    </button>
                    {isMaintenanceOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsMaintenanceOpen(false)} />
                        <div className="absolute left-0 top-full z-50 mt-2 min-w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" suppressHydrationWarning>
                          {filteredMaintenanceNav.map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => setIsMaintenanceOpen(false)}
                              className={cn(
                                "flex items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold transition-colors",
                                pathname === item.href
                                  ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-blue-400"
                                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                              )}
                            >
                              <item.icon className="h-3.5 w-3.5" />
                              {item.name}
                            </Link>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <Link
                  href="/settings"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-primary dark:hover:text-blue-400"
                  title="تغيير كلمة المرور"
                >
                  <KeyRound className="h-5 w-5" />
                </Link>
                <button
                  onClick={() => safeLogout()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-red-600 dark:hover:text-red-400"
                  title="تسجيل الخروج"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center" suppressHydrationWarning>
              {/* ── روابط التنقل الرئيسية ── */}
              <div className="flex items-center gap-1 pb-1 lg:pb-0" suppressHydrationWarning>
                <div className="flex" suppressHydrationWarning>
                  {allNav.map((item) => (
                    <NavLink 
                      key={item.href} 
                      item={item} 
                      isActive={pathname === item.href || pathname.startsWith(item.href + "/")} 
                    />
                  ))}
                </div>
              </div>

              {/* ── حاوية المعلومات + أزرار التحكم + قائمة الصيانة ── */}
              <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 lg:min-w-fit" suppressHydrationWarning>
                <div className="text-right" suppressHydrationWarning>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{roleLabel}</p>
                  <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{facilityName}</p>
                </div>
                <div className="hidden items-center gap-1 lg:flex" suppressHydrationWarning>
                  <ThemeSwitcher />

                  {/* قائمة الصيانة المنسدلة — بجانب المفتاح والخروج */}
                  {showMaintenance && (
                    <div className="relative" suppressHydrationWarning>
                      <button
                        onClick={() => setIsMaintenanceOpen(!isMaintenanceOpen)}
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-md border transition-colors",
                          isMaintenanceOpen || pathname.includes("/admin/")
                            ? "border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                            : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200"
                        )}
                        title="الصيانة"
                      >
                        <Wrench className="h-4 w-4" />
                      </button>

                      {isMaintenanceOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setIsMaintenanceOpen(false)} />
                          <div className="absolute left-0 top-full z-50 mt-2 min-w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" suppressHydrationWarning>
                            {filteredMaintenanceNav.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setIsMaintenanceOpen(false)}
                                className={cn(
                                  "flex items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold transition-colors",
                                  pathname === item.href
                                    ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-blue-400"
                                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                                )}
                              >
                                <item.icon className="h-3.5 w-3.5" />
                                {item.name}
                              </Link>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

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

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6" suppressHydrationWarning>
        {children}
      </main>
    </div>
  );
}
