import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Input, Button } from "@/components/ui";
import { Shell } from "@/components/shell";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Activity, Download } from "lucide-react";
import { AuditLogClearButton } from "../../../components/audit-log-clear-button";

type TargetFilter = "all" | "beneficiaries" | "transactions" | "facilities";

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

function summarizeMetadata(action: string, metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "-";
  const m = metadata as Record<string, unknown>;

  if (action === "CREATE_BENEFICIARY" || action === "UPDATE_BENEFICIARY") {
    return `بطاقة: ${String(m.card_number ?? "-")}`;
  }

  if (action === "DELETE_BENEFICIARY" || action === "PERMANENT_DELETE_BENEFICIARY" || action === "RESTORE_BENEFICIARY") {
    return `مستفيد: ${String(m.beneficiary_id ?? "-")}`;
  }

  if (action === "DEDUCT_BALANCE") {
    return `بطاقة: ${String(m.card_number ?? "-")} · مبلغ: ${String(m.amount ?? "-")}`;
  }

  if (action === "IMPORT_BENEFICIARIES_BACKGROUND") {
    return `تمت إضافة: ${String(m.inserted_rows ?? "-")} · مكررة: ${String(m.duplicate_rows ?? "-")}`;
  }

  if (action === "CANCEL_TRANSACTION") {
    return `حركة: ${String(m.original_transaction_id ?? "-")} · مبلغ مرتجع: ${String(m.refunded_amount ?? "-")}`;
  }

  if (action === "REVERT_CANCELLATION") {
    return `إلغاء: ${String(m.cancellation_transaction_id ?? "-")} · حركة أصلية: ${String(m.original_transaction_id ?? "-")}`;
  }

  if (action === "IMPORT_TRANSACTIONS") {
    return `تمت إضافة: ${String(m.added ?? "-")} · متخطاة: ${String(m.skipped ?? "-")}`;
  }

  if (action === "CREATE_FACILITY") {
    return `مرفق: ${String(m.name ?? "-")} · مستخدم: ${String(m.new_facility_username ?? "-")}`;
  }

  if (action === "IMPORT_FACILITIES") {
    return `تمت إضافة: ${String(m.created ?? "-")} · متخطاة: ${String(m.skipped ?? "-")}`;
  }

  if (action === "DELETE_FACILITY") {
    return `معرف المرفق: ${String(m.deleted_facility_id ?? "-")}`;
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
    targetParam === "beneficiaries" || targetParam === "transactions" || targetParam === "facilities"
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

  const where = {
    action: { in: TARGET_ACTIONS[target] },
    ...(actor?.trim() ? { user: { contains: actor.trim(), mode: "insensitive" as const } } : {}),
    ...(Object.keys(createdAtFilter).length > 0 ? { created_at: createdAtFilter } : {}),
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-light dark:bg-primary-light/10 text-primary dark:text-blue-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">سجل المراقبة</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">متابعة عمليات الإضافة والحذف والحركات مع التاريخ والوقت</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={exportHref}
              target="_blank"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-black text-white! transition-colors hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              تنزيل Excel
            </a>
            <AuditLogClearButton
              target={target}
              actor={actor ?? ""}
              startDate={start_date ?? ""}
              endDate={end_date ?? ""}
            />
            <Badge>{totalCount} عملية</Badge>
          </div>
        </div>

        <Card className="p-4">
          <form method="get" className="grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end">
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

            <Button type="submit" className="h-10">تطبيق الفلتر</Button>
          </form>
        </Card>

        {rows.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">لا توجد سجلات مطابقة للفلاتر الحالية</p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
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
