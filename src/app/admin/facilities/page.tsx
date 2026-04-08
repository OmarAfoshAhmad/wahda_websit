import { redirect } from "next/navigation";
import Link from "next/link";
import { User, Download } from "lucide-react";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/session-guard";
import { getArabicSearchTerms } from "@/lib/search";
import { Shell } from "@/components/shell";
import { Card, Badge, Input, Button } from "@/components/ui";
import { CreateFacilityForm } from "./create-form";
import { FacilityEditModal } from "@/components/facility-edit-modal";
import { FacilityDeleteButton } from "@/components/facility-delete-button";
import { FacilityImportUploader } from "@/components/facility-import-uploader";
import { PaginationButtons } from "@/components/pagination-buttons";
import { PrintButton } from "@/components/print-button";

const PAGE_SIZE = 8;

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; order?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin && !(session.is_manager && hasPermission(session, "view_facilities"))) {
    redirect("/dashboard");
  }

  const { q, page: pageParam, sort, order } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const ALLOWED_SORT = ["name", "username", "created_at"] as const;
  type SortCol = typeof ALLOWED_SORT[number];
  const sortCol: SortCol = (ALLOWED_SORT as ReadonlyArray<string>).includes(sort ?? "") ? sort as SortCol : "created_at";
  const sortDir: "asc" | "desc" = order === "desc" ? "desc" : "asc";

  const where = {
    deleted_at: null,
    is_admin: false,
    is_manager: false,
    ...(q && q.trim()
      ? {
        OR: getArabicSearchTerms(q.trim()).flatMap(t => [
          { name: { contains: t, mode: "insensitive" as const } },
          { username: { contains: t, mode: "insensitive" as const } },
        ]),
      }
      : {}),
  };

  const allWhere = {
    deleted_at: null,
    is_admin: false,
    is_manager: false,
  };

  const [facilities, totalCount, allFacilities] = await Promise.all([
    prisma.facility.findMany({
      where,
      orderBy: { [sortCol]: sortDir },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        username: true,
        is_admin: true,
        must_change_password: true,
        created_at: true,
        _count: { select: { transactions: true } },
      },
    }),
    prisma.facility.count({ where }),
    prisma.facility.findMany({
      where: allWhere,
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        name: true,
        username: true,
        is_admin: true,
        created_at: true,
        _count: { select: { transactions: true } },
      },
    }),
  ]);

  const canAdd = hasPermission(session, "add_facility");
  const canEdit = hasPermission(session, "edit_facility");
  const canDelete = hasPermission(session, "delete_facility");
  const canExport = hasPermission(session, "export_data");

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", sortCol);
    params.set("order", sortDir);
    params.set("page", String(p));
    return `/admin/facilities?${params.toString()}`;
  };

  const sortHref = (col: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", col);
    params.set("order", sortCol === col && sortDir === "asc" ? "desc" : "asc");
    params.set("page", "1");
    return `/admin/facilities?${params.toString()}`;
  };

  return (
    <Shell facilityName={session.name} session={session}>
      <div id="printable-report" className="space-y-6 pb-24">

        {/* ترويسة الطباعة فقط */}
        <div className="hidden print:flex flex-col items-center justify-center mb-6 text-center border-b pb-4 pt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Waha Health Care" className="h-16 w-auto object-contain mb-3" />
          <h1 className="text-xl font-black text-black">Waha Health Care</h1>
          <h2 className="text-lg font-bold text-black mt-1">تقرير المرافق الصحية المسجلة</h2>
          <p className="text-sm text-black mt-1 opacity-75">تاريخ استخراج التقرير: {new Date().toLocaleDateString("en-GB")}</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 print:hidden">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">إدارة المرافق الصحية</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">قائمة بالمرافق الصحية المسجلة في النظام.</p>
          </div>
          <div className="no-print flex items-center gap-2">
            {canExport && (
              <a
                href="/api/export/facilities"
                target="_blank"
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white! transition-colors hover:bg-emerald-700 dark:hover:bg-emerald-600 h-10"
              >
                <Download className="h-4 w-4" />
                تصدير Excel
              </a>
            )}
            <PrintButton />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* قائمة المرافق */}
          <div className="space-y-4">

            {/* شريط البحث */}
            <form method="get" className="flex gap-2 print:hidden">
              <input type="hidden" name="page" value="1" />
              <Input
                name="q"
                defaultValue={q ?? ""}
                placeholder="ابحث باسم المرفق أو اسم المستخدم..."
                className="h-10 text-sm"
                autoComplete="off"
              />
              <Button type="submit" className="h-10 px-5 shrink-0">بحث</Button>
            </form>

            <Card className="overflow-hidden p-0">
              {/* عرض الجدول للطباعة والشاشات الكبيرة */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 dark:text-slate-400 uppercase w-12">#</th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 dark:text-slate-400 uppercase">
                        <Link href={sortHref("name")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                          اسم المرفق {sortCol === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                        </Link>
                      </th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 dark:text-slate-400 uppercase">
                        <Link href={sortHref("username")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                          اسم المستخدم {sortCol === "username" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                        </Link>
                      </th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 dark:text-slate-400 uppercase">القيمة المصروفة</th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 dark:text-slate-400 uppercase">الحالة</th>
                      {(canEdit || canDelete || session.is_admin) && <th className="px-5 py-3 text-center text-xs font-black text-slate-500 dark:text-slate-400 uppercase no-print">إجراءات</th>}
                    </tr>
                  </thead>
                  {/* صفوف الشاشة (الصفحة الحالية فقط) */}
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:hidden">
                    {facilities.length === 0 ? (
                      <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500 dark:text-slate-400">لا توجد مرافق مسجلة.</td></tr>
                    ) : (
                      facilities.map((f, idx) => (
                        <tr key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-5 py-3 text-sm font-bold text-slate-500 dark:text-slate-400 text-center font-mono">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                          <td className="px-5 py-3 text-sm font-bold text-slate-900 dark:text-white text-center">{f.name}</td>
                          <td className="px-5 py-3 text-sm font-mono text-slate-600 dark:text-slate-300 text-center">{f.username}</td>
                          <td className="px-5 py-3 text-sm text-slate-900 dark:text-white text-center">{f._count.transactions}</td>
                          <td className="px-5 py-3 text-center">
                            {f.is_admin ? (
                              <span className="inline-flex items-center rounded-md bg-green-50 dark:bg-green-900/30 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-400 ring-1 ring-inset ring-green-600/20 dark:ring-green-900/50">المبرمج</span>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-slate-50 dark:bg-slate-800/50 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 ring-1 ring-inset ring-slate-600/20 dark:ring-slate-700">مرفق</span>
                            )}
                          </td>
                          {(canEdit || canDelete || session.is_admin) && (
                            <td className="px-5 py-3 no-print">
                              <div className="flex items-center justify-center gap-2">
                                {!f.is_admin && (
                                  <>
                                    {canEdit && <FacilityEditModal facility={{ id: f.id, name: f.name, username: f.username }} />}
                                    {canDelete && f.id !== session.id && (
                                      <FacilityDeleteButton
                                        id={f.id}
                                        name={f.name}
                                        transactionCount={f._count.transactions}
                                      />
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                  {/* صفوف الطباعة (كل المرافق) */}
                  <tbody className="divide-y divide-slate-100 hidden print:table-row-group">
                    {allFacilities.map((f, idx) => (
                      <tr key={f.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 text-sm font-bold text-slate-500 text-center font-mono">{idx + 1}</td>
                        <td className="px-5 py-3 text-sm font-bold text-slate-900 text-center">{f.name}</td>
                        <td className="px-5 py-3 text-sm font-mono text-slate-600 text-center">{f.username}</td>
                        <td className="px-5 py-3 text-sm text-slate-900 text-center">{f._count.transactions}</td>
                        <td className="px-5 py-3 text-center">
                          {f.is_admin ? (
                            <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">المبرمج</span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-600/20">مرفق</span>
                          )}
                        </td>
                        <td className="px-5 py-3 no-print"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* عرض الموبايل (يختفي في الطباعة) */}
              <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800 block no-print">
                {facilities.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">لا توجد مرافق مسجلة بعد.</p>
                ) : (
                  facilities.map((f) => (
                    <div key={f.id} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                          <User className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white">{f.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-mono">{f.username}</span>
                            {" · "}
                            {f._count.transactions} عملية
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 no-print">
                        {f.is_admin ? (
                          <Badge variant="success">المبرمج</Badge>
                        ) : (
                          <Badge variant="default">مرفق</Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          {/* استيراد وإنشاء (عمود جانبي) — متاح للمشرف فقط */}
          <div className="space-y-4 no-print">
            {(session.is_admin || canAdd) && (
              <Card className="p-4">
                <FacilityImportUploader />
                <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <h3 className="mb-3 text-sm font-black text-slate-900 dark:text-white">إضافة مرفق جديد يدوياً</h3>
                  <CreateFacilityForm />
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* ══ شريط الـ Pagination الثابت في الأسفل ══ */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm shadow-[0_-1px_8px_rgba(0,0,0,0.06)] print:hidden">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              الإجمالي:{" "}
              <strong className="font-black text-slate-900 dark:text-white">{totalCount.toLocaleString("ar-LY")}</strong>{" "}
              مرفق
              {totalPages > 1 && (
                <span className="hidden sm:inline text-slate-400 dark:text-slate-500 mr-3">
                  · صفحة <strong className="text-slate-700 dark:text-slate-300">{page}</strong> من{" "}
                  <strong className="text-slate-700 dark:text-slate-300">{totalPages}</strong>
                </span>
              )}
            </span>

            <div className="flex gap-2">
              <PaginationButtons page={page} totalPages={totalPages} hrefForPage={buildHref} />
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
