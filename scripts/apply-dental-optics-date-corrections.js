/**
 * يحدّث تاريخ حركات الأسنان/البصريات المستوردة سابقاً دون إنشاء حركة جديدة.
 * الوضع الافتراضي فحص فقط. التطبيق يتطلب --apply و --confirm-count N.
 */
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function clean(value) {
  return String(value ?? '').trim();
}

function asDate(iso) {
  const match = clean(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadCorrections(file) {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const sheet = workbook.Sheets['تصحيحات مؤكدة'];
  if (!sheet) throw new Error('لم يتم العثور على ورقة "تصحيحات مؤكدة".');
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).map((row, index) => ({
    excelRow: index + 2,
    name: clean(row['اسم المريض']),
    card: clean(row['رقم التأمين']).toUpperCase(),
    amount: Number(row['القيمة المالية']),
    service: clean(row['نوع الخدمة']).toUpperCase(),
    oldDate: clean(row['التاريخ القديم']),
    newDate: clean(row['التاريخ المصحح']),
    oldKey: clean(row['مفتاح الحركة القديمة المتوقع']),
  }));
}

async function main() {
  const fileArg = argValue('--file');
  if (!fileArg) {
    throw new Error('الاستخدام: node scripts/apply-dental-optics-date-corrections.js --file <xlsx> [--apply --confirm-count N]');
  }
  const file = path.resolve(fileArg);
  const rows = loadCorrections(file);
  if (!rows.length) throw new Error('لا توجد تصحيحات مؤكدة في الملف.');

  const invalid = rows.filter(row => (
    !row.oldKey || !['DENTAL', 'OPTICS'].includes(row.service) || !asDate(row.oldDate) || !asDate(row.newDate) || row.oldDate === row.newDate
  ));
  if (invalid.length) {
    throw new Error(`يوجد ${invalid.length} صف غير صالح، أولها صف Excel ${invalid[0].excelRow}.`);
  }

  const keys = rows.map(row => row.oldKey);
  const existing = await prisma.transaction.findMany({
    where: { idempotency_key: { in: keys } },
    include: { beneficiary: { select: { card_number: true, name: true } } },
  });
  const existingByKey = new Map(existing.map(transaction => [transaction.idempotency_key, transaction]));
  const ready = [];
  const missing = [];
  const conflicts = [];

  for (const row of rows) {
    const transaction = existingByKey.get(row.oldKey);
    if (!transaction) {
      missing.push({ row: row.excelRow, card: row.card, oldKey: row.oldKey });
      continue;
    }
    const transactionCard = clean(transaction.beneficiary.card_number).toUpperCase();
    if (transaction.type !== row.service || transactionCard !== row.card || Number(transaction.amount) !== row.amount) {
      conflicts.push({
        row: row.excelRow,
        card: row.card,
        reason: 'الحركة المطابقة للمفتاح تختلف في النوع أو البطاقة أو المبلغ',
      });
      continue;
    }
    const newKey = row.oldKey.endsWith(`:${row.oldDate}`)
      ? `${row.oldKey.slice(0, -row.oldDate.length)}${row.newDate}`
      : '';
    if (!newKey) {
      conflicts.push({ row: row.excelRow, card: row.card, reason: 'تعذر بناء مفتاح الحركة المصحح' });
      continue;
    }
    ready.push({ row, transaction, newKey });
  }

  const collisionKeys = ready.map(item => item.newKey);
  const collisions = collisionKeys.length
    ? await prisma.transaction.findMany({ where: { idempotency_key: { in: collisionKeys } }, select: { id: true, idempotency_key: true } })
    : [];
  const collisionSet = new Set(collisions.map(item => item.idempotency_key));
  const safe = ready.filter(item => !collisionSet.has(item.newKey));
  for (const item of ready.filter(candidate => collisionSet.has(candidate.newKey))) {
    conflicts.push({ row: item.row.excelRow, card: item.row.card, reason: 'مفتاح التاريخ المصحح مستخدم في حركة أخرى' });
  }

  const report = {
    file,
    mode: process.argv.includes('--apply') ? 'APPLY' : 'DRY_RUN',
    fileRows: rows.length,
    ready: safe.length,
    missing: missing.length,
    conflicts: conflicts.length,
    missingExamples: missing.slice(0, 10),
    conflictExamples: conflicts.slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 2));

  if (!process.argv.includes('--apply')) {
    console.log('[DRY RUN] لم يتم تعديل قاعدة البيانات.');
    return;
  }
  const confirmedCount = Number(argValue('--confirm-count'));
  if (!Number.isInteger(confirmedCount) || confirmedCount !== safe.length) {
    throw new Error(`للتطبيق مرر --confirm-count ${safe.length} بعد مراجعة نتيجة الفحص.`);
  }
  if (missing.length || conflicts.length) {
    throw new Error('أوقف التطبيق بسبب وجود حركات مفقودة أو متعارضة. عالج التقرير أولاً.');
  }

  await prisma.$transaction(async tx => {
    for (const item of safe) {
      await tx.transaction.update({
        where: { id: item.transaction.id },
        data: {
          created_at: asDate(item.row.newDate),
          idempotency_key: item.newKey,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        user: argValue('--actor') || 'admin',
        action: 'CORRECT_IMPORTED_SERVICE_TRANSACTION_DATES',
        metadata: {
          file: path.basename(file),
          count: safe.length,
          services: [...new Set(safe.map(item => item.row.service))],
          corrections: safe.map(item => ({
            transactionId: item.transaction.id,
            card: item.row.card,
            oldDate: item.row.oldDate,
            newDate: item.row.newDate,
            oldKey: item.row.oldKey,
            newKey: item.newKey,
          })),
        },
      },
    });
  });
  console.log(`[OK] تم تصحيح ${safe.length} حركة دون إنشاء حركات جديدة.`);
}

main()
  .catch(error => {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
