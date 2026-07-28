#!/usr/bin/env node
const { Client } = require("pg");

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function requireUrl(name, value) {
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }
  return url;
}

function dbName(url) {
  return url.pathname.replace(/^\//, "");
}

function assertSafeDatabases(sourceUrl, targetUrl, apply) {
  const sourceDb = dbName(sourceUrl);
  const targetDb = dbName(targetUrl);
  if (sourceDb === targetDb) throw new Error("Source and target databases must be different.");
  if (!/(snapshot|backup|production)/i.test(sourceDb)) {
    throw new Error("Source database name must clearly identify a snapshot/backup/production copy.");
  }
  if (apply && !/(test|testing|dev|development|replace|cycle)/i.test(targetDb)) {
    throw new Error("Apply is blocked unless target database name clearly identifies a disposable dev/test database.");
  }
}

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function getColumns(client, table) {
  const res = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `,
    [table],
  );
  return res.rows.map((row) => row.column_name);
}

async function fetchRows(client, table, whereSql, params) {
  const res = await client.query(`SELECT * FROM ${qIdent(table)} WHERE ${whereSql}`, params);
  return res.rows;
}

async function countRows(client, table, whereSql, params) {
  const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${qIdent(table)} WHERE ${whereSql}`, params);
  return Number(res.rows[0]?.count ?? 0);
}

async function upsertRows(target, table, rows) {
  if (rows.length === 0) return 0;
  const columns = await getColumns(target, table);
  const usableColumns = columns.filter((column) => Object.prototype.hasOwnProperty.call(rows[0], column));
  if (!usableColumns.includes("id")) throw new Error(`${table} has no id column in selected rows.`);

  let applied = 0;
  const quotedColumns = usableColumns.map(qIdent).join(", ");
  const placeholders = usableColumns.map((_, index) => `$${index + 1}`).join(", ");
  const updates = usableColumns
    .filter((column) => column !== "id")
    .map((column) => `${qIdent(column)} = EXCLUDED.${qIdent(column)}`)
    .join(", ");
  const sql = `
    INSERT INTO ${qIdent(table)} (${quotedColumns})
    VALUES (${placeholders})
    ON CONFLICT ("id") DO UPDATE SET ${updates}
  `;

  for (const row of rows) {
    const values = usableColumns.map((column) => row[column]);
    await target.query(sql, values);
    applied++;
  }
  return applied;
}

async function resolveCompany(source, input) {
  if (!input) throw new Error("Pass --company-code=CODE or --company-id=ID.");
  const res = await source.query(
    `
      SELECT *
      FROM "InsuranceCompany"
      WHERE id = $1 OR UPPER(code) = UPPER($1) OR name = $1
      LIMIT 1
    `,
    [input],
  );
  const company = res.rows[0];
  if (!company) throw new Error(`Company not found in source snapshot: ${input}`);
  return company;
}

