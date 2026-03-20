import { redirect } from "next/navigation";
import { Building2, Plus, User } from "lucide-react";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { Card, Badge, Input, Button } from "@/components/ui";
import { CreateFacilityForm } from "./create-form";
import { FacilityEditModal } from "@/components/facility-edit-modal";
import { FacilityDeleteButton } from "@/components/facility-delete-button";
import { FacilityImportUploader } from "@/components/facility-import-uploader";
import { PrintButton } from "@/components/print-button";

const PAGE_SIZE = 8;

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const where = {
    deleted_at: null,
    ...(q && q.trim()
      ? {
          OR: [
            { name: { contains: q.trim(), mode: "insensitive" as const } },
            { username: { contains: q.trim(), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [facilities, totalCount] = await Promise.all([
    prisma.facility.findMany({
      where,
      orderBy: { created_at: "asc" },
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
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("page", String(p));
    return `/admin/facilities?${params.toString()}`;
  };

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
      <div id="printable-report" className="space-y-6 pb-24">

        {/* ترويسة الطباعة فقط */}
        <div className="hidden print:flex flex-col items-center justify-center mb-6 text-center border-b pb-4 pt-4">
           {/* eslint-disable-next-line @next/next/no-img-element */}
           <img src="/logo.svg" alt="Waha Healthy Care" className="h-16 w-auto object-contain mb-3" />
           <h1 className="text-xl font-black text-black">Waha Healthy Care</h1>
           <h2 className="text-lg font-bold text-black mt-1">تقرير المرافق الصحية المسجلة</h2>
           <p className="text-sm text-black mt-1 opacity-75">تاريخ استخراج التقرير: {new Date().toLocaleDateString("ar-LY")}</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 print:hidden">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950">إدارة المرافق الصحية</h1>
            <p className="mt-1.5 text-sm text-slate-600">قائمة بالمرافق الصحية المسجلة في النظام.</p>
          </div>
          <div className="no-print">
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
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 uppercase w-12">#</th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 uppercase">اسم المرفق</th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 uppercase">اسم المستخدم</th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 uppercase">العمليات</th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 uppercase">الحالة</th>
                      <th className="px-5 py-3 text-center text-xs font-black text-slate-500 uppercase no-print">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {facilities.length === 0 ? (
                        <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">لا توجد مرافق مسجلة.</td></tr>
                     ) : (
                        facilities.map((f, idx) => (
                          <tr key={f.id}>
                            <td className="px-5 py-3 text-sm font-bold text-slate-500 text-center font-mono">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                            <td className="px-5 py-3 text-sm font-bold text-slate-900 text-center">{f.name}</td>
                            <td className="px-5 py-3 text-sm font-mono text-slate-600 text-center">{f.username}</td>
                            <td className="px-5 py-3 text-sm text-slate-900 text-center">{f._count.transactions}</td>
                            <td className="px-5 py-3 text-center">
                                {f.is_admin ? (
                                  <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">مشرف</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-600/20">مرفق</span>
                                )}
                            </td>
                            <td className="px-5 py-3 no-print">
                                <div className="flex items-center justify-center gap-2">
                                  {!f.is_admin && (
                                    <>
                                      <FacilityEditModal facility={{ id: f.id, name: f.name, username: f.username }} />
                                      {f.id !== session.id && (
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
                          </tr>
                        ))
                     )}
                  </tbody>
                </table>
              </div>
              
              {/* عرض الموبايل (يختفي في الطباعة) */}
              <div className="sm:hidden divide-y divide-slate-100 block no-print">
                {facilities.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-slate-500">لا توجد مرافق مسجلة بعد.</p>
                ) : (
                  facilities.map((f) => (
                    <div key={f.id} className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
                          <User className="h-4 w-4 text-slate-500" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{f.name}</p>
                          <p className="text-xs text-slate-500">
                            <span className="font-mono">{f.username}</span>
                            {" · "}
                            {f._count.transactions} عملية
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 no-print">
                         {f.is_admin ? (
                          <Badge variant="success">مشرف</Badge>
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

          {/* استيراد وإنشاء (عمود جانبي) */}
          <div className="space-y-4 no-print">
            <Card className="p-4">
              <FacilityImportUploader />
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="mb-3 text-sm font-black text-slate-900">إضافة مرفق جديد يدوياً</h3>
                <CreateFacilityForm />
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* ══ شريط الـ Pagination الثابت في الأسفل ══ */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-sm shadow-[0_-1px_8px_rgba(0,0,0,0.06)] print:hidden">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-sm text-slate-500">
              الإجمالي:{" "}
              <strong className="font-black text-slate-900">{totalCount.toLocaleString("ar-LY")}</strong>{" "}
              مرفق
              {totalPages > 1 && (
                <span className="hidden sm:inline text-slate-400 mr-3">
                  · صفحة <strong className="text-slate-700">{page}</strong> من{" "}
                  <strong className="text-slate-700">{totalPages}</strong>
                </span>
              )}
            </span>

            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={buildHref(page - 1)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
                >
                  &#8592; السابق
                </Link>
              ) : (
                <span className="inline-flex items-center rounded-md border border-slate-100 bg-slate-50 px-4 py-2 text-sm font-black text-slate-300 cursor-not-allowed">
                  &#8592; السابق
                </span>
              )}
              {page < totalPages ? (
                <Link
                  href={buildHref(page + 1)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
                >
                  التالي &#8594;
                </Link>
              ) : (
                <span className="inline-flex items-center rounded-md border border-slate-100 bg-slate-50 px-4 py-2 text-sm font-black text-slate-300 cursor-not-allowed">
                  التالي &#8594;
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
