import Link from "next/link";
import prisma from "@/lib/prisma";
import { formatDateTripoli } from "@/lib/datetime";
import { AlertTriangle } from "lucide-react";
import { DataHygieneSweepButton } from "@/components/data-hygiene-sweep-button";
import { UnlinkedCorrectionsFixButton } from "@/components/unlinked-corrections-fix-button";
import { DuplicateMovementsFixButton } from "@/components/duplicate-movements-fix-button";
import { InvalidPasswordFacilitiesFixButton } from "@/components/invalid-password-facilities-fix-button";
import { DeletedFacilitiesFixButton } from "@/components/deleted-facilities-fix-button";
import { FixBalancesButton } from "@/components/fix-balances-button";
import { StatusAnomaliesCheckButton } from "@/components/status-anomalies-check-button";
import { OrphanedNotificationsCheckButton } from "@/components/orphaned-notifications-check-button";
import { StatusAnomaliesFixButton } from "@/components/status-anomalies-fix-button";
import { OrphanedNotificationsFixButton } from "@/components/orphaned-notifications-fix-button";

type UnlinkedCorrectionRow = {
  id: string;
  beneficiary_id: string;
  facility_id: string;
  amount: number;
  created_at: Date;
  is_cancelled: boolean;
  beneficiary_name: string;
  card_number: string;
  facility_name: string;
};

type DuplicateMovementRow = {
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  type: string;
  amount: number;
  movement_day: Date;
  duplicate_count: number;
  first_created_at: Date;
  last_created_at: Date;
};

type ExperimentalNoPasswordFacilityRow = {
  id: string;
  name: string;
  username: string;
  must_change_password: boolean;
  created_at: Date;
  password_len: number;
};

type DeletedFacilityRow = {
  id: string;
  name: string;
  username: string;
  deleted_at: Date;
};

type AuthStateFacility = {
  id: string;
  name: string;
  username: string;
  deleted_at: Date | null;
  must_change_password: boolean;
  created_at: Date;
  password_hash: string;
};

type AuthStateRow = {
  id: string;
  name: string;
  username: string;
  deleted: boolean;
  must_change_password: boolean;
  hash_valid_bcrypt: boolean;
  last_login_at: Date | null;
  last_reset_at: Date | null;
  reset_no_login: boolean;
};

type BalanceDriftRow = {
  id: string;
  name: string;
  card_number: string;
  status: string;
  total_balance: number;
  stored_remaining: number;
  computed_remaining: number;
  drift: number;
};

type StatusAnomalyRow = {
  id: string;
  name: string;
  card_number: string;
  status: string;
  remaining_balance: number;
  total_balance: number;
  anomaly_type: string;
};

type OrphanedNotificationRow = {
  id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  title: string;
  created_at: Date;
};

type OldReadNotificationSummary = {
  old_read_count: number;
};

type OldLoginAuditSummary = {
  old_login_count: number;
};

type OldImportJobsSummary = {
  old_import_jobs_count: number;
};

type OldRestoreJobsSummary = {
  old_restore_jobs_count: number;
};

function Num({ value }: { value: number }) {
  return <span>{value.toLocaleString("ar-LY")}</span>;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
        {title} ({count.toLocaleString("ar-LY")})
      </h2>
      {children}
    </section>
  );
}

