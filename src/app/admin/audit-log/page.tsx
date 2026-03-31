import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Input, Button } from "@/components/ui";
import { Shell } from "@/components/shell";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Activity, Download } from "lucide-react";
import { AuditLogClearButton } from "../../../components/audit-log-clear-button";

type TargetFilter = "all" | "beneficiaries" | "transactions" | "facilities" | "completed";

const PAGE_SIZE = 30;

const TARGET_ACTIONS: Record<TargetFilter, string[]> = {
  all: [
    "CREATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
    "DEDUCT_BALANCE",
    "CANCEL_TRANSACTION",
    "REVERT_CANCELLATION",
    "IMPORT_TRANSACTIONS",
    "CREATE_FACILITY",
    "IMPORT_FACILITIES",
    "DELETE_FACILITY",
  ],
  beneficiaries: [
    "CREATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
  ],
  transactions: ["DEDUCT_BALANCE", "CANCEL_TRANSACTION", "REVERT_CANCELLATION", "IMPORT_TRANSACTIONS"],
  facilities: ["CREATE_FACILITY", "IMPORT_FACILITIES", "DELETE_FACILITY"],
  completed: ["DEDUCT_BALANCE", "IMPORT_TRANSACTIONS"],
};

function actionLabel(action: string) {
  switch (action) {
    case "CREATE_BENEFICIARY":
      return "إضافة مستفيد";
    case "IMPORT_BENEFICIARIES_BACKGROUND":
      return "استيراد مستفيدين";
    case "DELETE_BENEFICIARY":
      return "حذف مستفيد";
    case "PERMANENT_DELETE_BENEFICIARY":
      return "حذف نهائي لمستفيد";
    case "RESTORE_BENEFICIARY":
      return "استرجاع مستفيد";
    case "DEDUCT_BALANCE":
      return "إضافة حركة خصم";
    case "CANCEL_TRANSACTION":
      return "حذف/إلغاء حركة";
    case "REVERT_CANCELLATION":
      return "استرجاع حركة ملغاة";
    case "IMPORT_TRANSACTIONS":
      return "استيراد حركات";
    case "CREATE_FACILITY":
      return "إضافة مرفق";
    case "IMPORT_FACILITIES":
      return "استيراد مرافق";
    case "DELETE_FACILITY":
      return "حذف مرفق";
    default:
      return action;
  }
}

