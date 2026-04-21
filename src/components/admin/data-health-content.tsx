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
import { ParentCardPatternFixButton } from "@/components/parent-card-pattern-fix-button";
import { NormalizeImportIntegerDistributionButton } from "../normalize-import-integer-distribution-button";
import { FixTotalBalancesButton } from "@/components/fix-total-balances-button";

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

type DuplicateImportRow = {
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  duplicate_count: number;
  total_import_amount: number;
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

type ParentCardPatternRow = {
  id: string;
  name: string;
  card_number: string;
  pattern_type: string;
};

type TotalBalanceDriftRow = {
  id: string;
  name: string;
  card_number: string;
  status: string;
  stored_total: number;
  remaining: number;
  sum_spent: number;
  correct_total: number;
  diff: number;
};

type LegacyFractionalImportRow = {
  family_base_card: string;
  members_count: number;
  import_transactions_count: number;
  family_total_import_amount: number;
};

type LegacyFractionalImportMemberRow = {
  family_base_card: string;
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  member_import_transactions_count: number;
  member_total_import_amount: number;
  member_total_balance: number;
  member_remaining_balance: number;
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
    duplicateImports,
    duplicateMovements,
    invalidPasswordFacilities,
    deletedFacilities,
    mustChangePasswordCount,
    authStateRows,
    balanceDriftRows,
    statusAnomalyRows,
    orphanedNotificationRows,
    oldReadNotificationSummary,
    oldLoginAuditSummary,
    oldImportJobsSummary,
    oldRestoreJobsSummary,
    parentCardPatternRows,
    totalBalanceDriftRows,
    legacyFractionalImportRows,
    legacyFractionalImportMemberRows,
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

    prisma.$queryRaw<DuplicateImportRow[]>`
      SELECT
        t.beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        COUNT(*)::int AS duplicate_count,
        SUM(t.amount)::float8 AS total_import_amount,
        MIN(t.created_at) AS first_created_at,
        MAX(t.created_at) AS last_created_at
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.type = 'IMPORT'
        AND t.is_cancelled = false
      GROUP BY t.beneficiary_id, b.name, b.card_number
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC, last_created_at DESC
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

    // بدلاً من جلب كل المرافق + 100K سجل AuditLog في الذاكرة،
    // نستخدم SQL واحد يحسب حالة كل مرفق مباشرة من قاعدة البيانات
    prisma.$queryRaw<AuthStateRow[]>`
      SELECT
        f.id,
        f.name,
        f.username,
        (f.deleted_at IS NOT NULL) AS deleted,
        f.must_change_password,
        (f.password_hash ~ '^\\$2[aby]\\$.{56}$') AS hash_valid_bcrypt,
        last_login.last_login_at,
        last_reset.last_reset_at,
        (
          last_reset.last_reset_at IS NOT NULL
          AND (last_login.last_login_at IS NULL OR last_login.last_login_at < last_reset.last_reset_at)
        ) AS reset_no_login
      FROM "Facility" f
      LEFT JOIN LATERAL (
        SELECT MAX(created_at) AS last_login_at
        FROM "AuditLog"
        WHERE action = 'LOGIN'
          AND (facility_id = f.id OR "user" = f.username)
      ) last_login ON true
      LEFT JOIN LATERAL (
        SELECT MAX(created_at) AS last_reset_at
        FROM "AuditLog"
        WHERE action = 'UPDATE_FACILITY'
          AND (metadata->>'facility_id') = f.id
          AND (metadata->>'reset_password')::boolean = true
      ) last_reset ON true
      WHERE
        f.deleted_at IS NOT NULL
        OR f.password_hash IS NULL
        OR BTRIM(f.password_hash) = ''
        OR f.password_hash !~ '^\\$2[aby]\\$.{56}$'
        OR f.must_change_password = true
        OR last_login.last_login_at IS NULL
        OR (
          last_reset.last_reset_at IS NOT NULL
          AND (last_login.last_login_at IS NULL OR last_login.last_login_at < last_reset.last_reset_at)
        )
      ORDER BY f.created_at DESC
    `,

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

    prisma.$queryRaw<ParentCardPatternRow[]>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        CASE
          WHEN b.card_number ~ '^WAB2025[0-9]+W$' THEN 'زوجة بدون ترقيم (W)'
          WHEN b.card_number ~ '^WAB2025[0-9]+H2$' THEN 'زوج ثاني غير صالح (H2)'
          WHEN b.card_number ~ '^WAB2025[0-9]+M$' THEN 'أم بدون ترقيم (M)'
          WHEN b.card_number ~ '^WAB2025[0-9]+F$' THEN 'أب بدون ترقيم (F)'
          ELSE 'أخرى'
        END AS pattern_type
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND (
          b.card_number ~ '^WAB2025[0-9]+W$'
          OR b.card_number ~ '^WAB2025[0-9]+H2$'
          OR b.card_number ~ '^WAB2025[0-9]+M$'
          OR b.card_number ~ '^WAB2025[0-9]+F$'
        )
      ORDER BY b.card_number
      LIMIT 400
    `,

    prisma.$queryRaw<TotalBalanceDriftRow[]>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        b.status::text,
        b.total_balance::float8 AS stored_total,
        b.remaining_balance::float8 AS remaining,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)::float8 AS sum_spent,
        (b.remaining_balance + COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0))::float8 AS correct_total,
        ((b.remaining_balance + COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)) - b.total_balance)::float8 AS diff
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
        AND b.remaining_balance > 0.01
      GROUP BY b.id, b.name, b.card_number, b.status, b.total_balance, b.remaining_balance
      HAVING (b.remaining_balance + COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)) - b.total_balance > 0.01
      ORDER BY diff DESC
      LIMIT 300
    `,

    prisma.$queryRaw<LegacyFractionalImportRow[]>`
      SELECT
        COALESCE(SUBSTRING(b.card_number FROM '^(WAB2025[0-9]+)'), b.card_number) AS family_base_card,
        COUNT(DISTINCT b.id)::int AS members_count,
        COUNT(t.id)::int AS import_transactions_count,
        ROUND(SUM(t.amount)::numeric, 2)::float8 AS family_total_import_amount
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.type = 'IMPORT'
        AND t.is_cancelled = false
        AND b.deleted_at IS NULL
        AND ABS(t.amount - ROUND(t.amount)) > 0.000001
      GROUP BY COALESCE(SUBSTRING(b.card_number FROM '^(WAB2025[0-9]+)'), b.card_number)
      ORDER BY family_total_import_amount DESC
      LIMIT 300
    `,

    prisma.$queryRaw<LegacyFractionalImportMemberRow[]>`
      SELECT
        COALESCE(SUBSTRING(b.card_number FROM '^(WAB2025[0-9]+)'), b.card_number) AS family_base_card,
        b.id AS beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        COUNT(t.id)::int AS member_import_transactions_count,
        ROUND(SUM(t.amount)::numeric, 2)::float8 AS member_total_import_amount,
        b.total_balance::float8 AS member_total_balance,
        b.remaining_balance::float8 AS member_remaining_balance
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.type = 'IMPORT'
        AND t.is_cancelled = false
        AND b.deleted_at IS NULL
        AND ABS(t.amount - ROUND(t.amount)) > 0.000001
      GROUP BY
        COALESCE(SUBSTRING(b.card_number FROM '^(WAB2025[0-9]+)'), b.card_number),
        b.id,
        b.name,
        b.card_number,
        b.total_balance,
        b.remaining_balance
      ORDER BY family_base_card, b.card_number
      LIMIT 2000
    `,
  ]);

  const legacyMembersByFamily = legacyFractionalImportMemberRows.reduce<Record<string, LegacyFractionalImportMemberRow[]>>((acc, row) => {
    if (!acc[row.family_base_card]) {
      acc[row.family_base_card] = [];
    }
    acc[row.family_base_card].push(row);
    return acc;
  }, {});

  const familyAggregateBalanceByBaseCard = Object.entries(legacyMembersByFamily).reduce<Record<string, { total: number; remaining: number }>>((acc, [baseCard, members]) => {
    acc[baseCard] = {
      total: members.reduce((sum, m) => sum + Number(m.member_total_balance), 0),
      remaining: members.reduce((sum, m) => sum + Number(m.member_remaining_balance), 0),
    };
    return acc;
  }, {});

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

  const filteredDuplicateImports = hasSearchQuery
    ? duplicateImports.filter(
      (row) =>
        row.beneficiary_name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : duplicateImports;

  const duplicateMovementsCandidateCount = duplicateMovements.reduce(
    (sum, row) => sum + Math.max(0, Number(row.duplicate_count ?? 0) - 1),
    0
  );
  const filteredParentCardPatternRows = hasSearchQuery
    ? parentCardPatternRows.filter(
      (row) =>
        row.name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : parentCardPatternRows;
  const invalidH2Count = parentCardPatternRows.filter((row) => /H2$/i.test(row.card_number)).length;
  const wifePlainCount = parentCardPatternRows.filter((row) => /W$/i.test(row.card_number)).length;
  const motherPlainCount = parentCardPatternRows.filter((row) => /M$/i.test(row.card_number)).length;
  const fatherPlainCount = parentCardPatternRows.filter((row) => /F$/i.test(row.card_number)).length;

  const filteredTotalBalanceDriftRows = hasSearchQuery
    ? totalBalanceDriftRows.filter(
      (row) =>
        row.name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery)
    )
    : totalBalanceDriftRows;
  const hygieneCandidates =
    orphanedNotificationRows.length + oldReadNotifications + oldLoginAuditLogs + oldImportJobs + oldRestoreJobs;
  const filteredLegacyFractionalImportRows = hasSearchQuery
    ? legacyFractionalImportRows.filter((row) => row.family_base_card.toLowerCase().includes(normalizedSearchQuery))
    : legacyFractionalImportRows;

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

      <Section title="استيراد مجمع قديم بتوزيع كسور" count={filteredLegacyFractionalImportRows.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          هذه الحالات فيها خصومات استيراد مجمعة بمبالغ عشرية لكل فرد. المعالجة ستحولها إلى توزيع صحيح بالأعداد الصحيحة فقط،
          مع إسناد المتبقي لفرد واحد داخل الأسرة، وتسجيل كامل في سجل المراقبة مع إمكانية التراجع.
        </p>
        <NormalizeImportIntegerDistributionButton
          totalFamilies={legacyFractionalImportRows.length}
          visibleFamilies={filteredLegacyFractionalImportRows.length}
        />
        {filteredLegacyFractionalImportRows.length === 0 ? (
          <p className="text-sm font-medium text-emerald-600">✓ لا توجد حالات استيراد مجمعة عشرية تحتاج معالجة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="p-2">بطاقة العائلة الأساسية</th>
                  <th className="p-2">عدد الأفراد</th>
                  <th className="p-2">عدد حركات الاستيراد</th>
                  <th className="p-2">إجمالي الخصم (قبل التصحيح)</th>
                  <th className="p-2">الرصيد المجمع الحالي</th>
                </tr>
              </thead>
              <tbody>
                {filteredLegacyFractionalImportRows.map((row) => {
                  const familyMembers = legacyMembersByFamily[row.family_base_card] ?? [];
                  const aggregateBalances = familyAggregateBalanceByBaseCard[row.family_base_card] ?? { total: 0, remaining: 0 };

                  return [
                    <tr key={`${row.family_base_card}-summary`} className="border-b dark:border-slate-800">
                        <td className="p-2 font-mono text-xs">{row.family_base_card}</td>
                        <td className="p-2"><Num value={row.members_count} /></td>
                        <td className="p-2"><Num value={row.import_transactions_count} /></td>
                        <td className="p-2 text-left ltr"><Num value={row.family_total_import_amount} /></td>
                        <td className="p-2 text-left ltr font-bold text-emerald-700 dark:text-emerald-400"><Num value={aggregateBalances.remaining} /></td>
                    </tr>,
                    <tr key={`${row.family_base_card}-members`} className="border-b bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/20">
                        <td colSpan={5} className="p-3">
                          <div className="mb-2 flex flex-wrap gap-2 text-xs">
                            <span className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                              إجمالي رصيد الأسرة: <strong className="ltr">{aggregateBalances.total.toLocaleString("ar-LY")}</strong>
                            </span>
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                              المتبقي المجمع: <strong className="ltr">{aggregateBalances.remaining.toLocaleString("ar-LY")}</strong>
                            </span>
                          </div>

                          {familyMembers.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">لا توجد تفاصيل أفراد لهذه العائلة.</p>
                          ) : (
                            <div className="space-y-2">
                              {familyMembers.map((member) => (
                                <div key={member.beneficiary_id} className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{member.beneficiary_name}</p>
                                      <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{member.card_number}</p>
                                    </div>
                                    <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                                      خصم الفرد: {member.member_total_import_amount.toLocaleString("ar-LY")} د.ل
                                    </span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/40">
                                      عدد الحركات: <strong>{member.member_import_transactions_count.toLocaleString("ar-LY")}</strong>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/40">
                                      الرصيد الكلي: <strong className="ltr">{member.member_total_balance.toLocaleString("ar-LY")}</strong>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/40">
                                      الرصيد المتبقي: <strong className="ltr">{member.member_remaining_balance.toLocaleString("ar-LY")}</strong>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/40">
                                      نسبة الخصم من العائلة: <strong>{row.family_total_import_amount > 0 ? ((member.member_total_import_amount / row.family_total_import_amount) * 100).toLocaleString("ar-LY", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%</strong>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
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

      <Section title="تكرارات حركات الاستيراد" count={filteredDuplicateImports.length}>
        <p className="text-xs text-slate-500">
          هذه القائمة تعرض المستفيدين الذين لديهم أكثر من حركة IMPORT فعالة.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                <th className="p-2">المستفيد</th>
                <th className="p-2">البطاقة</th>
                <th className="p-2">عدد IMPORT</th>
                <th className="p-2">إجمالي IMPORT</th>
                <th className="p-2">أول تاريخ</th>
                <th className="p-2">آخر تاريخ</th>
              </tr>
            </thead>
            <tbody>
              {filteredDuplicateImports.map((row) => (
                <tr key={`${row.beneficiary_id}-${row.last_created_at.toISOString()}`} className="border-b dark:border-slate-800">
                  <td className="p-2">{row.beneficiary_name}</td>
                  <td className="p-2">{row.card_number}</td>
                  <td className="p-2"><Num value={row.duplicate_count} /></td>
                  <td className="p-2"><Num value={row.total_import_amount} /></td>
                  <td className="p-2">{formatDateTripoli(row.first_created_at, "en-GB")}</td>
                  <td className="p-2">{formatDateTripoli(row.last_created_at, "en-GB")}</td>
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

      <Section title="انجراف الرصيد الكلي (total_balance < remaining + المصروف)" count={filteredTotalBalanceDriftRows.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          هذه الحالات فيها <code>total_balance</code> أقل من <code>remaining_balance + مجموع الحركات</code>، مما يُسبب فشل عمليات الخصم برسالة &quot;تعذر تنفيذ عملية الخصم&quot;. الإصلاح يضبط <code>total_balance = remaining + مصروف</code> لكل حالة.
        </p>
        <div className="mb-2">
          <FixTotalBalancesButton />
        </div>
        {filteredTotalBalanceDriftRows.length === 0 ? (
          <p className="text-sm font-medium text-emerald-600">✓ لا يوجد انجراف في الرصيد الكلي</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="p-2">المستفيد</th>
                  <th className="p-2">البطاقة</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2">total_balance المخزون</th>
                  <th className="p-2">remaining</th>
                  <th className="p-2">مجموع المصروف</th>
                  <th className="p-2 text-amber-600">total_balance الصحيح</th>
                  <th className="p-2 text-red-600">الفرق</th>
                </tr>
              </thead>
              <tbody>
                {filteredTotalBalanceDriftRows.map((row) => (
                  <tr key={row.id} className="border-b bg-amber-50/40 dark:border-slate-800 dark:bg-amber-950/20">
                    <td className="p-2">{row.name}</td>
                    <td className="p-2 font-mono text-xs">{row.card_number}</td>
                    <td className="p-2 text-xs">{row.status}</td>
                    <td className="p-2 text-left ltr"><Num value={row.stored_total} /></td>
                    <td className="p-2 text-left ltr"><Num value={row.remaining} /></td>
                    <td className="p-2 text-left ltr"><Num value={row.sum_spent} /></td>
                    <td className="p-2 text-left ltr font-medium text-amber-700 dark:text-amber-400"><Num value={row.correct_total} /></td>
                    <td className="p-2 text-left ltr font-bold text-red-700 dark:text-red-400">+{row.diff.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="حالات ترميز غير طبيعي في اللاحقة" count={filteredParentCardPatternRows.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          الإحصائيات بالأعلى تمثل كل النظام، بينما "الظاهر في الجدول" يتأثر بالبحث الحالي فقط.
        </p>
        <ParentCardPatternFixButton
          totalCount={parentCardPatternRows.length}
          visibleCount={filteredParentCardPatternRows.length}
          invalidH2Count={invalidH2Count}
          wifePlainCount={wifePlainCount}
          motherPlainCount={motherPlainCount}
          fatherPlainCount={fatherPlainCount}
        />
        {filteredParentCardPatternRows.length === 0 ? (
          <p className="text-sm font-medium text-emerald-600">✓ لا توجد حالات تحتاج تحويل في نمط بطاقات الأب/الأم.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="p-2">الاسم</th>
                  <th className="p-2">رقم البطاقة</th>
                  <th className="p-2">نوع الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filteredParentCardPatternRows.map((row) => (
                  <tr key={row.id} className="border-b dark:border-slate-800">
                    <td className="p-2">{row.name}</td>
                    <td className="p-2 font-mono text-xs">{row.card_number}</td>
                    <td className="p-2 text-xs text-slate-700 dark:text-slate-300">{row.pattern_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
