import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const line = env.split(/\r?\n/).find((entry) => /^\s*DATABASE_URL\s*=/.test(entry));
  return line?.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsed = new URL(databaseUrl);
const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
if (apply && !isLocal && !allowRemote) {
  throw new Error("رفض تعديل قاعدة بعيدة. استخدم --allow-remote فقط بعد أخذ نسخة احتياطية والتحقق من الهدف.");
}

const releaseStart = "20260715104500_add_facility_type";
const historical = readdirSync(new URL("../prisma/migrations", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name < releaseStart)
  .map((entry) => entry.name)
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
let baselineAlreadyComplete = false;
await client.connect();
try {
  const fingerprints = await client.query(`
    SELECT
      to_regclass('"Facility"') IS NOT NULL AS facility,
      to_regclass('"Beneficiary"') IS NOT NULL AS beneficiary,
      to_regclass('"Transaction"') IS NOT NULL AS transaction,
      to_regclass('"FamilyImportArchive"') IS NOT NULL AS family_archive,
      to_regclass('"CardIssuanceRegistry"') IS NOT NULL AS issuance_registry,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Facility' AND column_name='is_employee') AS employee_role,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Beneficiary' AND column_name='city') AS beneficiary_city,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Beneficiary' AND column_name='batch_number') AS beneficiary_batch,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Transaction' AND column_name='idempotency_key') AS idempotency
  `);
  const missing = Object.entries(fingerprints.rows[0]).filter(([, present]) => !present).map(([name]) => name);
  if (missing.length > 0) throw new Error(`لا يمكن عمل baseline: بصمة المخطط التاريخي ناقصة (${missing.join(", ")}).`);

  const migrationTable = await client.query(`SELECT to_regclass('"_prisma_migrations"') AS name`);
  if (migrationTable.rows[0]?.name) {
    const recorded = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`);
    const recordedNames = new Set(recorded.rows.map((row) => String(row.migration_name)));
    const missingHistorical = historical.filter((migration) => !recordedNames.has(migration));
    if (recordedNames.size > 0 && missingHistorical.length > 0) {
      throw new Error(
        `سجل migrations جزئي: يوجد ${missingHistorical.length} ترحيلًا تاريخيًا غير مسجل. ` +
        "لن يُستكمل baseline تلقائيًا على قاعدة جزئية.",
      );
    }
    baselineAlreadyComplete = missingHistorical.length === 0;
  }
} finally {
  await client.end();
}

if (baselineAlreadyComplete) {
  console.log(`Baseline مكتمل مسبقًا: جميع الترحيلات التاريخية (${historical.length}) مسجلة. لا إجراء مطلوب.`);
  process.exit(0);
}

console.log(`${apply ? "سيتم" : "فحص فقط:"} تسجيل ${historical.length} ترحيلًا تاريخيًا كـ applied دون تعديل البيانات.`);
if (!apply) {
  console.log("شغّل npm run db:baseline للقاعدة المحلية، أو أضف --apply --allow-remote يدويًا للقاعدة البعيدة بعد النسخ الاحتياطي.");
  process.exit(0);
}

for (const migration of historical) {
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "resolve", "--applied", migration], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit", shell: false,
  });
  if (result.status !== 0) throw result.error ?? new Error(`فشل تسجيل الترحيل ${migration}`);
}