function summarizeMetadata(action: string, metadata: unknown): React.ReactNode {
  if (!metadata || typeof metadata !== "object") return "-";
  const m = metadata as Record<string, unknown>;

  if (action === "CREATE_BENEFICIARY") {
    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{String(m.card_number ?? "-")}</span>
        {m.beneficiary_name ? <span className="mr-1.5 text-slate-500 dark:text-slate-400">— {String(m.beneficiary_name)}</span> : null}
      </span>
    );
  }

  if (action === "UPDATE_BENEFICIARY") {
    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{String(m.card_number ?? "-")}</span>
        {m.beneficiary_name ? <span className="mr-1.5 text-slate-500 dark:text-slate-400">— {String(m.beneficiary_name)}</span> : null}
        <span className="mr-1.5 text-xs text-slate-400 dark:text-slate-500">(تعديل بيانات)</span>
      </span>
    );
  }

  if (action === "DELETE_BENEFICIARY" || action === "PERMANENT_DELETE_BENEFICIARY" || action === "RESTORE_BENEFICIARY") {
    const label = action === "DELETE_BENEFICIARY" ? "حذف" : action === "PERMANENT_DELETE_BENEFICIARY" ? "حذف نهائي" : "استرجاع";
    const name = String(m.beneficiary_name ?? m.beneficiary_id ?? "-");
    const card = m.card_number ? ` · بطاقة: ${String(m.card_number)}` : "";
    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{name}</span>
        <span className="mr-1.5 text-xs text-slate-400 dark:text-slate-500">({label}{card})</span>
      </span>
    );
  }

  if (action === "DEDUCT_BALANCE") {
    const name = m.beneficiary_name ? String(m.beneficiary_name) : null;
    const completed = m.beneficiary_completed ? true : false;
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {name && <span className="font-bold text-slate-800 dark:text-slate-200">{name}</span>}
        <span className="text-slate-500 dark:text-slate-400">بطاقة: {String(m.card_number ?? "-")}</span>
        <span className="text-slate-500 dark:text-slate-400">مبلغ: {String(m.amount ?? "-")} د.ل</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">({String(m.type === "MEDICINE" ? "دواء" : m.type === "SUPPLIES" ? "مستلزمات" : String(m.type ?? "-"))})</span>
        {completed && (
          <span className="inline-flex items-center rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
            اكتمل الرصيد ✓
          </span>
        )}
      </span>
    );
  }

  if (action === "IMPORT_BENEFICIARIES_BACKGROUND") {
    const jobId = m.jobId ? String(m.jobId) : null;
    const dupeCount = Number(m.duplicateRows ?? 0);
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
        <span>تمت إضافة: <strong className="text-slate-700 dark:text-slate-300">{String(m.insertedRows ?? "-")}</strong></span>
        <span>مكررة: <strong className="text-slate-700 dark:text-slate-300">{String(m.duplicateRows ?? "-")}</strong></span>
        {m.totalRows ? <span>الإجمالي: <strong className="text-slate-700 dark:text-slate-300">{String(m.totalRows)}</strong></span> : null}
        {jobId && dupeCount > 0 && (
          <a
            href={`/api/export/import-report?jobId=${encodeURIComponent(jobId)}`}
            className="inline-flex items-center gap-1 rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
            title="تصدير تقرير المكررين والمتخطين بصيغة Excel"
          >
            ↓ تقرير المكررين ({dupeCount})
          </a>
        )}
      </span>
    );
  }

  if (action === "CANCEL_TRANSACTION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        مبلغ مرتجع: <strong className="text-slate-700 dark:text-slate-300">{String(m.refunded_amount ?? "-")} د.ل</strong>
        {m.card_number ? <span className="mr-1.5">· بطاقة: {String(m.card_number)}</span> : null}
      </span>
    );
  }

  if (action === "REVERT_CANCELLATION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {m.card_number ? <span>بطاقة: {String(m.card_number)} · </span> : null}
        <span>إلغاء الإلغاء</span>
      </span>
    );
  }

  if (action === "IMPORT_TRANSACTIONS") {
    return (
      <span className="flex flex-wrap gap-x-2 text-slate-500 dark:text-slate-400">
        <span>عائلات: <strong className="text-slate-700 dark:text-slate-300">{String(m.importedFamilies ?? m.added ?? "-")}</strong></span>
        <span>حركات: <strong className="text-slate-700 dark:text-slate-300">{String(m.importedTransactions ?? "-")}</strong></span>
        {m.suspendedFamilies ? <span>موقوفة: <strong className="text-slate-700 dark:text-slate-300">{String(m.suspendedFamilies)}</strong></span> : null}
        {Number(m.skippedNotFound ?? 0) > 0 ? <span className="text-amber-600 dark:text-amber-400">غير موجودة: {String(m.skippedNotFound)}</span> : null}
        {Number(m.skippedAlreadyImported ?? 0) > 0 ? <span className="text-slate-400 dark:text-slate-500">مكررة: {String(m.skippedAlreadyImported)}</span> : null}
      </span>
    );
  }

  if (action === "CREATE_FACILITY") {
    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{String(m.name ?? "-")}</span>
        <span className="mr-1.5 text-slate-400 dark:text-slate-500 font-mono text-xs">{String(m.new_facility_username ?? "-")}</span>
        {m.is_admin ? <span className="mr-1 inline-flex items-center rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">مشرف</span> : null}
      </span>
    );
  }

  if (action === "IMPORT_FACILITIES") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        تمت إضافة: <strong className="text-slate-700 dark:text-slate-300">{String(m.created ?? "-")}</strong>
        {" · "}متخطاة: <strong className="text-slate-700 dark:text-slate-300">{String(m.skipped ?? "-")}</strong>
      </span>
    );
  }

  if (action === "DELETE_FACILITY") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {m.name ? <strong className="text-slate-700 dark:text-slate-300">{String(m.name)}</strong> : null}
        {m.deleted_facility_username ? <span className="mr-1.5 font-mono text-xs">{String(m.deleted_facility_username)}</span> : null}
      </span>
    );
  }

  return "-";
}

