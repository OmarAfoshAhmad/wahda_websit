import { redirect } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";

const PAGE_SIZE = 20;

export default async function ClientErrorsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const where = { action: "CLIENT_ERROR" };

  const [errors, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const buildHref = (p: number) => `/admin/client-errors?page=${p}`;

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
      <div className="space-y-6 pb-24">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">سجل أخطاء العملاء</h2>
              <p className="text-sm text-slate-500">الأخطاء التي حدثت في متصفحات المستخدمين</p>
            </div>
          </div>
          <Badge>{totalCount} خطأ</Badge>
        </div>

        {errors.length === 0 ? (
          <Card className="p-8 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-500">لا توجد أخطاء مسجلة</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {errors.map((err) => {
              const meta = err.metadata as Record<string, string> | null;
              return (
                <Card key={err.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-red-700 wrap-break-word" dir="ltr">
                        {meta?.message ?? "Unknown error"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>
                          {new Date(err.created_at).toLocaleString("ar-LY", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                        {meta?.url && (
                          <span dir="ltr" className="truncate max-w-xs">
                            {meta.url}
                          </span>
                        )}
                        {meta?.ip && <span dir="ltr">IP: {meta.ip}</span>}
                      </div>
                      {meta?.userAgent && (
                        <p className="mt-1 text-[11px] text-slate-400 truncate" dir="ltr">
                          {meta.userAgent}
                        </p>
                      )}
                      {meta?.stack && (
                        <details className="mt-2">
                          <summary className="text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700">
                            عرض Stack Trace
                          </summary>
                          <pre
                            className="mt-1 p-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600 overflow-auto max-h-40 whitespace-pre-wrap"
                            dir="ltr"
                          >
                            {meta.stack}
                          </pre>
                        </details>
                      )}
                    </div>
                    {meta?.digest && (
                      <Badge className="shrink-0 text-[11px]">
                        {meta.digest}
                      </Badge>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            {page > 1 && (
              <a href={buildHref(page - 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
                السابق
              </a>
            )}
            <span className="text-sm text-slate-500">
              صفحة {page} من {totalPages}
            </span>
            {page < totalPages && (
              <a href={buildHref(page + 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
                التالي
              </a>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
