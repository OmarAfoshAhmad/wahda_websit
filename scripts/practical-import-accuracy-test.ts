import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { processTransactionImport } from "@/lib/import-transactions";

type StrictMetrics = {
  duplicateImportBeneficiaries: number;
  balanceDriftOfficial: number;
  fractionalImportTxActive: number;
  overdrawnDebts: number;
  activeImportTransactions: number;
  importAuditCount: number;
};

const prisma = new PrismaClient();

async function getStrictMetrics(): Promise<StrictMetrics> {
  const [duplicateImportBeneficiaries, balanceDriftOfficial, fractionalImportTxActive, overdrawnDebts, activeImportTransactions, importAuditCount] = await Promise.all([
    prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c
      FROM (
        SELECT beneficiary_id
        FROM "Transaction"
        WHERE type='IMPORT' AND is_cancelled=false
        GROUP BY beneficiary_id
        HAVING COUNT(*) > 1
      ) x
    `,
    prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c
      FROM (
        SELECT b.id
        FROM "Beneficiary" b
        LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
        WHERE b.deleted_at IS NULL
        GROUP BY b.id, b.total_balance, b.remaining_balance
        HAVING ABS(
          b.remaining_balance - GREATEST(
            0,
            b.total_balance - COALESCE(SUM(CASE WHEN t.is_cancelled=false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)
          )
        ) > 0.01
      ) x
    `,
    prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c
      FROM "Transaction"
      WHERE type='IMPORT' AND is_cancelled=false
        AND ABS(amount - ROUND(amount)) > 0.001
    `,
    prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c
      FROM (
        SELECT b.id
        FROM "Beneficiary" b
        LEFT JOIN "Transaction" t
          ON t.beneficiary_id = b.id
          AND t.is_cancelled = false
          AND t.type <> 'CANCELLATION'
        WHERE b.deleted_at IS NULL
        GROUP BY b.id, b.total_balance
        HAVING (b.total_balance - COALESCE(SUM(t.amount), 0)) < -0.01
      ) x
    `,
    prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c
      FROM "Transaction"
      WHERE type='IMPORT' AND is_cancelled=false
    `,
    prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c
      FROM "AuditLog"
      WHERE action='IMPORT_TRANSACTIONS'
    `,
  ]);

  return {
    duplicateImportBeneficiaries: Number(duplicateImportBeneficiaries[0]?.c ?? 0),
    balanceDriftOfficial: Number(balanceDriftOfficial[0]?.c ?? 0),
    fractionalImportTxActive: Number(fractionalImportTxActive[0]?.c ?? 0),
    overdrawnDebts: Number(overdrawnDebts[0]?.c ?? 0),
    activeImportTransactions: Number(activeImportTransactions[0]?.c ?? 0),
    importAuditCount: Number(importAuditCount[0]?.c ?? 0),
  };
}

async function getLastImportAudit() {
  const rows = await prisma.$queryRaw<Array<{ id: string; created_at: Date; metadata: unknown }>>`
    SELECT id, created_at, metadata
    FROM "AuditLog"
    WHERE action='IMPORT_TRANSACTIONS'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function main() {
  const fileArg = process.argv[2] || "استيراد حركات قديمة new.xlsx";
  const targetFile = path.resolve(process.cwd(), fileArg);

  if (!fs.existsSync(targetFile)) {
    throw new Error(`Import file not found: ${targetFile}`);
  }

  const actor = await prisma.facility.findFirst({
    where: { deleted_at: null },
    select: { id: true, username: true, name: true },
  });

  if (!actor?.username) {
    throw new Error("No active facility/actor found for import test.");
  }

  const buffer = fs.readFileSync(targetFile);

  const before = await getStrictMetrics();

  const firstRun = await processTransactionImport(buffer, actor.username, actor.id);
  const afterFirst = await getStrictMetrics();
  const auditAfterFirst = await getLastImportAudit();

  const secondRun = await processTransactionImport(buffer, actor.username, actor.id);
  const afterSecond = await getStrictMetrics();
  const auditAfterSecond = await getLastImportAudit();

  const delta1 = {
    importTx: afterFirst.activeImportTransactions - before.activeImportTransactions,
    duplicateImportBeneficiaries: afterFirst.duplicateImportBeneficiaries - before.duplicateImportBeneficiaries,
    fractionalImportTxActive: afterFirst.fractionalImportTxActive - before.fractionalImportTxActive,
    balanceDriftOfficial: afterFirst.balanceDriftOfficial - before.balanceDriftOfficial,
    overdrawnDebts: afterFirst.overdrawnDebts - before.overdrawnDebts,
    importAuditCount: afterFirst.importAuditCount - before.importAuditCount,
  };

  const delta2 = {
    importTx: afterSecond.activeImportTransactions - afterFirst.activeImportTransactions,
    duplicateImportBeneficiaries: afterSecond.duplicateImportBeneficiaries - afterFirst.duplicateImportBeneficiaries,
    fractionalImportTxActive: afterSecond.fractionalImportTxActive - afterFirst.fractionalImportTxActive,
    balanceDriftOfficial: afterSecond.balanceDriftOfficial - afterFirst.balanceDriftOfficial,
    overdrawnDebts: afterSecond.overdrawnDebts - afterFirst.overdrawnDebts,
    importAuditCount: afterSecond.importAuditCount - afterFirst.importAuditCount,
  };

  const run1 = firstRun.result;
  const run2 = secondRun.result;

  const passCriteria = {
    secondRunShouldNotCreateFamilies: Number(run2?.importedFamilies ?? -1) === 0,
    secondRunShouldNotCreateImportTx: Number(run2?.importedTransactions ?? -1) === 0,
    secondRunNoImportTxGrowth: delta2.importTx === 0,
    secondRunNoNewDuplicateImports: delta2.duplicateImportBeneficiaries <= 0,
    secondRunNoNewFractionalImports: delta2.fractionalImportTxActive <= 0,
  };

  const passScore = Object.values(passCriteria).filter(Boolean).length;
  const scorePercent = Math.round((passScore / Object.keys(passCriteria).length) * 100);

  console.log(
    JSON.stringify(
      {
        actor,
        file: targetFile,
        before,
        run1,
        afterFirst,
        delta1,
        auditAfterFirst,
        run2,
        afterSecond,
        delta2,
        auditAfterSecond,
        passCriteria,
        practicalAccuracyScorePercent: scorePercent,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