function badgeClassForAction(action: string) {
  if (
    action.startsWith("CREATE") ||
    action === "DEDUCT_BALANCE" ||
    action === "IMPORT_TRANSACTIONS" ||
    action === "IMPORT_BENEFICIARIES_BACKGROUND" ||
    action === "IMPORT_FACILITIES"
  ) {
    return "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400";
  }
  if (action.startsWith("DELETE") || action === "CANCEL_TRANSACTION" || action === "PERMANENT_DELETE_BENEFICIARY") {
    return "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400";
  }
  return "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300";
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; target?: string; actor?: string; start_date?: string; end_date?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const { page: pageParam, target: targetParam, actor, start_date, end_date } = await searchParams;

  const target: TargetFilter =
    targetParam === "beneficiaries" || targetParam === "transactions" || targetParam === "facilities" || targetParam === "completed"
      ? targetParam
      : "all";

  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (start_date) {
    const d = new Date(start_date);
    if (!isNaN(d.getTime())) createdAtFilter.gte = d;
  }
  if (end_date) {
    const d = new Date(end_date);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAtFilter.lte = d;
    }
  }

  // فلتر المكتملين: عمليات DEDUCT_BALANCE + IMPORT_TRANSACTIONS التي تحمل beneficiary_completed أو importedFamilies
  const completedMetadataFilter = target === "completed"
    ? { path: ["beneficiary_completed"], equals: true }
    : undefined;

  const where = {
    action: { in: TARGET_ACTIONS[target] },
    ...(actor?.trim() ? { user: { contains: actor.trim(), mode: "insensitive" as const } } : {}),
    ...(Object.keys(createdAtFilter).length > 0 ? { created_at: createdAtFilter } : {}),
    ...(completedMetadataFilter ? { metadata: completedMetadataFilter } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        user: true,
        action: true,
        facility_id: true,
        metadata: true,
        created_at: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const buildHref = (nextPage: number) => {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    params.set("target", target);
    if (actor?.trim()) params.set("actor", actor.trim());
    if (start_date) params.set("start_date", start_date);
    if (end_date) params.set("end_date", end_date);
    return `/admin/audit-log?${params.toString()}`;
  };

  const exportParams = new URLSearchParams();
  exportParams.set("target", target);
  if (actor?.trim()) exportParams.set("actor", actor.trim());
  if (start_date) exportParams.set("start_date", start_date);
  if (end_date) exportParams.set("end_date", end_date);
  const exportHref = `/api/export/audit-log?${exportParams.toString()}`;

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
      <div className="space-y-6 pb-24">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-light dark:bg-primary-light/10 text-primary dark:text-blue-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">سجل المراقبة</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">متابعة عمليات الإضافة والحذف والحركات مع التاريخ والوقت</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{totalCount} عملية</Badge>
            <a
              href={exportHref}
              target="_blank"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-black text-white! transition-colors hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              <span>تنزيل Excel</span>
            </a>
            <AuditLogClearButton
              target={target}
              actor={actor ?? ""}
              startDate={start_date ?? ""}
              endDate={end_date ?? ""}
            />
          </div>
        </div>

        <Card className="p-4">
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5 md:items-end">
            <input type="hidden" name="page" value="1" />

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">النوع</label>
              <select
                name="target"
                defaultValue={target}
                className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <option value="all">الكل</option>
                <option value="beneficiaries">المستفيدون</option>
                <option value="transactions">الحركات</option>
                <option value="facilities">المرافق</option>
                <option value="completed">المكتملون ✓</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المنفذ</label>
              <Input name="actor" defaultValue={actor ?? ""} placeholder="اسم المستخدم" className="h-10" />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">من تاريخ</label>
              <Input type="date" name="start_date" defaultValue={start_date ?? ""} className="h-10" />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">إلى تاريخ</label>
              <Input type="date" name="end_date" defaultValue={end_date ?? ""} className="h-10" />
            </div>

            <div className="sm:col-span-2 md:col-span-1">
              <Button type="submit" className="h-10 w-full">تطبيق الفلتر</Button>
            </div>
          </form>
        </Card>

        {rows.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">لا توجد سجلات مطابقة للفلاتر الحالية</p>
          </Card>
        ) : (
          <>
            {/* ── جدول: شاشات md وأكبر ── */}
            <Card className="hidden md:block overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">العملية</th>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المنفذ</th>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">التفاصيل</th>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${badgeClassForAction(row.action)}`}>
                            {actionLabel(row.action)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm font-bold text-slate-800 dark:text-slate-200">{row.user}</td>
                        <td className="px-5 py-3 text-sm text-slate-600 dark:text-slate-400">{summarizeMetadata(row.action, row.metadata)}</td>
                        <td className="px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                          {new Date(row.created_at).toLocaleString("ar-LY", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ── بطاقات: شاشات أقل من md ── */}
            <div className="md:hidden space-y-2">
              {rows.map((row) => (
                <Card key={row.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${badgeClassForAction(row.action)}`}>
                      {actionLabel(row.action)}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                      {new Date(row.created_at).toLocaleString("ar-LY", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    المنفذ: <span className="text-slate-800 dark:text-slate-200">{row.user}</span>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {summarizeMetadata(row.action, row.metadata)}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-1">
            {page > 1 ? (
              <Link
                href={buildHref(page - 1)}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                السابق
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
                السابق
              </span>
            )}
            <span className="text-sm text-slate-500 dark:text-slate-400">
              صفحة {page} من {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildHref(page + 1)}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                التالي
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
                التالي
              </span>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
