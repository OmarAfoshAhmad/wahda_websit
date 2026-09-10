import Link from "next/link";
import prisma from "@/lib/prisma";
import { formatDateTripoli } from "@/lib/datetime";
import { AlertTriangle } from "lucide-react";
import { UnlinkedCorrectionsFixButton } from "./unlinked-corrections-fix-button";
import { DuplicateMovementsFixButton } from "./duplicate-movements-fix-button";
import { InvalidPasswordFacilitiesFixButton } from "./invalid-password-facilities-fix-button";
import { DeletedFacilitiesFixButton } from "./deleted-facilities-fix-button";
import { FixBalancesButton } from "./fix-balances-button";
import { StatusAnomaliesFixButton } from "./status-anomalies-fix-button";
import { OrphanedNotificationsFixButton } from "./orphaned-notifications-fix-button";
import { ParentCardPatternFixButton } from "./parent-card-pattern-fix-button";
import { NormalizeImportIntegerDistributionButton } from "./normalize-import-integer-distribution-button";
import { CeilingExceededFixButton } from "./ceiling-exceeded-fix-button";
import { listCeilingExceededAction, type CeilingExceededRow } from "@/app/actions/ceiling-health-actions";
import { listOutOfRangeTransactionDatesAction, type OutOfRangeDateRow } from "@/app/actions/transaction-date-health-actions";
import { TransactionDateFixSection } from "./transaction-date-fix-section";
import { BASE_BALANCE_SPENT_SUM_SQL } from "@/lib/base-balance-ledger";
import { StatusAnomaliesCheckButton } from "./status-anomalies-check-button";
import { OrphanedNotificationsCheckButton } from "./orphaned-notifications-check-button";
import { FixInvalidSubunitAmountsButton } from "./fix-invalid-subunit-amounts-button";
import { PharmacySuppliesFixSection, PharmacySupplyAnomalyRow } from "./pharmacy-supplies-fix-section";
import { DemographicRepairSection, type DemographicRepairRow } from "./demographic-repair-section";
import { loadLatestImportDemographicEvidence, replaceCardSuffix, shouldTreatAsSoleEmployee, stripCardMemberSuffix } from "@/lib/import-demographic-evidence";
import { normalizeCardNumber } from "@/lib/normalize";



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
  companyId,
  companyName,
}: {
  withinDuplicatesTab?: boolean;
  searchQuery?: string;
  companyId: string;
  companyName: string;
}) {
  let unlinkedCorrections: UnlinkedCorrectionRow[] = [];
  let duplicateImports: DuplicateImportRow[] = [];
  let duplicateMovements: DuplicateMovementRow[] = [];
  let invalidPasswordFacilities: ExperimentalNoPasswordFacilityRow[] = [];
  let deletedFacilities: DeletedFacilityRow[] = [];
  let mustChangePasswordCount = 0;
  let authStateRows: AuthStateRow[] = [];
  let balanceDriftRows: BalanceDriftRow[] = [];
  let statusAnomalyRows: StatusAnomalyRow[] = [];
  let orphanedNotificationRows: OrphanedNotificationRow[] = [];
  let oldReadNotificationSummary: OldReadNotificationSummary[] = [];
  let oldLoginAuditSummary: OldLoginAuditSummary[] = [];
  let oldImportJobsSummary: OldImportJobsSummary[] = [];
  let oldRestoreJobsSummary: OldRestoreJobsSummary[] = [];
  let parentCardPatternRows: ParentCardPatternRow[] = [];
  let legacyFractionalImportRows: LegacyFractionalImportRow[] = [];
  let legacyFractionalImportMemberRows: LegacyFractionalImportMemberRow[] = [];
  let pharmacySupplyRows: PharmacySupplyAnomalyRow[] = [];
  let ceilingExceededRows: CeilingExceededRow[] = [];
  let outOfRangeDateRows: OutOfRangeDateRow[] = [];

    // Group 1: basic corrections and duplicates (3 queries)
    const [unlinkedCorrectionsRes, duplicateImportsRes, duplicateMovementsRes] = await Promise.all([
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
          AND t.company_id = ${companyId}
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
          AND t.company_id = ${companyId}
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
          AND t.company_id = ${companyId}
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
    ]);
    unlinkedCorrections = unlinkedCorrectionsRes;
    duplicateImports = duplicateImportsRes;
    duplicateMovements = duplicateMovementsRes;

    // Group 2: facility info and auth state (3 queries)
    const [invalidPasswordFacilitiesRes, deletedFacilitiesRes, authStateRowsRes] = await Promise.all([
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
    ]);
    invalidPasswordFacilities = invalidPasswordFacilitiesRes;
    deletedFacilities = deletedFacilitiesRes;
    authStateRows = authStateRowsRes;

    // Group 3: balance drift and status anomaly (2 queries)
    const [balanceDriftRowsRes, statusAnomalyRowsRes] = await Promise.all([
      prisma.$queryRaw<BalanceDriftRow[]>`
        SELECT
          b.id,
          b.name,
          b.card_number,
          b.status::text,
          b.total_balance::float8 AS total_balance,
          b.remaining_balance::float8 AS stored_remaining,
          GREATEST(0,
            b.total_balance - ${BASE_BALANCE_SPENT_SUM_SQL}
          )::float8 AS computed_remaining,
          (b.remaining_balance - GREATEST(0,
            b.total_balance - ${BASE_BALANCE_SPENT_SUM_SQL}
          ))::float8 AS drift
        FROM "Beneficiary" b
        LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
        WHERE b.deleted_at IS NULL
          AND b.company_id = ${companyId}
        GROUP BY b.id, b.name, b.card_number, b.status, b.total_balance, b.remaining_balance
        HAVING ABS(
          b.remaining_balance - GREATEST(0,
            b.total_balance - ${BASE_BALANCE_SPENT_SUM_SQL}
          )
        ) > 0.01
        ORDER BY ABS(
          b.remaining_balance - GREATEST(0,
            b.total_balance - ${BASE_BALANCE_SPENT_SUM_SQL}
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
        FROM "Beneficiary" b
        WHERE b.deleted_at IS NULL
          AND b.company_id = ${companyId}
          AND (
            (status = 'ACTIVE'   AND remaining_balance <= 0.01)
            OR (status = 'FINISHED' AND remaining_balance > 0.01)
          )
        ORDER BY card_number
        LIMIT 300
      `,
    ]);
    balanceDriftRows = balanceDriftRowsRes;
    statusAnomalyRows = statusAnomalyRowsRes;

    // Group 4: orphaned notifications and hygiene counters (4 queries)
    const [
      orphanedNotificationRowsRes,
      oldReadNotificationSummaryRes,
      oldLoginAuditSummaryRes,
      oldImportJobsSummaryRes,
    ] = await Promise.all([
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
          AND b.company_id = ${companyId}
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
          AND b.company_id = ${companyId}
      `,

      prisma.$queryRaw<OldLoginAuditSummary[]>`
        SELECT COUNT(*)::int AS old_login_count
        FROM "AuditLog"
        WHERE action IN ('LOGIN', 'LOGOUT')
          AND company_id = ${companyId}
          AND created_at < NOW() - INTERVAL '180 days'
      `,

      prisma.$queryRaw<OldImportJobsSummary[]>`
        SELECT COUNT(*)::int AS old_import_jobs_count
        FROM "ImportJob"
        WHERE status IN ('COMPLETED', 'FAILED', 'ROLLED_BACK')
          AND company_id = ${companyId}
          AND created_at < NOW() - INTERVAL '30 days'
      `,
    ]);
    orphanedNotificationRows = orphanedNotificationRowsRes;
    oldReadNotificationSummary = oldReadNotificationSummaryRes;
    oldLoginAuditSummary = oldLoginAuditSummaryRes;
    oldImportJobsSummary = oldImportJobsSummaryRes;

    // Group 5: legacy fractional imports and parent card pattern (4 queries)
    const [
      oldRestoreJobsSummaryRes,
      parentCardPatternRowsRes,
      legacyFractionalImportRowsRes,
      legacyFractionalImportMemberRowsRes,
    ] = await Promise.all([
      prisma.$queryRaw<OldRestoreJobsSummary[]>`
        SELECT COUNT(*)::int AS old_restore_jobs_count
        FROM "RestoreJob"
        WHERE status IN ('COMPLETED', 'FAILED')
          AND company_id = ${companyId}
          AND created_at < NOW() - INTERVAL '30 days'
      `,

      prisma.$queryRaw<ParentCardPatternRow[]>`
        SELECT
          b.id,
          b.name,
          b.card_number,
          CASE
            WHEN b.card_number ~ '^[A-Za-z]+[0-9]+W$' THEN 'زوجة بدون ترقيم (W)'
            WHEN b.card_number ~ '^[A-Za-z]+[0-9]+M$' THEN 'أم بدون ترقيم (M)'
            WHEN b.card_number ~ '^[A-Za-z]+[0-9]+F$' THEN 'أب بدون ترقيم (F)'
            ELSE 'أخرى'
          END AS pattern_type
        FROM "Beneficiary" b
        WHERE b.deleted_at IS NULL
          AND b.company_id = ${companyId}
          AND (
            b.card_number ~ '^[A-Za-z]+[0-9]+W$'
            OR b.card_number ~ '^[A-Za-z]+[0-9]+M$'
            OR b.card_number ~ '^[A-Za-z]+[0-9]+F$'
          )
        ORDER BY b.card_number
        LIMIT 400
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
          AND b.company_id = ${companyId}
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
          AND b.company_id = ${companyId}
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
    oldRestoreJobsSummary = oldRestoreJobsSummaryRes;
    parentCardPatternRows = parentCardPatternRowsRes;
    legacyFractionalImportRows = legacyFractionalImportRowsRes;
    legacyFractionalImportMemberRows = legacyFractionalImportMemberRowsRes;

    // Group 6: pharmacy supply anomaly, ceiling-exceeded and out-of-range-date transactions (3 queries)
    const [pharmacySupplyRowsRes, ceilingExceededRowsRes, outOfRangeDateRowsRes] = await Promise.all([
      prisma.$queryRaw<PharmacySupplyAnomalyRow[]>`
        SELECT
          t.id,
          b.name AS beneficiary_name,
          b.card_number,
          f.name AS facility_name,
          t.amount::float8 AS amount,
          t.created_at
        FROM "Transaction" t
        JOIN "Beneficiary" b ON b.id = t.beneficiary_id
        JOIN "Facility" f ON f.id = t.facility_id
        WHERE t.type = 'SUPPLIES'
          AND t.company_id = ${companyId}
          AND t.is_cancelled = false
          AND f.name LIKE '%صيدل%'
        ORDER BY t.created_at DESC
        LIMIT 5000
      `,
      listCeilingExceededAction(companyId, 500),
      listOutOfRangeTransactionDatesAction(companyId, 500),
    ]);
    pharmacySupplyRows = pharmacySupplyRowsRes;
    ceilingExceededRows = ceilingExceededRowsRes.success ? ceilingExceededRowsRes.rows : [];
    outOfRangeDateRows = outOfRangeDateRowsRes.success ? outOfRangeDateRowsRes.rows : [];

  const legacyMembersByFamily = legacyFractionalImportMemberRows.reduce<Record<string, LegacyFractionalImportMemberRow[]>>((acc, row) => {
    if (!acc[row.family_base_card]) {
      acc[row.family_base_card] = [];
    }
    acc[row.family_base_card].push(row);
    return acc;
  }, {});

  // الأدلة الديموغرافية تأتي من آخر ملفات الاستيراد المكتملة للشركة نفسها.
  // لا نعتمد الاسم وحده، بل رقم البطاقة الدقيق كما حُفظ في payload.
  const [demographicEvidence, demographicBeneficiaries] = await Promise.all([
    loadLatestImportDemographicEvidence(companyId),
    prisma.beneficiary.findMany({
      where: { company_id: companyId, deleted_at: null },
      select: { id: true, name: true, card_number: true, birth_date: true },
    }),
  ]);
  const employeeRepairRows: DemographicRepairRow[] = [];
  const spouseRepairRows: DemographicRepairRow[] = [];
  const childRepairRows: DemographicRepairRow[] = [];
  const birthRepairRows: DemographicRepairRow[] = [];
  const familyCounts = new Map<string, number>();
  for (const row of demographicBeneficiaries) {
    const base = stripCardMemberSuffix(row.card_number) ?? normalizeCardNumber(row.card_number).toUpperCase();
    familyCounts.set(base, (familyCounts.get(base) ?? 0) + 1);
  }
  for (const beneficiary of demographicBeneficiaries) {
    const card = normalizeCardNumber(beneficiary.card_number).toUpperCase();
    const evidence = demographicEvidence.get(card);
    const baseCard = stripCardMemberSuffix(card);
    const familyCount = baseCard ? (familyCounts.get(baseCard) ?? 0) : 0;
    if (baseCard && shouldTreatAsSoleEmployee(familyCount, evidence)) {
      const proposed = baseCard;
      if (proposed && proposed !== card) employeeRepairRows.push({ id: beneficiary.id, name: beneficiary.name, cardNumber: card, proposedValue: proposed, evidence: evidence?.isEmployee ? `صلة القرابة في ملف الاستيراد: ${evidence.relationship}` : "فرد وحيد في أصل العائلة دون دليل تابع" });
    } else if (/H$/i.test(card) && familyCount > 1) {
      spouseRepairRows.push({ id: beneficiary.id, name: beneficiary.name, cardNumber: card, proposedValue: `${card}1`, evidence: "H دون تسلسل يُصحح إلى H1؛ H1/H2 لا يتغيران" });
    }
    if (evidence?.childCode) {
      const proposed = replaceCardSuffix(card, evidence.childCode);
      if (proposed && proposed !== card) childRepairRows.push({ id: beneficiary.id, name: beneficiary.name, cardNumber: card, proposedValue: proposed, evidence: `صلة القرابة في ملف الاستيراد: ${evidence.relationship}` });
    }
    if (!beneficiary.birth_date && evidence?.birthDate) {
      birthRepairRows.push({ id: beneficiary.id, name: beneficiary.name, cardNumber: card, proposedValue: evidence.birthDate.toISOString().slice(0, 10), evidence: `تطابق بطاقة دقيق من مهمة الاستيراد ${evidence.sourceJobId}` });
    }
  }

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
  const wifePlainCount = parentCardPatternRows.filter((row) => /W$/i.test(row.card_number)).length;
  const motherPlainCount = parentCardPatternRows.filter((row) => /M$/i.test(row.card_number)).length;
  const fatherPlainCount = parentCardPatternRows.filter((row) => /F$/i.test(row.card_number)).length;

  const hygieneCandidates =
    orphanedNotificationRows.length + oldReadNotifications + oldLoginAuditLogs + oldImportJobs + oldRestoreJobs;
  const filteredLegacyFractionalImportRows = hasSearchQuery
    ? legacyFractionalImportRows.filter((row) => row.family_base_card.toLowerCase().includes(normalizedSearchQuery))
    : legacyFractionalImportRows;
  const filteredPharmacySupplyRows = hasSearchQuery
    ? pharmacySupplyRows.filter(
      (row) =>
        row.beneficiary_name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery) ||
        row.facility_name.toLowerCase().includes(normalizedSearchQuery)
    )
    : pharmacySupplyRows;

  const filteredCeilingExceededRows = hasSearchQuery
    ? ceilingExceededRows.filter(
      (row) =>
        row.beneficiary_name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery) ||
        row.facility_name.toLowerCase().includes(normalizedSearchQuery)
    )
    : ceilingExceededRows;
  const ceilingExceededTotalExcess = ceilingExceededRows.reduce((sum, row) => sum + Number(row.excess_amount ?? 0), 0);

  const filteredOutOfRangeDateRows = hasSearchQuery
    ? outOfRangeDateRows.filter(
      (row) =>
        row.beneficiary_name.toLowerCase().includes(normalizedSearchQuery) ||
        row.card_number.toLowerCase().includes(normalizedSearchQuery) ||
        row.facility_name.toLowerCase().includes(normalizedSearchQuery)
    )
    : outOfRangeDateRows;

  const showGeneralSections = true;

  return (
    <div className="space-y-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-2xl font-black">نافذة صحة البيانات وتنظيف القاعدة</h1>
        <p className="text-sm text-slate-600">
          الفحوص المعروضة تخص شركة <strong>{companyName}</strong> فقط، وتتغير مباشرة عند تغيير فلتر الشركة.
        </p>
        {!withinDuplicatesTab && (
          <p className="text-xs text-slate-500">
            ضمن إدارة التكرارات: <Link href="/admin/duplicates?tab=health" className="font-bold text-primary hover:underline">تبويب صحة البيانات</Link>
          </p>
        )}
      </header>

      {showGeneralSections && (
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
        <p className="pt-2 text-xs text-amber-700 dark:text-amber-300">
          التنفيذ الشامل لتنظيف سجلات النظام متاح من نافذة صيانة قاعدة البيانات؛ هذه النافذة تعرض نطاق الشركة المختارة فقط.
        </p>
      </Section>
      )}

      {showGeneralSections && (
      <Section title="كشوفات صيدليات (تحتاج تحويل لأدوية)" count={filteredPharmacySupplyRows.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          يعرض هذا القسم الحركات التي تم تسجيلها كـ (كشف عام) ولكنها نُفذت في مرافق تحتوي أسماؤها على كلمة &quot;صيدلية&quot;، 
          مما يعني أنه ينبغي تحويل نوعها لتصبح (أدوية صرف عام) لضبط التقارير الإحصائية. لا يؤثر هذا على الرصيد المالي المتبقي.
        </p>
        <PharmacySuppliesFixSection rows={filteredPharmacySupplyRows} />
      </Section>
      )}

      {showGeneralSections && (
      <Section title="حركات تجاوزت السقف (أسنان / بصريات)" count={filteredCeilingExceededRows.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          يعرض هذا القسم حركات الأسنان والبصريات التي تحمّلت الشركة فيها مبلغاً يتجاوز السقف السنوي الفعلي للمستفيد
          وقت تنفيذ الحركة، أو التي فيها تناقض بين &quot;حصة الشركة الفعلية&quot; و&quot;المبلغ المستهلك من السقف&quot;
          (وهو ما يجب أن يتساويا دائماً عند التطبيق الصحيح للسقف). المعالجة تُعيد احتساب كل حركات كل مستفيد بترتيبها
          الزمني ضمن سنته المالية وفق السقف المسجَّل وقت كل حركة، دون المساس بالرصيد الأساسي للمستفيد.
        </p>
        {ceilingExceededRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded border border-red-300 bg-red-50 px-2 py-1 font-bold text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              إجمالي الانجراف المكتشف: {ceilingExceededTotalExcess.toLocaleString("ar-LY")} د.ل
            </span>
            <CeilingExceededFixButton companyId={companyId} count={ceilingExceededRows.length} />
          </div>
        )}
        {filteredCeilingExceededRows.length === 0 ? (
          <p className="text-sm font-medium text-emerald-600">✓ لا توجد حركات متجاوزة للسقف حالياً.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="p-2">المستفيد</th>
                  <th className="p-2">رقم البطاقة</th>
                  <th className="p-2">المرفق</th>
                  <th className="p-2">النوع</th>
                  <th className="p-2">نوع العطل</th>
                  <th className="p-2">قيمة الفاتورة</th>
                  <th className="p-2">حصة الشركة المسجَّلة</th>
                  <th className="p-2">المستهلك من السقف</th>
                  <th className="p-2">السقف السنوي</th>
                  <th className="p-2">فرق الانجراف</th>
                  <th className="p-2">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {filteredCeilingExceededRows.map((row) => (
                  <tr key={row.id} className="border-b dark:border-slate-800">
                    <td className="p-2">
                      <Link href={`/beneficiaries?q=${encodeURIComponent(row.card_number)}`} className="font-bold text-primary hover:underline">
                        {row.beneficiary_name}
                      </Link>
                    </td>
                    <td className="p-2 font-mono text-xs">{row.card_number}</td>
                    <td className="p-2 text-xs">{row.facility_name}</td>
                    <td className="p-2 text-xs">{row.service_category}</td>
                    <td className="p-2 text-xs">
                      {row.excess_amount <= 0.01 ? (
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                          سقف مؤرشف قديم — بلا تجاوز مالي فعلي
                        </span>
                      ) : row.policy_applied ? (
                        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                          تجاوز مالي فعلي — سقف مطبَّق خاطئ
                        </span>
                      ) : (
                        <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                          تجاوز مالي فعلي — لم يُطبَّق سقف إطلاقاً
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-left ltr"><Num value={row.amount} /></td>
                    <td className="p-2 text-left ltr font-bold text-red-700 dark:text-red-400">
                      {row.actual_company_share !== null ? <Num value={row.actual_company_share} /> : "—"}
                    </td>
                    <td className="p-2 text-left ltr">
                      {row.ceiling_consumed !== null ? <Num value={row.ceiling_consumed} /> : "—"}
                    </td>
                    <td className="p-2 text-left ltr">
                      {row.annual_ceiling !== null ? <Num value={row.annual_ceiling} /> : <span className="text-slate-400">بلا سقف</span>}
                    </td>
                    <td className="p-2 text-left ltr font-bold text-red-700 dark:text-red-400"><Num value={row.excess_amount} /></td>
                    <td className="p-2 text-xs">{formatDateTripoli(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      )}

      {showGeneralSections && (
      <Section title="حركات بتواريخ خارج النطاق المنطقي" count={filteredOutOfRangeDateRows.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          يعرض هذا القسم الحركات غير الملغاة المسجَّلة بتاريخ في المستقبل أو أقدم من 2020. السبب الغالب هو انقلاب
          اليوم والشهر أثناء قراءة ملف الاستيراد (05/10 تُقرأ 10/05)؛ لهذه الحالة يُعرض تاريخ مقترح بالقلب، ولا يُقترح
          شيء إذا كان اليوم أكبر من 12 أو كان القلب ينتج تاريخاً خارج النطاق. الاقتراح لا يُطبَّق إلا بتأكيد صريح،
          والحالات الأخرى تُصحَّح يدوياً لكل حركة. يُسجَّل كل تغيير في سجل المراقبة بالتاريخين القديم والجديد.
          تصحيح تاريخ حركة أسنان/بصريات/علاج طبيعي إلى سنة مالية مختلفة يستلزم بعده تشغيل «إعادة احتساب تجاوز السقف»
          في القسم السابق.
        </p>
        <TransactionDateFixSection companyId={companyId} rows={filteredOutOfRangeDateRows} />
      </Section>
      )}

      {showGeneralSections && (
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
      )}

      {showGeneralSections && (
      <Section title="انجراف الرصيد — remaining_balance ≠ المحسوب" count={filteredBalanceDriftRows.length}>
        <div className="mb-2 flex justify-start">
          <FixBalancesButton companyId={companyId} />
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
      )}

      {showGeneralSections && (
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
      )}

      {showGeneralSections && (
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
      )}

      {showGeneralSections && (
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
      )}

      {showGeneralSections && (
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
      )}

      {showGeneralSections && (
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
      )}

      {showGeneralSections && (
      <Section title="مرافق فعالة بكلمة مرور غير صالحة — فحص عام للنظام" count={invalidPasswordFacilities.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          هذا الفحص أمني عام ولا يتبع شركة بعينها، لأن حساب المرفق قد يخدم أكثر من شركة.
        </p>
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
      )}

      {showGeneralSections && (
      <Section title="مرافق محذوفة (لا يمكنها تسجيل الدخول) — فحص عام للنظام" count={deletedFacilities.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          هذا الفحص عام على حسابات المرافق ولا يدخل ضمن إحصاءات الشركة المختارة.
        </p>
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
      )}

      {showGeneralSections && (
      <div className="space-y-4">
        <DemographicRepairSection title="1. إزالة ترميز الموظف الوحيد" description="الفرد الوحيد تحت أصل البطاقة يُعامل كموظف أساسي وتزال لاحقته، ما لم يثبت المصدر أنه زوج/زوجة أو ابن/ابنة، مع منع تعارض الرقم." companyId={companyId} mode="employee_base" rows={employeeRepairRows} />
        <DemographicRepairSection title="2. استكمال ترميز H الناقص" description="يصحح H فقط إلى H1. لا يغير H1 أو H2، ولا يحول H إلى W." companyId={companyId} mode="complete_plain_h" rows={spouseRepairRows} />
        <DemographicRepairSection title="3. تصحيح الأبناء حسب صلة القرابة" description="الذكور S (Son) والإناث D (Daughter). لا يظهر إلا من لديه دليل صريح في ملف الاستيراد المحفوظ." companyId={companyId} mode="children_sd" rows={childRepairRows} />
        <DemographicRepairSection title="4. استعادة تواريخ الميلاد من الاستيراد" description="يملأ التاريخ المفقود عند تطابق رقم البطاقة بدقة، ولا يستبدل تاريخاً موجوداً." companyId={companyId} mode="restore_birth_dates" rows={birthRepairRows} />
      </div>
      )}

      {showGeneralSections && (
      <Section title="حالات ترميز غير طبيعي في اللاحقة" count={filteredParentCardPatternRows.length}>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          الإحصائيات بالأعلى تمثل كل النظام، بينما &quot;الظاهر في الجدول&quot; يتأثر بالبحث الحالي فقط.
        </p>
        <ParentCardPatternFixButton
          companyId={companyId}
          totalCount={parentCardPatternRows.length}
          visibleCount={filteredParentCardPatternRows.length}
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
      )}
    </div>
  );
}
