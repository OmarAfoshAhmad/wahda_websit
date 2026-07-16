import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const line = env.split(/\r?\n/).find((entry) => /^\s*DATABASE_URL\s*=/.test(entry));
  if (!line) return undefined;
  return line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const expectedMigrations = readdirSync(new URL("../prisma/migrations", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const releaseMigrations = new Set([
  "20260715104500_add_facility_type",
  "20260715112000_add_maintenance_jobs",
  "20260715113500_unique_active_card_number",
  "20260715115500_single_active_restore",
  "20260715123000_add_postgres_rate_limits",
]);

const client = new pg.Client({ connectionString: databaseUrl });
const blockers = [];
const warnings = [];
const details = {};

async function scalar(sql) {
  const result = await client.query(sql);
  return Number(result.rows[0]?.count ?? 0);
}

try {
  await client.connect();

  const migrationsTable = await scalar(`
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = '_prisma_migrations'
  `);
  if (migrationsTable === 0) {
    blockers.push("قاعدة البيانات بلا سجل Prisma migrations؛ يلزم baseline قبل migrate deploy.");
    details.migrations = { recorded: 0, expected: expectedMigrations.length, missingHistorical: expectedMigrations.length };
  } else {
    const rows = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    const applied = new Set(rows.rows.map((row) => String(row.migration_name)));
    const missing = expectedMigrations.filter((name) => !applied.has(name));
    const missingHistorical = missing.filter((name) => !releaseMigrations.has(name));
    details.migrations = { recorded: applied.size, expected: expectedMigrations.length, pendingRelease: missing.filter((name) => releaseMigrations.has(name)), missingHistorical };
    if (missingHistorical.length > 0) blockers.push(`يوجد ${missingHistorical.length} ترحيلًا تاريخيًا غير مسجل؛ لا تشغّل migrate deploy قبل معالجتها.`);
  }

  const duplicateCards = await scalar(`
    SELECT COUNT(*) FROM (
      SELECT UPPER(BTRIM(card_number)) FROM "Beneficiary"
      WHERE deleted_at IS NULL GROUP BY UPPER(BTRIM(card_number)) HAVING COUNT(*) > 1
    ) duplicates
  `);
  details.duplicateActiveCards = duplicateCards;
  if (duplicateCards > 0) blockers.push(`توجد ${duplicateCards} مجموعة بطاقات نشطة مكررة ستمنع إنشاء الفهرس الفريد.`);

  const activeRestores = await scalar(`SELECT COUNT(*) FROM "RestoreJob" WHERE status IN ('PENDING', 'PROCESSING')`);
  details.activeRestores = activeRestores;
  if (activeRestores > 1) blockers.push(`توجد ${activeRestores} مهام استعادة نشطة؛ يجب إنهاء الزائد قبل الترحيل.`);

  const invalidBalances = await scalar(`
    SELECT COUNT(*) FROM "Beneficiary"
    WHERE remaining_balance < 0 OR total_balance < 0 OR remaining_balance > total_balance
  `);
  details.invalidBalances = invalidBalances;
  if (invalidBalances > 0) blockers.push(`توجد ${invalidBalances} سجلات بأرصدة خارج النطاق الصحيح.`);

  const orphanTransactions = await scalar(`
    SELECT COUNT(*) FROM "Transaction" t
    LEFT JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    LEFT JOIN "Facility" f ON f.id = t.facility_id
    WHERE b.id IS NULL OR f.id IS NULL
  `);
  details.orphanTransactions = orphanTransactions;
  if (orphanTransactions > 0) blockers.push(`توجد ${orphanTransactions} حركات يتيمة مرتبطة بمستفيد أو مرفق غير موجود.`);

  const unknownFacilityTypes = await scalar(`
    SELECT COUNT(*) FROM "Facility"
    WHERE facility_type IS NOT NULL
      AND facility_type NOT IN ('HOSPITAL','PHARMACY','DENTAL_CLINIC','PHYSIOTHERAPY_CENTER','SPECIALTY_CLINIC','OPTICAL_CENTER')
  `);
  details.unknownFacilityTypes = unknownFacilityTypes;
  if (unknownFacilityTypes > 0) blockers.push(`توجد ${unknownFacilityTypes} مرافق بنوع غير مدعوم.`);

  const facilitiesWithoutType = await scalar(`
    SELECT COUNT(*) FROM "Facility"
    WHERE deleted_at IS NULL AND is_admin = false AND is_manager = false AND is_employee = false AND facility_type IS NULL
  `);
  details.activeFacilitiesWithoutType = facilitiesWithoutType;
  if (facilitiesWithoutType > 0) warnings.push(`يوجد ${facilitiesWithoutType} مرفقًا نشطًا بلا نوع؛ عيّن النوع للاستفادة من الصلاحيات الجماعية.`);
} finally {
  await client.end().catch(() => undefined);
}

console.log(JSON.stringify({ ready: blockers.length === 0, blockers, warnings, details }, null, 2));
if (blockers.length > 0) process.exitCode = 1;