async function main() {
  const sourceUrl = requireUrl("SOURCE_DATABASE_URL", process.env.SOURCE_DATABASE_URL || argValue("source-url"));
  const targetUrl = requireUrl("TARGET_DATABASE_URL", process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || argValue("target-url"));
  const companyInput = argValue("company-id") || argValue("company-code");
  const apply = hasFlag("apply");

  assertSafeDatabases(sourceUrl, targetUrl, apply);

  const source = new Client({ connectionString: sourceUrl.toString() });
  const target = new Client({ connectionString: targetUrl.toString() });
  await source.connect();
  await target.connect();

  try {
    const company = await resolveCompany(source, companyInput);
    const companyId = company.id;

    const sourceCounts = {
      company: 1,
      beneficiaries: await countRows(source, "Beneficiary", "company_id = $1", [companyId]),
      active_beneficiaries: await countRows(source, "Beneficiary", "company_id = $1 AND deleted_at IS NULL", [companyId]),
      transactions: await countRows(source, "Transaction", "company_id = $1 OR beneficiary_id IN (SELECT id FROM \"Beneficiary\" WHERE company_id = $1)", [companyId]),
      wallet_consumptions: await countRows(source, "WalletConsumption", "company_id = $1", [companyId]),
      claims: await countRows(source, "Claim", "company_id = $1 OR beneficiary_id IN (SELECT id FROM \"Beneficiary\" WHERE company_id = $1)", [companyId]),
      service_policies: await countRows(source, "ServicePolicy", "company_id = $1", [companyId]),
      service_mappings: await countRows(source, "ServiceTypeMapping", "company_id = $1", [companyId]),
      family_archives: await countRows(source, "FamilyImportArchive", "company_id = $1", [companyId]),
      audit_logs: await countRows(source, "AuditLog", "company_id = $1", [companyId]),
      account_company_accesses: await countRows(source, "AccountCompanyAccess", "company_id = $1", [companyId]),
    };

    const targetCompany = await target.query(
      'SELECT id, name, code FROM "InsuranceCompany" WHERE id = $1 OR UPPER(code) = UPPER($2) LIMIT 1',
      [company.id, company.code],
    );

    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      sourceDatabase: dbName(sourceUrl),
      targetDatabase: dbName(targetUrl),
      company: { id: company.id, name: company.name, code: company.code },
      targetCompanyExists: Boolean(targetCompany.rows[0]),
      sourceCounts,
      note: apply ? "Applying upserts. No rows outside this company will be deleted." : "Dry run only. Add --apply to write to target.",
    }, null, 2));

    if (!apply) return;

    await target.query("BEGIN");
    const applied = {};
    try {
      applied.company = await upsertRows(target, "InsuranceCompany", [company]);
      applied.service_policies = await upsertRows(target, "ServicePolicy", await fetchRows(source, "ServicePolicy", "company_id = $1", [companyId]));
      applied.service_mappings = await upsertRows(target, "ServiceTypeMapping", await fetchRows(source, "ServiceTypeMapping", "company_id = $1", [companyId]));
      applied.account_company_accesses = await upsertRows(target, "AccountCompanyAccess", await fetchRows(source, "AccountCompanyAccess", "company_id = $1", [companyId]));
      applied.beneficiaries = await upsertRows(target, "Beneficiary", await fetchRows(source, "Beneficiary", "company_id = $1", [companyId]));
      applied.wallet_consumptions = await upsertRows(target, "WalletConsumption", await fetchRows(source, "WalletConsumption", "company_id = $1", [companyId]));
      applied.transactions = await upsertRows(target, "Transaction", await fetchRows(source, "Transaction", "company_id = $1 OR beneficiary_id IN (SELECT id FROM \"Beneficiary\" WHERE company_id = $1)", [companyId]));
      applied.claims = await upsertRows(target, "Claim", await fetchRows(source, "Claim", "company_id = $1 OR beneficiary_id IN (SELECT id FROM \"Beneficiary\" WHERE company_id = $1)", [companyId]));

      const claimIds = await target.query('SELECT id FROM "Claim" WHERE company_id = $1', [companyId]);
      const claimIdList = claimIds.rows.map((row) => row.id);
      applied.claim_audit_logs = claimIdList.length > 0
        ? await upsertRows(target, "ClaimAuditLog", await fetchRows(source, "ClaimAuditLog", "claim_id = ANY($1::text[])", [claimIdList]))
        : 0;

      applied.family_archives = await upsertRows(target, "FamilyImportArchive", await fetchRows(source, "FamilyImportArchive", "company_id = $1", [companyId]));
      applied.audit_logs = await upsertRows(target, "AuditLog", await fetchRows(source, "AuditLog", "company_id = $1", [companyId]));

      const beneficiaryIds = await target.query('SELECT id FROM "Beneficiary" WHERE company_id = $1', [companyId]);
      const beneficiaryIdList = beneficiaryIds.rows.map((row) => row.id);
      applied.notifications = beneficiaryIdList.length > 0
        ? await upsertRows(target, "Notification", await fetchRows(source, "Notification", "beneficiary_id = ANY($1::text[])", [beneficiaryIdList]))
        : 0;

      await target.query("COMMIT");
      console.log(JSON.stringify({ applied }, null, 2));
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
