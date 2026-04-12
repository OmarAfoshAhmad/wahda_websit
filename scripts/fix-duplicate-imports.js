/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');

const prisma = new PrismaClient();

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function collectDuplicateCases() {
  const duplicates = await prisma.$queryRaw`
    SELECT beneficiary_id, COUNT(*)::int as cnt
    FROM "Transaction"
    WHERE type = 'IMPORT' AND is_cancelled = false
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length === 0) {
    return [];
  }

  const beneficiaryIds = duplicates.map((d) => d.beneficiary_id);

  const beneficiaries = await prisma.beneficiary.findMany({
    where: { id: { in: beneficiaryIds } },
    select: {
      id: true,
      name: true,
      card_number: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
    },
  });

  const txs = await prisma.transaction.findMany({
    where: {
      beneficiary_id: { in: beneficiaryIds },
      type: 'IMPORT',
      is_cancelled: false,
    },
    select: {
      id: true,
      beneficiary_id: true,
      facility_id: true,
      amount: true,
      created_at: true,
      facility: { select: { name: true } },
    },
    orderBy: [{ beneficiary_id: 'asc' }, { created_at: 'asc' }],
  });

  const txByBeneficiary = new Map();
  for (const tx of txs) {
    const arr = txByBeneficiary.get(tx.beneficiary_id) || [];
    arr.push(tx);
    txByBeneficiary.set(tx.beneficiary_id, arr);
  }

  return beneficiaries.map((b) => {
    const all = txByBeneficiary.get(b.id) || [];
    const kept = all[0] || null;
    const toDelete = all.slice(1);
    const deletedAmount = round2(toDelete.reduce((s, t) => s + Number(t.amount), 0));
    const currentRemaining = round2(Number(b.remaining_balance));
    const fixedRemaining = round2(currentRemaining + deletedAmount);
    const fixedStatus = fixedRemaining <= 0 ? 'FINISHED' : 'ACTIVE';

    return {
      beneficiary: b,
      transactions: all,
      keepTransaction: kept,
      deleteTransactions: toDelete,
      deletedAmount,
      currentRemaining,
      fixedRemaining,
      fixedStatus,
    };
  });
}

async function exportExcel(cases) {
  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet('summary');
  summary.columns = [
    { header: 'beneficiary_id', key: 'beneficiary_id', width: 30 },
    { header: 'name', key: 'name', width: 32 },
    { header: 'card_number', key: 'card_number', width: 22 },
    { header: 'import_count', key: 'import_count', width: 12 },
    { header: 'current_remaining', key: 'current_remaining', width: 16 },
    { header: 'extra_import_amount', key: 'extra_import_amount', width: 18 },
    { header: 'fixed_remaining', key: 'fixed_remaining', width: 16 },
    { header: 'current_status', key: 'current_status', width: 14 },
    { header: 'fixed_status', key: 'fixed_status', width: 14 },
  ];

  for (const c of cases) {
    summary.addRow({
      beneficiary_id: c.beneficiary.id,
      name: c.beneficiary.name,
      card_number: c.beneficiary.card_number,
      import_count: c.transactions.length,
      current_remaining: c.currentRemaining,
      extra_import_amount: c.deletedAmount,
      fixed_remaining: c.fixedRemaining,
      current_status: c.beneficiary.status,
      fixed_status: c.fixedStatus,
    });
  }

  const details = workbook.addWorksheet('details');
  details.columns = [
    { header: 'beneficiary_id', key: 'beneficiary_id', width: 30 },
    { header: 'name', key: 'name', width: 32 },
    { header: 'card_number', key: 'card_number', width: 22 },
    { header: 'transaction_id', key: 'transaction_id', width: 30 },
    { header: 'amount', key: 'amount', width: 12 },
    { header: 'created_at', key: 'created_at', width: 24 },
    { header: 'facility', key: 'facility', width: 24 },
    { header: 'action', key: 'action', width: 16 },
  ];

  for (const c of cases) {
    for (let i = 0; i < c.transactions.length; i++) {
      const t = c.transactions[i];
      details.addRow({
        beneficiary_id: c.beneficiary.id,
        name: c.beneficiary.name,
        card_number: c.beneficiary.card_number,
        transaction_id: t.id,
        amount: Number(t.amount),
        created_at: t.created_at.toISOString(),
        facility: t.facility?.name || t.facility_id,
        action: i === 0 ? 'KEEP' : 'DELETE',
      });
    }
  }

  const fileName = 'reports/duplicate-imports-cases.xlsx';
  await workbook.xlsx.writeFile(fileName);
  return fileName;
}

async function applyFix(cases) {
  let removedTransactions = 0;

  await prisma.$transaction(async (tx) => {
    for (const c of cases) {
      if (c.deleteTransactions.length === 0) continue;

      await tx.transaction.deleteMany({
        where: { id: { in: c.deleteTransactions.map((x) => x.id) } },
      });
      removedTransactions += c.deleteTransactions.length;

      await tx.beneficiary.update({
        where: { id: c.beneficiary.id },
        data: {
          remaining_balance: c.fixedRemaining,
          status: c.fixedStatus,
          completed_via: c.fixedStatus === 'FINISHED' ? 'IMPORT' : null,
        },
      });
    }
  });

  return { removedTransactions };
}

async function main() {
  const apply = process.argv.includes('--apply');

  const cases = await collectDuplicateCases();
  const excelPath = await exportExcel(cases);

  const totalExtra = round2(cases.reduce((s, c) => s + c.deletedAmount, 0));
  const finishedNow = cases.filter((c) => c.beneficiary.status === 'FINISHED').length;
  const finishedAfterFix = cases.filter((c) => c.fixedStatus === 'FINISHED').length;

  console.log('=== Duplicate IMPORT Analysis ===');
  console.log('Beneficiaries with duplicate IMPORT:', cases.length);
  console.log('Estimated extra deducted amount:', totalExtra.toFixed(2));
  console.log('FINISHED before fix:', finishedNow);
  console.log('FINISHED after fix:', finishedAfterFix);
  console.log('Excel report:', excelPath);

  if (!apply) {
    console.log('Dry-run mode. No DB changes applied.');
    console.log('Run with --apply to apply fix.');
    await prisma.$disconnect();
    return;
  }

  const result = await applyFix(cases);
  console.log('Fix applied. Removed transactions:', result.removedTransactions);

  await prisma.auditLog.create({
    data: {
      facility_id: null,
      user: 'system-script',
      action: 'FIX_DUPLICATE_IMPORT_TRANSACTIONS',
      metadata: {
        affectedBeneficiaries: cases.length,
        removedTransactions: result.removedTransactions,
        totalExtraAmount: totalExtra,
        report: excelPath,
      },
    },
  });

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
