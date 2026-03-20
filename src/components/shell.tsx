"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";
import { LayoutDashboard, ListOrdered, Upload, LogOut, Users, Building2, KeyRound } from "lucide-react";
import { logout } from "@/app/actions/auth";

const baseNavigation = [
  { name: "الرئيسية", href: "/dashboard", icon: LayoutDashboard },
  { name: "الحركات", href: "/transactions", icon: ListOrdered },
];

const adminNavigation = [
  { name: "المستفيدون", href: "/beneficiaries", icon: Users },
  { name: "الاستيراد", href: "/import", icon: Upload },
  { name: "المرافق الصحية", href: "/admin/facilities", icon: Building2 },
];

export function Shell({ children, facilityName, isAdmin = false }: { children: React.ReactNode; facilityName: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const allNav = isAdmin ? [...baseNavigation, ...adminNavigation] : baseNavigation;

  return (
    <div className="page-shell min-h-screen pb-5">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-3 py-2.5 sm:px-5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Waha Healthy Care" width={38} height={38} className="object-contain" />
                <div>
                                    <h1 className="text-sm font-black leading-tight text-slate-900">شركة الواحة</h1>
                  <h2 className="text-sm font-black leading-tight text-slate-900">Waha Healthy Care</h2>
                </div>
              </div>
              <button
                onClick={() => logout()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-red-600 lg:hidden"
                title="تسجيل الخروج"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex gap-1 overflow-x-auto pb-1 lg:pb-0">
                {allNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex min-w-fit items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-bold transition-colors",
                      pathname === item.href || pathname.startsWith(item.href + "/")
                        ? "border border-primary/10 bg-primary-light text-primary"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.name}
                  </Link>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 lg:min-w-48.75">
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{isAdmin ? "مشرف" : "مرفق"}</p>
                  <p className="text-[13px] font-bold text-slate-800">{facilityName}</p>
                </div>
                <div className="hidden items-center gap-1 lg:flex">
                  <Link
                    href="/settings"
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-primary"
                    title="تغيير كلمة المرور"
                  >
                    <KeyRound className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => logout()}
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-red-600"
                    title="تسجيل الخروج"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6">
        {children}
      </main>
    </div>
  );
}