export async function DataHealthContent({
  withinDuplicatesTab = false,
  searchQuery = "",
}: {
  withinDuplicatesTab?: boolean;
  searchQuery?: string;
}) {
  const [
    unlinkedCorrections,
    duplicateMovements,
    invalidPasswordFacilities,
    deletedFacilities,
    mustChangePasswordCount,
    allFacilitiesForAuth,
    loginLogs,
    resetLogs,
    balanceDriftRows,
    statusAnomalyRows,
    orphanedNotificationRows,
    oldReadNotificationSummary,
    oldLoginAuditSummary,
    oldImportJobsSummary,
    oldRestoreJobsSummary,
  ] = await Promise.all([
    prisma.$queryRaw<UnlinkedCorrectionRow[]>`
      SELECT
        t.id,
        t.beneficiary_id,
        t.facility_id,
        t.amount::float8 AS amount,
        t.created_at,
        t.is_cancelled,
        b.name AS beneficiary_name,
        b.card_number,
        f.name AS facility_name
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      JOIN "Facility" f ON f.id = t.facility_id
      WHERE t.type = 'CANCELLATION'
        AND t.original_transaction_id IS NULL
        AND t.is_cancelled = false
      ORDER BY t.created_at DESC
      LIMIT 300
    `,

    prisma.$queryRaw<DuplicateMovementRow[]>`
      SELECT
        t.beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        t.type,
        t.amount::float8 AS amount,
        (t.created_at AT TIME ZONE 'Africa/Tripoli')::date AS movement_day,
        COUNT(*)::int AS duplicate_count,
        MIN(t.created_at) AS first_created_at,
        MAX(t.created_at) AS last_created_at
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.is_cancelled = false
        AND t.type <> 'CANCELLATION'
      GROUP BY
        t.beneficiary_id,
        b.name,
        b.card_number,
        t.type,
        t.amount,
        (t.created_at AT TIME ZONE 'Africa/Tripoli')::date
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, last_created_at DESC
      LIMIT 300
    `,

    prisma.$queryRaw<ExperimentalNoPasswordFacilityRow[]>`
      SELECT
        f.id,
        f.name,
        f.username,
        f.must_change_password,
        f.created_at,
        COALESCE(LENGTH(BTRIM(f.password_hash)), 0)::int AS password_len
      FROM "Facility" f
      WHERE f.deleted_at IS NULL
        AND (
          f.password_hash IS NULL
          OR BTRIM(f.password_hash) = ''
          OR f.password_hash !~ '^\\$2[aby]\\$.{56}$'
        )
      ORDER BY f.created_at DESC
      LIMIT 200
    `,

    prisma.$queryRaw<DeletedFacilityRow[]>`
      SELECT id, name, username, deleted_at
      FROM "Facility"
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT 200
    `,

    prisma.facility.count({
      where: {
        deleted_at: null,
        must_change_password: true,
      },
    }),

    prisma.facility.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        deleted_at: true,
        must_change_password: true,
        created_at: true,
        password_hash: true,
      },
      orderBy: { created_at: "desc" },
    }),

    prisma.auditLog.findMany({
      where: { action: "LOGIN" },
      select: { facility_id: true, user: true, created_at: true },
      orderBy: { created_at: "desc" },
      take: 50_000,
    }),

    prisma.auditLog.findMany({
      where: { action: "UPDATE_FACILITY" },
      select: { metadata: true, created_at: true, user: true },
      orderBy: { created_at: "desc" },
      take: 50_000,
    }),

    prisma.$queryRaw<BalanceDriftRow[]>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        b.status::text,
        b.total_balance::float8 AS total_balance,
        b.remaining_balance::float8 AS stored_remaining,
        GREATEST(0,
          b.total_balance - COALESCE(
            SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END),
            0
          )
        )::float8 AS computed_remaining,
        (b.remaining_balance - GREATEST(0,
          b.total_balance - COALESCE(
            SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END),
            0
          )
        ))::float8 AS drift
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
      GROUP BY b.id, b.name, b.card_number, b.status, b.total_balance, b.remaining_balance
      HAVING ABS(
        b.remaining_balance - GREATEST(0,
          b.total_balance - COALESCE(
            SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END),
            0
          )
        )
      ) > 0.01
      ORDER BY ABS(
        b.remaining_balance - GREATEST(0,
          b.total_balance - COALESCE(
            SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END),
            0
          )
        )
      ) DESC
      LIMIT 300
    `,

    prisma.$queryRaw<StatusAnomalyRow[]>`
      SELECT
        id,
        name,
        card_number,
        status::text,
        remaining_balance::float8,
        total_balance::float8,
        CASE
          WHEN status = 'ACTIVE'   AND remaining_balance <= 0.01 THEN 'نشط برصيد صفري (يجب أن يكون مكتمل)'
          WHEN status = 'FINISHED' AND remaining_balance > 0.01  THEN 'مكتمل برصيد موجب (يجب مراجعة)'
          ELSE 'غير معروف'
        END AS anomaly_type
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND (
          (status = 'ACTIVE'   AND remaining_balance <= 0.01)
          OR (status = 'FINISHED' AND remaining_balance > 0.01)
        )
      ORDER BY card_number
      LIMIT 300
    `,

    prisma.$queryRaw<OrphanedNotificationRow[]>`
      SELECT
        n.id,
        n.beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        n.title,
        n.created_at
      FROM "Notification" n
      JOIN "Beneficiary" b ON b.id = n.beneficiary_id
      WHERE b.deleted_at IS NOT NULL
      ORDER BY n.created_at DESC
      LIMIT 200
    `,

    prisma.$queryRaw<OldReadNotificationSummary[]>`
      SELECT COUNT(*)::int AS old_read_count
      FROM "Notification" n
      JOIN "Beneficiary" b ON b.id = n.beneficiary_id
      WHERE n.is_read = true
        AND n.created_at < NOW() - INTERVAL '90 days'
        AND b.deleted_at IS NULL
    `,

    prisma.$queryRaw<OldLoginAuditSummary[]>`
      SELECT COUNT(*)::int AS old_login_count
      FROM "AuditLog"
      WHERE action IN ('LOGIN', 'LOGOUT')
        AND created_at < NOW() - INTERVAL '180 days'
    `,

    prisma.$queryRaw<OldImportJobsSummary[]>`
      SELECT COUNT(*)::int AS old_import_jobs_count
      FROM "ImportJob"
      WHERE status IN ('COMPLETED', 'FAILED', 'ROLLED_BACK')
        AND created_at < NOW() - INTERVAL '30 days'
    `,

    prisma.$queryRaw<OldRestoreJobsSummary[]>`
      SELECT COUNT(*)::int AS old_restore_jobs_count
      FROM "RestoreJob"
      WHERE status IN ('COMPLETED', 'FAILED')
        AND created_at < NOW() - INTERVAL '30 days'
    `,
  ]);

  const lastLoginByFacilityId = new Map<string, Date>();
  const lastLoginByUsername = new Map<string, Date>();
  for (const log of loginLogs) {
    if (log.facility_id && !lastLoginByFacilityId.has(log.facility_id)) {
      lastLoginByFacilityId.set(log.facility_id, log.created_at);
    }
    if (log.user && !lastLoginByUsername.has(log.user)) {
      lastLoginByUsername.set(log.user, log.created_at);
    }
  }

  const lastResetByFacilityId = new Map<string, Date>();
  for (const log of resetLogs) {
    const meta = log.metadata as Record<string, unknown> | null;
    if (!meta) continue;
    const facilityId = typeof meta.facility_id === "string" ? meta.facility_id : null;
    const resetPassword = meta.reset_password === true;
    if (facilityId && resetPassword && !lastResetByFacilityId.has(facilityId)) {
      lastResetByFacilityId.set(facilityId, log.created_at);
    }
  }

  const authStateRows: AuthStateRow[] = (allFacilitiesForAuth as AuthStateFacility[])
    .map((f) => {
      const hash = f.password_hash ?? "";
      const hashValidBcrypt = /^\$2[aby]\$.{56}$/.test(hash);
      const lastLogin = lastLoginByFacilityId.get(f.id) ?? lastLoginByUsername.get(f.username) ?? null;
      const lastReset = lastResetByFacilityId.get(f.id) ?? null;
      const resetNoLogin = Boolean(lastReset && (!lastLogin || lastLogin < lastReset));

      return {
        id: f.id,
        name: f.name,
        username: f.username,
        deleted: Boolean(f.deleted_at),
        must_change_password: f.must_change_password,
        hash_valid_bcrypt: hashValidBcrypt,
        last_login_at: lastLogin,
        last_reset_at: lastReset,
        reset_no_login: resetNoLogin,
      };
    })
    .filter((row) => row.deleted || !row.hash_valid_bcrypt || row.must_change_password || row.reset_no_login || !row.last_login_at);

  const authStateSummary = {
    active_no_hash_problem: authStateRows.filter((row) => !row.deleted && !row.hash_valid_bcrypt).length,
    deleted: authStateRows.filter((row) => row.deleted).length,
    must_change_password: authStateRows.filter((row) => !row.deleted && row.must_change_password).length,
    reset_no_login: authStateRows.filter((row) => !row.deleted && row.reset_no_login).length,
    never_logged_in: authStateRows.filter((row) => !row.deleted && !row.last_login_at).length,
  };

  const oldReadNotifications = Number(oldReadNotificationSummary[0]?.old_read_count ?? 0);
  const oldLoginAuditLogs = Number(oldLoginAuditSummary[0]?.old_login_count ?? 0);
  const oldImportJobs = Number(oldImportJobsSummary[0]?.old_import_jobs_count ?? 0);
  const oldRestoreJobs = Number(oldRestoreJobsSummary[0]?.old_restore_jobs_count ?? 0);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const hasSearchQuery = normalizedSearchQuery.length > 0;

  const filteredBalanceDriftRows = hasSearchQuery
    ? balanceDriftRows.filter(
      (row) =>
        row.name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : balanceDriftRows;

  const filteredStatusAnomalyRows = hasSearchQuery
    ? statusAnomalyRows.filter(
      (row) =>
        row.name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : statusAnomalyRows;

  const filteredOrphanedNotificationRows = hasSearchQuery
    ? orphanedNotificationRows.filter(
      (row) =>
        row.beneficiary_name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : orphanedNotificationRows;

  const filteredUnlinkedCorrections = hasSearchQuery
    ? unlinkedCorrections.filter(
      (row) =>
        row.beneficiary_name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : unlinkedCorrections;

  const filteredDuplicateMovements = hasSearchQuery
    ? duplicateMovements.filter(
      (row) =>
        row.beneficiary_name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : duplicateMovements;

  const duplicateMovementsCandidateCount = duplicateMovements.reduce(
    (sum, row) => sum + Math.max(0, Number(row.duplicate_count ?? 0) - 1),
    0
  );
  const hygieneCandidates =
    orphanedNotificationRows.length + oldReadNotifications + oldLoginAuditLogs + oldImportJobs + oldRestoreJobs;

  return (
    <div className="space-y-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-2xl font-black">نافذة صحة البيانات وتنظيف القاعدة</h1>
        <p className="text-sm text-slate-600">
          نافذة فحص وتشخيص مباشر مع تنظيف آمن للسجلات اليتيمة والقديمة.
        </p>
        {!withinDuplicatesTab && (
          <p className="text-xs text-slate-500">
            ضمن إدارة التكرارات: <Link href="/admin/duplicates?tab=health" className="font-bold text-primary hover:underline">تبويب صحة البيانات</Link>
          </p>
        )}
      </header>

      <Section title="تنظيف السجلات اليتيمة والقديمة" count={hygieneCandidates}>
        <p className="text-xs text-slate-600">
          تشمل هذه العملية: حذف الإشعارات اليتيمة، حذف الإشعارات المقروءة القديمة، تنظيف سجلات LOGIN/LOGOUT القديمة،
          وحذف وظائف الاستيراد/الاستعادة القديمة المنتهية.
        </p>
        <div className="grid grid-cols-1 gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
          <p>إشعارات يتيمة: <strong>{orphanedNotificationRows.length.toLocaleString("ar-LY")}</strong></p>
          <p>إشعارات مقروءة قديمة: <strong>{oldReadNotifications.toLocaleString("ar-LY")}</strong></p>
          <p>سجلات دخول/خروج قديمة: <strong>{oldLoginAuditLogs.toLocaleString("ar-LY")}</strong></p>
          <p>وظائف استيراد قديمة: <strong>{oldImportJobs.toLocaleString("ar-LY")}</strong></p>
          <p>وظائف استعادة قديمة: <strong>{oldRestoreJobs.toLocaleString("ar-LY")}</strong></p>
        </div>
        <div className="pt-2">
          <DataHygieneSweepButton
            counts={{
              orphaned_notifications: orphanedNotificationRows.length,
              old_read_notifications: oldReadNotifications,
              old_login_audit_logs: oldLoginAuditLogs,
              old_import_jobs: oldImportJobs,
              old_restore_jobs: oldRestoreJobs,
            }}
          />
        </div>
      </Section>

      <Section title="انجراف الرصيد — remaining_balance ≠ المحسوب" count={filteredBalanceDriftRows.length}>
        <div className="mb-2 flex justify-start">
          <FixBalancesButton />
        </div>

        {filteredBalanceDriftRows.length === 0 ? (
          <p className="text-sm text-emerald-600 font-medium">✓ لا يوجد انجراف — جميع الأرصدة متطابقة مع الحركات</p>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                إجمالي الانجراف: <strong>{filteredBalanceDriftRows.reduce((s, r) => s + Math.abs(r.drift), 0).toFixed(2)} د.ل</strong>
                {" "}موزعة على {filteredBalanceDriftRows.length} مستفيد.
              </span>
            </div>
            <div className="overflow-x-auto mt-2">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                    <th className="p-2">المستفيد</th>
                    <th className="p-2">البطاقة</th>
                    <th className="p-2">الحالة</th>
                    <th className="p-2">الرصيد الكلي</th>
                    <th className="p-2">المخزون</th>
                    <th className="p-2">المحسوب</th>
                    <th className="p-2 text-red-600">الانجراف</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBalanceDriftRows.map((row) => (
                    <tr key={row.id} className={`border-b dark:border-slate-800 ${Math.abs(row.drift) > 1 ? "bg-red-50/60 dark:bg-red-950/20" : ""}`}>
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.card_number}</td>
                      <td className="p-2">{row.status}</td>
                      <td className="p-2 text-left ltr"><Num value={row.total_balance} /></td>
                      <td className="p-2 text-left ltr"><Num value={row.stored_remaining} /></td>
                      <td className="p-2 text-left ltr font-medium text-emerald-700"><Num value={row.computed_remaining} /></td>
                      <td className={`p-2 text-left ltr font-bold ${row.drift > 0 ? "text-amber-700" : "text-red-700"}`}>
                        {row.drift > 0 ? "+" : ""}{row.drift.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section title="تناقض حالة المستفيد مع رصيده" count={filteredStatusAnomalyRows.length}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusAnomaliesCheckButton />
          <StatusAnomaliesFixButton />
        </div>

        {filteredStatusAnomalyRows.length === 0 ? (
          <p className="text-sm text-emerald-600 font-medium">✓ لا توجد تناقضات — جميع الحالات متسقة مع الأرصدة</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="p-2">المستفيد</th>
                  <th className="p-2">البطاقة</th>
                  <th className="p-2">الحالة المخزونة</th>
                  <th className="p-2">الرصيد المتبقي</th>
                  <th className="p-2">الرصيد الكلي</th>
                  <th className="p-2">نوع التناقض</th>
                </tr>
              </thead>
              <tbody>
                {filteredStatusAnomalyRows.map((row) => (
                  <tr key={row.id} className="border-b bg-amber-50/40 dark:border-slate-800 dark:bg-amber-950/20">
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.card_number}</td>
                    <td className="p-2 font-mono text-xs">{row.status}</td>
                    <td className="p-2 text-left ltr"><Num value={row.remaining_balance} /></td>
                    <td className="p-2 text-left ltr"><Num value={row.total_balance} /></td>
                    <td className="p-2 text-amber-700 text-xs">{row.anomaly_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="إشعارات لمستفيدين محذوفين (يتامى)" count={filteredOrphanedNotificationRows.length}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <OrphanedNotificationsCheckButton />
          <OrphanedNotificationsFixButton />
        </div>

        {filteredOrphanedNotificationRows.length === 0 ? (
          <p className="text-sm text-emerald-600 font-medium">✓ لا توجد إشعارات يتامى</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="p-2">المستفيد (محذوف)</th>
                  <th className="p-2">البطاقة</th>
                  <th className="p-2">عنوان الإشعار</th>
                  <th className="p-2">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrphanedNotificationRows.map((row) => (
                  <tr key={row.id} className="border-b dark:border-slate-800">
                    <td className="p-2">{row.beneficiary_name}</td>
                    <td className="p-2">{row.card_number}</td>
                    <td className="p-2">{row.title}</td>
                    <td className="p-2">{formatDateTripoli(row.created_at, "en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="حركات مصححة غير مرتبطة" count={filteredUnlinkedCorrections.length}>
        <UnlinkedCorrectionsFixButton initialCount={filteredUnlinkedCorrections.length} />
        {filteredUnlinkedCorrections.length === 0 ? (
          <p className="text-sm font-medium text-emerald-600">✓ لا توجد حاليا حركات غير مرتبطة قابلة للمعالجة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="p-2">المستفيد</th>
                  <th className="p-2">البطاقة</th>
                  <th className="p-2">المرفق</th>
                  <th className="p-2">القيمة</th>
                  <th className="p-2">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnlinkedCorrections.map((row) => (
                  <tr key={row.id} className="border-b dark:border-slate-800">
                    <td className="p-2">{row.beneficiary_name}</td>
                    <td className="p-2">{row.card_number}</td>
                    <td className="p-2">{row.facility_name}</td>
                    <td className="p-2"><Num value={row.amount} /></td>
                    <td className="p-2">{formatDateTripoli(row.created_at, "en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="تكرارات الحركات للمستفيدين" count={filteredDuplicateMovements.length}>
        <DuplicateMovementsFixButton initialCount={duplicateMovementsCandidateCount} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                <th className="p-2">المستفيد</th>
                <th className="p-2">البطاقة</th>
                <th className="p-2">النوع</th>
                <th className="p-2">القيمة</th>
                <th className="p-2">اليوم</th>
                <th className="p-2">عدد التكرار</th>
              </tr>
            </thead>
            <tbody>
              {filteredDuplicateMovements.map((row) => (
                <tr key={`${row.beneficiary_id}-${row.type}-${row.amount}-${row.movement_day.toISOString()}`} className="border-b dark:border-slate-800">
                  <td className="p-2">{row.beneficiary_name}</td>
                  <td className="p-2">{row.card_number}</td>
                  <td className="p-2">{row.type}</td>
                  <td className="p-2"><Num value={row.amount} /></td>
                  <td className="p-2">{formatDateTripoli(row.movement_day, "en-GB")}</td>
                  <td className="p-2"><Num value={row.duplicate_count} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="مرافق فعالة بكلمة مرور غير صالحة" count={invalidPasswordFacilities.length}>
        <InvalidPasswordFacilitiesFixButton initialCount={invalidPasswordFacilities.length} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                <th className="p-2">الاسم</th>
                <th className="p-2">username</th>
                <th className="p-2">طول hash</th>
                <th className="p-2">must_change_password</th>
              </tr>
            </thead>
            <tbody>
              {invalidPasswordFacilities.map((row) => (
                <tr key={row.id} className="border-b dark:border-slate-800">
                  <td className="p-2">{row.name}</td>
                  <td className="p-2">{row.username}</td>
                  <td className="p-2"><Num value={row.password_len} /></td>
                  <td className="p-2">{row.must_change_password ? "نعم" : "لا"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="مرافق محذوفة (لا يمكنها تسجيل الدخول)" count={deletedFacilities.length}>
        <DeletedFacilitiesFixButton initialCount={deletedFacilities.length} />
        <p className="text-xs text-slate-600">
          هذه القائمة تعرض مرافق محذوفة بالفعل (deleted_at != null)، لذلك لن تظهر في شاشة إدارة المرافق أو المديرين لأنها مخصصة للحسابات النشطة فقط.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                <th className="p-2">الاسم</th>
                <th className="p-2">username</th>
                <th className="p-2">تاريخ الحذف</th>
              </tr>
            </thead>
            <tbody>
              {deletedFacilities.map((row) => (
                <tr key={row.id} className="border-b dark:border-slate-800">
                  <td className="p-2">{row.name}</td>
                  <td className="p-2">{row.username}</td>
                  <td className="p-2">{formatDateTripoli(row.deleted_at, "en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
